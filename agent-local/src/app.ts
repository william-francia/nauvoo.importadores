import { randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";
import type { AgentConfig } from "./config.ts";
import { FiscalIssuer } from "./fiscal.ts";
import { RemoteGateway } from "./remote.ts";
import type { AgentStore } from "./store.ts";
import { OperationalMachine } from "./state-machine.ts";
import type { ConnectivityEvidence, LocalInvoice, LocalSession } from "./types.ts";

const asRecord = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const isAdmin = (role: string) => role.toLowerCase() === "administrador";

export class LocalAgentApp {
  readonly remote: RemoteGateway; readonly issuer: FiscalIssuer; readonly machine: OperationalMachine;
  private timer: NodeJS.Timeout | null = null; private recovering = false; private lastOfflineProbeAt = 0;
  constructor(readonly config: AgentConfig, readonly store: AgentStore) {
    this.remote = new RemoteGateway(config); this.issuer = new FiscalIssuer(config, store);
    const status = store.getState(); this.machine = new OperationalMachine(status.state, 0);
  }
  start() { this.timer = setInterval(() => void this.checkConnectivity(), 30_000); this.timer.unref(); void this.checkConnectivity(); }
  stop() { if (this.timer) clearInterval(this.timer); }
  async authenticateRemote(accessToken: string): Promise<Omit<LocalSession, "id" | "expiresAt">> {
    if (!accessToken || accessToken.length > 8192) throw new Error("Sesión remota inválida.");
    const headers = { apikey: this.config.supabaseAnonKey, authorization: `Bearer ${accessToken}` };
    const auth = await fetch(`${this.config.supabaseUrl}/auth/v1/user`, { headers, signal: AbortSignal.timeout(10_000) });
    if (!auth.ok) throw new Error("No se pudo validar la sesión con Supabase.");
    const user = asRecord(await auth.json()); const id = String(user.id ?? "");
    const profileResponse = await fetch(`${this.config.supabaseUrl}/rest/v1/usuarios?auth_user_id=eq.${encodeURIComponent(id)}&activo=eq.true&select=id,rol,nombre`, { headers: { ...headers, accept: "application/vnd.pgrst.object+json" }, signal: AbortSignal.timeout(10_000) });
    if (!profileResponse.ok) throw new Error("El usuario no está habilitado para operar la caja local.");
    const profile = asRecord(await profileResponse.json()); const role = String(profile.rol ?? "");
    if (!["administrador", "vendedor", "caja"].includes(role.toLowerCase())) throw new Error("El rol no puede emitir documentos fiscales.");
    return { userId: id, userName: String(profile.nombre ?? user.email ?? id), role };
  }
  async pair(accessToken: string) {
    const profile = await this.authenticateRemote(accessToken); const token = randomBytes(32).toString("base64url");
    const session = { id: token, ...profile, expiresAt: new Date(Date.now() + this.config.sessionHours * 3_600_000).toISOString() };
    await this.store.createSession(token, session); return session;
  }
  async bootstrap(session: LocalSession) { if (!isAdmin(session.role)) throw new Error("Solo administración puede aprovisionar el agente."); const bundle = await this.remote.bootstrap(); await this.store.saveBootstrap(bundle); return { generatedAt: bundle.generatedAt, products: bundle.products.length, clients: bundle.clients.length, numberBlock: bundle.numberBlock }; }
  async reportBrowser(browserOnline: boolean) { const status = this.store.getState(); await this.store.setState(status.state, { ...asRecord(status.evidence), browserOnline, browserReportedAt: new Date().toISOString() }); }
  async manualEvent(session: LocalSession, input: Record<string, unknown>) {
    if (!isAdmin(session.role)) throw new Error("Operación reservada a administración.");
    if (!["DEGRADADO", "INICIANDO_CONTINGENCIA", "OFFLINE"].includes(this.machine.state)) throw new Error("No hay evidencia técnica que permita iniciar una contingencia manual.");
    const code = String(input.tipoEventoCodigo ?? "").trim(); const evidence = String(input.evidencia ?? "").trim();
    if (!code || evidence.length < 10) throw new Error("Debe seleccionar un tipo sincronizado y documentar la evidencia.");
    const event = await this.beginEvent(code, String(input.descripcion ?? "Contingencia administrativa"), false, session.userId, { evidencia: evidence });
    if (this.machine.state === "DEGRADADO") this.machine.move("INICIANDO_CONTINGENCIA");
    if (this.machine.state === "INICIANDO_CONTINGENCIA") this.machine.confirmContingency();
    this.lastOfflineProbeAt = Date.now();
    await this.store.setState(this.machine.state, { manual: true, actor: session.userId }); return event;
  }
  async checkConnectivity() {
    if (this.machine.state === "OFFLINE") {
      const rule = this.store.getBootstrap()?.rules.find(item => item.codigo === "REVERIFICACION_OFFLINE_MINUTOS"); const minutes = Number(rule?.valor);
      if (!Number.isFinite(minutes) || minutes <= 0 || Date.now() - this.lastOfflineProbeAt < minutes * 60_000) return;
      this.lastOfflineProbeAt = Date.now();
    }
    const checkedAt = new Date().toISOString(); let internetOnline = false; let backendOnline = false; let siatOnline = false; let detail: string;
    try { const response = await fetch("https://siatinfo.impuestos.gob.bo/", { method: "HEAD", signal: AbortSignal.timeout(5_000) }); internetOnline = response.ok || response.status < 500; } catch { /* evidencia negativa */ }
    try {
      const probe = await this.remote.action<{ siatOnline: boolean; detail?: string }>({ action: "probe" }, 12_000); backendOnline = true; siatOnline = probe.siatOnline; detail = probe.detail ?? "";
    } catch (error) { detail = error instanceof Error ? error.message : String(error); }
    const reportedBrowser = asRecord(this.store.getState().evidence).browserOnline;
    const evidence: ConnectivityEvidence = { browserOnline: typeof reportedBrowser === "boolean" ? reportedBrowser : null, internetOnline, backendOnline, siatOnline, specificService: "ServicioFacturacionCompraVenta.verificarComunicacion", checkedAt, detail };
    const next = this.machine.next(evidence); await this.store.setState(next, evidence);
    if (next === "INICIANDO_CONTINGENCIA" && !this.store.activeEvent() && this.config.defaultEventCode) {
      await this.beginEvent(this.config.defaultEventCode, `Contingencia automática: ${detail || "servicio fiscal no disponible"}`, true, null, evidence);
      this.machine.confirmContingency(); this.lastOfflineProbeAt = Date.now(); await this.store.setState("OFFLINE", evidence);
    }
    if (next === "RECUPERANDO" && !this.recovering) void this.recover(evidence);
  }
  private async beginEvent(code: string, description: string, automatic: boolean, actor: string | null, evidence: unknown) {
    const bundle = this.store.getBootstrap(); if (!bundle) throw new Error("El agente no fue aprovisionado.");
    const event = { id: crypto.randomUUID(), tipoEventoCodigo: code, descripcion: description, observaciones: automatic ? "Detección automática con tres fallos consecutivos." : "Intervención administrativa auditada.", fechaInicio: new Date().toISOString(), fechaFin: null, cufdId: bundle.cufd.id, cufd: bundle.cufd, automatico: automatic, actorAuthUserId: actor, evidencia: evidence };
    await this.store.startEvent(event); return event;
  }
  async recover(evidence?: unknown) {
    if (this.recovering) return { status: "EN_PROCESO" }; this.recovering = true;
    try {
      const active = this.store.activeEvent(); const resumed = this.store.pendingRecoveryEvent(); const source = active ?? resumed;
      if (!source) { this.machine.move("REGISTRANDO_EVENTO"); this.machine.move("EMPAQUETANDO"); this.machine.move("ENVIANDO_PAQUETES"); this.machine.move("VALIDANDO_PAQUETES"); this.machine.move("ONLINE"); await this.store.setState("ONLINE", evidence ?? {}); return { status: "SIN_EVENTO" }; }
      const closed = active ? { ...active, fechaFin: new Date().toISOString(), evidencia: { ...asRecord(active.evidencia), recuperacion: evidence ?? {} } } : source;
      if (active) await this.store.closeEvent(String(active.id), closed); this.machine.move("REGISTRANDO_EVENTO"); await this.store.setState(this.machine.state, evidence ?? {});
      await this.remote.action({ action: "import-event", evento: closed });
      let attempt = 0;
      for (const invoice of this.store.pendingInvoices()) {
        attempt += 1;
        try { const response = await this.syncInvoice(invoice); await this.store.markSynced(invoice, response); }
        catch (error) { await this.store.markOutboxError(invoice.id, error instanceof Error ? error.message : String(error), attempt); }
      }
      if (this.store.pendingCount() > 0) { this.machine.move("OFFLINE"); await this.store.setState("OFFLINE", { error: "Recuperación parcial", evidence }); return { status: "PARCIAL", pendientes: this.store.pendingCount() }; }
      await this.remote.action({ action: "finalize-event", eventoId: source.id });
      this.machine.move("EMPAQUETANDO"); await this.store.setState(this.machine.state, evidence ?? {});
      this.machine.move("ENVIANDO_PAQUETES"); await this.store.setState(this.machine.state, evidence ?? {});
      this.machine.move("VALIDANDO_PAQUETES"); await this.store.setState(this.machine.state, evidence ?? {});
      this.machine.move("ONLINE"); await this.store.setState("ONLINE", evidence ?? {}); return { status: "EN_COLA_REMOTA" };
    } finally { this.recovering = false; }
  }
  private async syncInvoice(invoice: LocalInvoice) {
    const snapshot = invoice.snapshot; const local = asRecord(snapshot.local); const xmlGzip = this.store.readArtifact(invoice.xmlPath); const pdf = this.store.readArtifact(invoice.pdfPath);
    const payload = { ventaId: crypto.randomUUID(), facturaId: invoice.id, eventoId: invoice.eventId, idempotencyKey: invoice.idempotencyKey, correlationId: invoice.correlationId, actorAuthUserId: invoice.createdBy, codigoVenta: `OFF-${invoice.numeroFactura}`, clienteId: local.clienteId, metodoPago: local.metodoPago, observacion: local.observacion, descuentoVenta: local.descuentoVenta, items: local.items, modalidad: snapshot.modalidad, documentoSector: snapshot.documentoSector, tipoFactura: snapshot.tipoFactura, numeroFactura: invoice.numeroFactura, fechaEmision: invoice.fechaEmision, cuf: invoice.cuf, clienteSnapshot: snapshot.cliente, detalleSnapshot: snapshot.detalle, totalesSnapshot: snapshot.totales, pagoSnapshot: snapshot.pago, xmlHash: invoice.xmlHash, xmlFirmado: snapshot.modalidad === "ELECTRONICA", qrContenido: "consulta SIN", origenCaja: invoice.cajaId, payloadHash: invoice.xmlHash, versionXsd: "SIAT_VIGENTE", hashXsd: null, esManualCafc: Boolean(invoice.manualCafc), cafcId: invoice.manualCafc?.rangeId ?? null, numeroManual: invoice.manualCafc?.numero ?? null };
    const evidence = invoice.manualCafc ? this.store.readArtifact(invoice.manualCafc.evidencePath).toString("base64") : null;
    return this.remote.action<Record<string, unknown>>({ action: "import-invoice", factura: payload, xmlGzipBase64: xmlGzip.toString("base64"), pdfBase64: pdf.toString("base64"), evidenciaBase64: evidence, evidenciaMime: "application/octet-stream" }, 40_000);
  }
  document(invoiceId: string, type: "PDF" | "XML") { const invoice = this.store.listInvoices().find(item => item.id === invoiceId); if (!invoice) throw new Error("Documento local no encontrado."); const bytes = this.store.readArtifact(type === "PDF" ? invoice.pdfPath : invoice.xmlPath); return type === "XML" ? gunzipSync(bytes) : bytes; }
}

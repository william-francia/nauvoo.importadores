import { randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentConfig } from "./config.ts";
import { FiscalIssuer } from "./fiscal.ts";
import { assertCafcEnabled, assertContingencyPilotReady, assertOfflineCufd, assertPilotAdministration, contingencyPilotEnabled } from "./contingency-safety.ts";
import { RemoteGateway } from "./remote.ts";
import type { AgentStore } from "./store.ts";
import { OperationalMachine } from "./state-machine.ts";
import type { ConnectivityEvidence, LocalInvoice, LocalSession } from "./types.ts";
import type { InvoiceSnapshot } from "../../supabase/functions/_shared/siat/types.ts";
import { prepareManualCafcXml } from "./manual-cafc.ts";
import { snapshotManualCafc } from "./manual-cafc-form.ts";
import { sha256 } from "./security.ts";

const asRecord = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const isAdmin = (role: string) => role.toLowerCase() === "administrador";

export class LocalAgentApp {
  readonly remote: RemoteGateway; readonly issuer: FiscalIssuer; readonly machine: OperationalMachine;
  private checking = false;
  private reportingAvailability = false;
  private availability: { backendOnline: boolean | null; checkedAt: string | null } = { backendOnline: null, checkedAt: null };
  private timer: NodeJS.Timeout | null = null; private recovering = false; private lastOfflineProbeAt = 0;
  constructor(readonly config: AgentConfig, readonly store: AgentStore) {
    this.remote = new RemoteGateway(config); this.issuer = new FiscalIssuer(config, store);
    const status = store.getState(); this.machine = new OperationalMachine(status.state, 0);
  }
  start() {
    const tick = () => {
      void this.reportDisabledAvailability().catch(() => {});
      void this.checkConnectivity().catch(() => this.store.setState(this.machine.state, { ...asRecord(this.store.getState().evidence), revisionAdministrativa: true, error: "RECUPERACION_PENDIENTE_COMPROBACION" })).catch(() => {});
    };
    this.timer = setInterval(tick, 30_000); this.timer.unref(); tick();
  }
  stop() { if (this.timer) clearInterval(this.timer); }
  async reportDisabledAvailability() {
    if (contingencyPilotEnabled() || this.reportingAvailability || this.store.activeEvent() || this.store.pendingRecoveryEvent() || this.store.pendingCount()) return;
    this.reportingAvailability = true;
    try {
      await this.remote.action({ action: "heartbeat", estado: "DEGRADADO", navegadorOnline: null, backendRemotoOnline: true,
        servicioSiatOnline: null, servicioEspecifico: null, fallosConsecutivos: 0, eventoId: null,
        evidencia: { modo: "FISCAL_DESHABILITADO", siatVerificado: false }, changedAt: new Date().toISOString() });
      this.availability = { backendOnline: true, checkedAt: new Date().toISOString() };
    } catch (error) {
      this.availability = { backendOnline: false, checkedAt: new Date().toISOString() }; throw error;
    } finally { this.reportingAvailability = false; }
  }
  offlineSaleReady() {
    const bundle = this.store.getBootstrap(); const event = this.store.activeEvent();
    if (!contingencyPilotEnabled() || this.machine.state !== "OFFLINE" || bundle?.config.ambiente !== "PRUEBAS" || !event
      || !["1", "2", "3", "4"].includes(String(event.tipoEventoCodigo)) || event.cafcId || !this.store.hasOfflineNumber()) return false;
    try { assertOfflineCufd(event, asRecord(event.cufd), new Date().toISOString()); return true; } catch { return false; }
  }
  status(session: LocalSession) {
    const allowed = isAdmin(session.role) && contingencyPilotEnabled();
    const state = this.machine.state;
    const stored = this.store.getState();
    const evidence = contingencyPilotEnabled() ? stored.evidence : { ...asRecord(stored.evidence), ...this.availability, siatOnline: null };
    return { ...stored, evidence, reserva: this.store.reservationStatus(), emisionOfflineHabilitada: this.offlineSaleReady(), capacidades: {
      aprovisionar: isAdmin(session.role) && process.env.SIAT_CONTINGENCIA_AMBIENTE === "PRUEBAS" && !this.store.activeEvent() && !this.store.pendingRecoveryEvent() && !this.store.hasPendingRetirement() && this.store.pendingCount() === 0,
      recuperar: allowed && ["OFFLINE", "RECUPERANDO", "REGISTRANDO_EVENTO"].includes(state),
      registrarEvento: allowed && ["DEGRADADO", "INICIANDO_CONTINGENCIA"].includes(state) && !this.store.activeEvent(),
      cerrarReservaSinEvento: isAdmin(session.role) && process.env.SIAT_CONTINGENCIA_AMBIENTE === "PRUEBAS" && !this.store.activeEvent() && !this.store.pendingCount() && this.store.canReleaseUnusedReservation(),
    } };
  }
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
  async bootstrap(session: LocalSession) { if (!isAdmin(session.role)) throw new Error("Solo administración puede aprovisionar el agente."); assertPilotAdministration(); if (this.store.activeEvent() || this.store.pendingRecoveryEvent() || this.store.pendingCount()) throw new Error("APROVISIONAMIENTO_BLOQUEADO_POR_CONTINGENCIA_PENDIENTE"); if (this.store.hasPendingRetirement()) throw new Error("APROVISIONAMIENTO_BLOQUEADO_POR_CIERRE_PENDIENTE"); const count = Number(process.env.SIAT_AGENT_RESERVA_CANTIDAD); if (!Number.isSafeInteger(count) || count < 1 || count > 10000 || (!contingencyPilotEnabled() && count !== 1)) throw new Error("CONFIGURAR_CANTIDAD_RESERVA_OFFLINE"); const bundle = await this.remote.bootstrap(count); await this.store.saveBootstrap(bundle); return { generatedAt: bundle.generatedAt, products: bundle.products.length, clients: bundle.clients.length, numberBlock: bundle.numberBlock }; }
  async reportBrowser(browserOnline: boolean) { const status = this.store.getState(); await this.store.setState(status.state, { ...asRecord(status.evidence), browserOnline, browserReportedAt: new Date().toISOString() }); }
  async manualEvent(session: LocalSession, input: Record<string, unknown>) {
    if (!isAdmin(session.role)) throw new Error("Operación reservada a administración.");
    assertContingencyPilotReady();
    if (this.store.activeEvent()) throw new Error("YA_EXISTE_CONTINGENCIA_ACTIVA");
    if (!["DEGRADADO", "INICIANDO_CONTINGENCIA", "OFFLINE"].includes(this.machine.state)) throw new Error("No hay evidencia técnica que permita iniciar una contingencia manual.");
    const code = String(input.tipoEventoCodigo ?? "").trim(); const evidence = String(input.evidencia ?? "").trim();
    if (!code || evidence.length < 10) throw new Error("Debe seleccionar un tipo sincronizado y documentar la evidencia.");
    const cafcId = String(input.cafcId ?? "").trim() || null;
    if (cafcId || ["5", "6", "7"].includes(code)) assertCafcEnabled();
    const event = await this.beginEvent(code, String(input.descripcion ?? "Contingencia administrativa"), false, session.userId, { evidencia: evidence }, cafcId);
    if (this.machine.state === "DEGRADADO") this.machine.move("INICIANDO_CONTINGENCIA");
    if (this.machine.state === "INICIANDO_CONTINGENCIA") this.machine.confirmContingency();
    this.lastOfflineProbeAt = Date.now();
    await this.store.setState(this.machine.state, { manual: true, actor: session.userId }); return event;
  }
  async checkConnectivity() {
    if (!contingencyPilotEnabled() || this.checking) return;
    const pendingClose = this.store.retirement(null);
    if (pendingClose && pendingClose.confirmada !== true) return; this.checking = true;
    try { await this.checkConnectivityOnce(); } finally { this.checking = false; }
  }
  private async checkConnectivityOnce() {
    if (this.machine.state === "OFFLINE") {
      const rule = this.store.getBootstrap()?.rules.find(item => item.codigo === "REVERIFICACION_OFFLINE_MINUTOS"); const minutes = Number(rule?.valor);
      if (!Number.isFinite(minutes) || minutes <= 0 || Date.now() - this.lastOfflineProbeAt < minutes * 60_000) return;
      this.lastOfflineProbeAt = Date.now();
    }
    const checkedAt = new Date().toISOString(); let internetOnline = false; let backendOnline = false; let siatOnline = false; let detail: string;
    try { const response = await fetch("https://siatinfo.impuestos.gob.bo/", { method: "HEAD", signal: AbortSignal.timeout(5_000) }); internetOnline = response.ok || response.status < 500; } catch { /* evidencia negativa */ }
    try {
      const probe = await this.remote.action<{ siatOnline: boolean; revisionRequired?: boolean; detail?: string }>({ action: "probe" }, 12_000); backendOnline = true; siatOnline = probe.siatOnline; detail = probe.revisionRequired ? "CONTROL_REVISION_REQUERIDA" : probe.detail ?? "";
    } catch (error) { detail = error instanceof Error ? error.message : String(error); }
    internetOnline ||= backendOnline;
    const reportedBrowser = asRecord(this.store.getState().evidence).browserOnline;
    const evidence: ConnectivityEvidence = { browserOnline: typeof reportedBrowser === "boolean" ? reportedBrowser : null, internetOnline, backendOnline, siatOnline, specificService: "ServicioFacturacionCompraVenta.verificarComunicacion", checkedAt, detail };
    // Errores de autorizaci?n/configuraci?n no prueban un corte de Internet.
    if (/HTTP [45]|CONTROL_REVISION|firma|nonce|agente.*bloqueado/i.test(detail) || (internetOnline && !backendOnline)) { await this.store.setState(this.machine.state, { ...evidence, revisionAdministrativa: true }); return; }
    const next = this.machine.next(evidence); await this.store.setState(next, evidence);
    if (contingencyPilotEnabled() && next === "INICIANDO_CONTINGENCIA" && !this.store.activeEvent() && this.config.defaultEventCode) {
      await this.beginEvent(internetOnline || backendOnline ? "2" : "1", `Contingencia automática: ${detail || "servicio fiscal no disponible"}`, true, null, evidence);
      this.machine.confirmContingency(); this.lastOfflineProbeAt = Date.now(); await this.store.setState("OFFLINE", evidence);
    }
    if (contingencyPilotEnabled() && next === "RECUPERANDO" && !this.recovering) await this.recover(evidence);
    if (contingencyPilotEnabled() && next === "REGISTRANDO_EVENTO" && internetOnline && backendOnline && siatOnline && !this.recovering) {
      if (this.store.pendingCount() > 0) { this.machine.move("OFFLINE"); await this.store.setState("OFFLINE", { ...evidence, resultado: "SINCRONIZACION_PENDIENTE" }); }
      else await this.confirmRemoteRecovery(evidence);
    }
  }
  private async beginEvent(code: string, description: string, automatic: boolean, actor: string | null, evidence: unknown, cafcId: string | null = null) {
    const bundle = this.store.getBootstrap(); if (!bundle) throw new Error("El agente no fue aprovisionado.");
    if (bundle.config.ambiente !== "PRUEBAS") throw new Error("CONTINGENCIA_SOLO_PILOTO");
    if (["5", "6", "7"].includes(code) && !cafcId) throw new Error("EVENTO_CAFC_NO_AUTORIZADO");
    if (!/^[1-7]$/.test(code) || !description.trim() || !Object.keys(asRecord(evidence)).length) throw new Error("EVENTO_DATOS_O_EVIDENCIA_INVALIDOS");
    const fechaInicio = new Date().toISOString();
    assertOfflineCufd({ fechaInicio, cufdId: bundle.cufd.id }, bundle.cufd, fechaInicio);
    if (cafcId) {
      const range = bundle.cafc.find((row) => String(row.id) === cafcId); const now = Date.parse(fechaInicio);
      if (!["5", "6", "7"].includes(code) || !range || range.estado !== "VIGENTE" || range.sucursal_id !== bundle.branch.id
        || (range.punto_venta_id ?? null) !== (bundle.point?.id ?? null) || !Number.isFinite(Date.parse(String(range.vigente_desde)))
        || !Number.isFinite(Date.parse(String(range.vigente_hasta))) || Date.parse(String(range.vigente_desde)) > now || Date.parse(String(range.vigente_hasta)) <= now) throw new Error("EVENTO_CAFC_NO_AUTORIZADO");
    }
    const event = { id: crypto.randomUUID(), tipoEventoCodigo: code, descripcion: description, observaciones: automatic ? "Detección automática con tres fallos consecutivos." : "Intervención administrativa auditada.", fechaInicio, fechaFin: null, cufdId: bundle.cufd.id, cufd: bundle.cufd, cafcId, automatico: automatic, actorAuthUserId: actor, evidencia: evidence };
    await this.store.startEvent(event); return event;
  }
  async recover(evidence?: unknown) {
    assertContingencyPilotReady();
    if (this.recovering) return { status: "EN_PROCESO" }; this.recovering = true;
    try {
      const active = this.store.activeEvent(); const resumed = this.store.pendingRecoveryEvent(); const source = active ?? resumed;
      if (!source) { this.machine.move("REGISTRANDO_EVENTO"); this.machine.move("EMPAQUETANDO"); this.machine.move("ENVIANDO_PAQUETES"); this.machine.move("VALIDANDO_PAQUETES"); this.machine.move("ONLINE"); await this.store.setState("ONLINE", evidence ?? {}); return { status: "SIN_EVENTO" }; }
      const closed = active ? { ...active, fechaFin: new Date().toISOString(), evidencia: { ...asRecord(active.evidencia), recuperacion: evidence ?? {} } } : source;
      if (active) await this.store.closeEvent(String(active.id), closed); this.machine.move("REGISTRANDO_EVENTO"); await this.store.setState(this.machine.state, evidence ?? {});
      if (!this.store.listInvoices().some(invoice => invoice.eventId === source.id)) {
        await this.store.setState("REGISTRANDO_EVENTO", { ...asRecord(evidence), resultado: "EVENTO_SIN_DOCUMENTOS_REVISION", validacionRemotaPendiente: true });
        return { status: "SIN_DOCUMENTOS_PENDIENTE" };
      }
      await this.remote.action({ action: "import-event", evento: closed });
      let attempt = 0;
      for (const invoice of this.store.pendingInvoices()) {
        attempt += 1;
        try { const response = await this.syncInvoice(invoice); await this.store.markSynced(invoice, response); }
        catch (error) { await this.store.markOutboxError(invoice.id, error instanceof Error ? error.message : String(error), attempt); }
      }
      if (this.store.pendingCount() > 0) { this.machine.move("OFFLINE"); await this.store.setState("OFFLINE", { error: "Recuperación parcial", evidence }); return { status: "PARCIAL", pendientes: this.store.pendingCount() }; }
      await this.remote.action({ action: "finalize-event", eventoId: source.id });
      // Encolar no demuestra que el SIN haya registrado el evento ni validado paquetes.
      await this.store.setState("REGISTRANDO_EVENTO", { ...asRecord(evidence), resultado: "EN_COLA_REMOTA", validacionRemotaPendiente: true });
      return { status: "EN_COLA_REMOTA" };
    } catch (error) {
      if (this.machine.state === "RECUPERANDO" || this.machine.state === "REGISTRANDO_EVENTO") this.machine.move("OFFLINE");
      await this.store.setState(this.machine.state, { resultado: "RECUPERACION_PENDIENTE", revisionAdministrativa: true });
      throw error;
    } finally { this.recovering = false; }
  }
  async confirmRemoteRecovery(evidence?: unknown) {
    assertContingencyPilotReady();
    if (this.recovering || this.machine.state !== "REGISTRANDO_EVENTO") return { status: "PENDIENTE" };
    const event = this.store.pendingRecoveryEvent();
    if (!event || this.store.pendingCount() > 0) return { status: "PENDIENTE" };
    this.recovering = true;
    try {
      const sinFacturasLocales = !this.store.listInvoices().some(invoice => invoice.eventId === event.id);
      const result = await this.remote.action<{ eventoId?: string; confirmada?: boolean }>({ action: "recovery-status", eventoId: String(event.id), sinFacturasLocales });
      if (result.eventoId !== event.id) return { status: "PENDIENTE" };
      if (result.confirmada !== true) {
        if (sinFacturasLocales) return { status: "PENDIENTE" };
        // Tras reinicio, recuperar una finalización que pudo perderse antes de encolarse.
        // Ambos endpoints son idempotentes; la transmisión fiscal usa su propio marcador persistente.
        await this.remote.action({ action: "import-event", evento: event });
        await this.remote.action({ action: "finalize-event", eventoId: event.id });
        return { status: "PENDIENTE" };
      }
      await this.releaseRetiredReservation(String(event.id));
      const refreshed = await this.remote.action<import("./types.ts").BootstrapBundle>({ action: "bootstrap", reserveNumbers: false, contrato: 2 });
      await this.store.saveBootstrap({ ...refreshed, numberBlock: null });
      await this.store.confirmRecovery(String(event.id), { ...asRecord(evidence), resultado: "RECUPERACION_CONFIRMADA", eventoId: event.id });
      this.machine.move("EMPAQUETANDO"); this.machine.move("ENVIANDO_PAQUETES"); this.machine.move("VALIDANDO_PAQUETES"); this.machine.move("ONLINE");
      return { status: "ONLINE" };
    } finally { this.recovering = false; }
  }
  private async releaseRetiredReservation(eventId: string | null) {
    const retirement = await this.store.retireNumberBlock(eventId);
    const result = await this.remote.action<{ estado?: string; desde?: number; hasta?: number }>({ action: "release-reservation", ...retirement });
    if (result.estado !== "CONCILIADA" || Number(result.desde) !== Number(retirement.desde) || Number(result.hasta) !== Number(retirement.hasta)) throw new Error("CIERRE_RESERVA_NO_CONFIRMADO");
    await this.store.confirmRetirement(retirement);
    return result;
  }
  async releaseUnusedReservation(session: LocalSession) {
    if (!isAdmin(session.role)) throw new Error("Solo administración puede cerrar la reserva.");
    assertPilotAdministration();
    if (this.recovering) throw new Error("RECUPERACION_EN_PROCESO");
    this.recovering = true;
    try {
      const result = await this.releaseRetiredReservation(null);
      if (!this.store.activeEvent() && !this.store.pendingRecoveryEvent() && !this.store.pendingCount() && !this.store.hasPendingRetirement()) {
        const previous = this.machine.state; const state = this.machine.closeEmptyRecovery();
        if (previous !== state) await this.store.setState(state, { resultado: "RESERVA_SIN_USO_CONCILIADA", comunicacionPendiente: true });
      }
      return result;
    } finally { this.recovering = false; }
  }
  async prepareManualCafc(session: LocalSession, input: Record<string, unknown>) {
    if (!isAdmin(session.role)) throw new Error("Operación reservada a administración.");
    assertContingencyPilotReady();
    assertCafcEnabled();
    const bundle = this.store.getBootstrap(); const localEvent = input.formulario
      ? this.store.closedEvent(String(asRecord(input.formulario).eventoId ?? ""))
      : this.store.pendingRecoveryEvent();
    if (!bundle?.agentId || !localEvent || !localEvent.cafcId || !localEvent.fechaFin) throw new Error("CAFC_EVENTO_CERRADO_NO_DISPONIBLE");
    const range = bundle.cafc.find((row) => row.id === localEvent.cafcId); const cufd = asRecord(localEvent.cufd);
    if (!range || !Object.keys(cufd).length) throw new Error("CAFC_AUTORIZACION_NO_DISPONIBLE");
    const snapshot = input.formulario
      ? snapshotManualCafc(asRecord(input.formulario), bundle, localEvent, session)
      : asRecord(input.snapshot) as unknown as InvoiceSnapshot;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const ventaId = input.ventaId == null || input.ventaId === "" ? null : String(input.ventaId);
    if (!uuid.test(String(snapshot.id ?? "")) || !uuid.test(String(snapshot.correlationId ?? "")) || (ventaId && !uuid.test(ventaId))
      || !/^[A-Za-z0-9:_-]{16,160}$/.test(String(input.idempotencyKey ?? "")) || input.originalRevisado !== true) throw new Error("CAFC_DATOS_ADMINISTRATIVOS_INVALIDOS");
    const originalText = String(input.originalBase64 ?? "").replace(/^data:[\w/+.-]+;base64,/, "");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(originalText)) throw new Error("CAFC_ORIGINAL_INVALIDO");
    const originalBytes = Buffer.from(originalText, "base64"); if (originalBytes.toString("base64") !== originalText) throw new Error("CAFC_ORIGINAL_INVALIDO");
    const artifactRoot = join(process.cwd(), "supabase", "functions", "_shared", "siat", "artifacts", "SIAT_VIGENTE");
    const event = { id: localEvent.id, tipo_evento_codigo: localEvent.tipoEventoCodigo, fecha_inicio: localEvent.fechaInicio, fecha_fin: localEvent.fechaFin,
      cufd_id: localEvent.cufdId, cafc_id: localEvent.cafcId, sucursal_id: bundle.branch.id, punto_venta_id: bundle.point?.id ?? null,
      codigo_sucursal: bundle.branch.codigo, codigo_punto_venta: bundle.point?.codigo ?? 0 };
    const result = prepareManualCafcXml({ snapshot, event, cufd, range, issuerNit: String(bundle.config.nit ?? ""), originalBytes,
      originalSha256: String(input.originalSha256 ?? ""), originalReviewed: true, now: new Date(),
      privateKeyPem: process.env.SIAT_PRIVATE_KEY_PEM?.replaceAll("\\n", "\n") ?? "", certificatePem: process.env.SIAT_CERTIFICATE_PEM?.replaceAll("\\n", "\n") ?? "",
      xsd: readFileSync(join(artifactRoot, "facturaElectronicaCompraVenta.xsd"), "utf8"), signatureXsd: readFileSync(join(artifactRoot, "SignatureSchema.xsd"), "utf8") });
    const compressedXml = gzipSync(Buffer.from(result.xml));
    return { facturaId: snapshot.id, eventoId: String(localEvent.id), cafcId: String(localEvent.cafcId), agenteId: bundle.agentId, correlationId: snapshot.correlationId,
      idempotencyKey: String(input.idempotencyKey), ventaId, xmlGzipBase64: compressedXml.toString("base64"), xmlSha256: sha256(compressedXml), originalBase64: originalText,
      originalSha256: result.originalSha256, fingerprint: result.fingerprint, originalRevisado: true };
  }
  private async syncInvoice(invoice: LocalInvoice) {
    const snapshot = invoice.snapshot; const local = asRecord(snapshot.local); const xmlGzip = this.store.readArtifact(invoice.xmlPath); const pdf = this.store.readArtifact(invoice.pdfPath);
    const payload = { ventaId: local.ventaId ?? invoice.id, facturaId: invoice.id, eventoId: invoice.eventId, idempotencyKey: invoice.idempotencyKey, correlationId: invoice.correlationId, actorAuthUserId: invoice.createdBy, codigoVenta: `OFF-${invoice.numeroFactura}`, clienteId: local.clienteId, metodoPago: local.metodoPago, observacion: local.observacion, descuentoVenta: local.descuentoVenta, items: local.items, modalidad: snapshot.modalidad, documentoSector: snapshot.documentoSector, tipoFactura: snapshot.tipoFactura, numeroFactura: invoice.numeroFactura, fechaEmision: invoice.fechaEmision, cuf: invoice.cuf, clienteSnapshot: snapshot.cliente, detalleSnapshot: snapshot.detalle, totalesSnapshot: snapshot.totales, pagoSnapshot: snapshot.pago, xmlHash: invoice.xmlHash, xmlFirmado: snapshot.modalidad === "ELECTRONICA", qrContenido: "consulta SIN", origenCaja: invoice.cajaId, payloadHash: invoice.xmlHash, versionXsd: "SIAT_VIGENTE", hashXsd: null, esManualCafc: Boolean(invoice.manualCafc), cafcId: invoice.manualCafc?.rangeId ?? null, numeroManual: invoice.manualCafc?.numero ?? null };
    const evidence = invoice.manualCafc ? this.store.readArtifact(invoice.manualCafc.evidencePath).toString("base64") : null;
    return this.remote.action<Record<string, unknown>>({ action: "import-invoice", factura: payload, xmlGzipBase64: xmlGzip.toString("base64"), pdfBase64: pdf.toString("base64"), evidenciaBase64: evidence, evidenciaMime: "application/octet-stream" }, 40_000);
  }
  document(invoiceId: string, type: "PDF" | "XML") { const invoice = this.store.listInvoices().find(item => item.id === invoiceId); if (!invoice) throw new Error("Documento local no encontrado."); const bytes = this.store.readArtifact(type === "PDF" ? invoice.pdfPath : invoice.xmlPath); return type === "XML" ? gunzipSync(bytes) : bytes; }
}

import { createClient } from "npm:@supabase/supabase-js@2";
import { SiatRepository } from "../_shared/siat/repository.ts";
import { classifyPilotNit, pilotCertificateEvidenceMatches, publicCertificateSha256 } from "../_shared/siat/pilot-approval.ts";
import { validateSignatureCredentials } from "../_shared/siat/signature-credentials.ts";
import { normalizeRecipient } from "../_shared/siat/notification-evidence.ts";
import { officialAdapter, siatRuntimeConfiguration } from "../_shared/siat/runtime.ts";

const row = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
export function validateCheckout(body: Record<string, unknown>) {
  if (body.confirmacion !== true || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(String(body.idempotencia))) throw Error("CONFIRMACION_VENTA_REQUERIDA");
  const entrega = row(body.entrega);
  if (!["NINGUNO", "CORREO", "WHATSAPP"].includes(String(entrega.canal))) throw Error("CANAL_INVALIDO");
  if (entrega.canal !== "NINGUNO") {
    if (entrega.consentimiento !== true) throw Error("CONFIRME_DESTINATARIO_Y_CONSENTIMIENTO");
    normalizeRecipient(entrega.canal as "CORREO" | "WHATSAPP", entrega.destinatario);
  }
  return { venta: row(body.venta), entrega };
}

export async function checkoutSale(body: Record<string, unknown>, request: Request, repository: SiatRepository, actor: string, dispatch: () => Promise<unknown>) {
  const { venta, entrega } = validateCheckout(body);
  const db = repository.db;
  // Autenticación del vendedor conservada en la RPC: nunca se suplanta auth.uid().
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: request.headers.get("authorization")! } }, auth: { persistSession: false } });
  const previous = await db.from("siat_checkout_ventas").select("actor,solicitud,venta_id,factura_id").eq("id", String(body.idempotencia)).maybeSingle();
  if (previous.error) throw previous.error;
  if (previous.data && previous.data.actor !== actor) throw Error("VENTA_NO_AUTORIZADA");
  if (!previous.data) {
    const check = await client.rpc("siat_preflight_venta", { p_venta: venta, p_codigos: false });
    if (check.error) throw check.error;
    const config = await repository.configuration();
    const secrets = siatRuntimeConfiguration();
    validateSignatureCredentials(secrets.privateKeyPem, secrets.certificatePem);
    const gate = await db.from("siat_piloto_control").select("*").eq("id", true).single();
    if (gate.error || !pilotCertificateEvidenceMatches(row(gate.data), await publicCertificateSha256(secrets.certificatePem))) throw Error("CERTIFICADO_REQUIERE_APROBACION_PILOTO");
    const cuis = await repository.activeCuis(config);
    if (!cuis) throw Error("CUIS_NO_VIGENTE_REQUIERE_ADMINISTRACION");
    if (!await repository.activeCufd(config, String(cuis.id))) {
      // Un único trabajo por CUIS/día. Un fallo o timeout no crea otra solicitud.
      const key = `checkout-cufd:${cuis.id}:${new Date().toISOString().slice(0,10)}`;
      const existing = await db.from("siat_outbox").select("estado").eq("idempotency_key", key).maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data && existing.data.estado !== "PENDIENTE") throw Error("CUFD_RENOVACION_PENDIENTE_O_INCIERTA_REQUIERE_REVISION");
      await repository.enqueue(null, "RENOVAR_CUFD", key, { actor, origen: "CHECKOUT", sinReintentoAutomatico: true });
      await dispatch();
      if (!await repository.activeCufd(config, String(cuis.id))) throw Error("CUFD_PENDIENTE_VENTA_NO_REGISTRADA");
    }
    const customer = await db.from("clientes").select("id,tipo_documento,numero_documento").eq("id", String(venta.cliente_id)).single();
    if (customer.error) throw customer.error;
    if (customer.data.tipo_documento === "NIT") {
      const evidence = await db.from("siat_cliente_nit_evidencias").select("documento,verificado_at").eq("cliente_id", customer.data.id).maybeSingle();
      if (evidence.error) throw evidence.error;
      if (evidence.data?.documento !== customer.data.numero_documento || Date.parse(evidence.data?.verificado_at ?? "") < Date.now()-86400000 || !evidence.data) {
        const branch = await repository.branch(String(config.sucursal_predeterminada_id));
        const response = await officialAdapter().verificarNit({ ambiente: "PRUEBAS", versionNormativa: "SIAT_VIGENTE", modalidad: "ELECTRONICA", codigoSistema: String(config.codigo_sistema), nit: String(config.nit), codigoSucursal: Number(branch.codigo), codigoPuntoVenta: null, cuis: String(cuis.codigo) }, customer.data.numero_documento);
        if (classifyPilotNit(response).resultado !== "ACTIVO") throw Error(`NIT_NO_CONFIRMADO: ${classifyPilotNit(response).resultado}`);
        const saved = await db.from("siat_cliente_nit_evidencias").upsert({ cliente_id: customer.data.id, documento: customer.data.numero_documento, ambiente: "PRUEBAS", codigo: 986, transaccion: true, verificado_at: new Date().toISOString() });
        if (saved.error) throw saved.error;
      }
    }
  }
  const result = await client.rpc("registrar_venta_checkout", { p_id: body.idempotencia, p_venta: venta, p_entrega: entrega });
  if (result.error) throw result.error;
  const saved = row(result.data);
  // Tras commit comercial, nunca convertir un timeout del worker en venta fallida.
  let procesamiento = "Procesamiento fiscal solicitado.";
  if (saved.reutilizada !== true) try { await dispatch(); } catch { procesamiento = "Venta registrada; resultado fiscal pendiente. No vuelva a registrar la venta."; }
  const invoice = await repository.invoice(String(saved.facturaId));
  const delivery = await db.from("siat_checkout_ventas").select("entrega_estado").eq("id", String(body.idempotencia)).single();
  return { ...saved, estadoFiscal: invoice.estado_fiscal, codigoEstado: invoice.codigo_estado, transaccion: invoice.transaccion, recepcionPersistida: Boolean(invoice.codigo_recepcion), entrega: delivery.data?.entrega_estado ?? "PENDIENTE", procesamiento };
}

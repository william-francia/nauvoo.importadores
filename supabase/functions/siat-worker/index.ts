import { SiatEngine, errorMessage } from "../_shared/siat/engine.ts";
import { SiatRepository } from "../_shared/siat/repository.ts";
import { json, officialAdapter, secureEquals, serviceClient } from "../_shared/siat/runtime.ts";
import { prepareFiscalSoapEvidence } from "../_shared/siat/fiscal-soap-evidence.ts";
import { xsdSiat } from "../_shared/siat/xsd-embebidos.ts";
import { probeContingencyDenial } from "../_shared/siat/contingency-probe.ts";

const permanentError = (message: string) => /XML inválido|snapshot|CUF|CUIS_NO_VIGENTE|CUIS_NO_CORRESPONDE|CUFD_NO_VIGENTE|CUFD_NO_CORRESPONDE|documento sector|tipo factura|configuracion fiscal|sucursal|punto de venta|totales|no está habilitado|SIAT_REENVIO_BLOQUEADO|SIAT_EMISION_NO_HABILITADA|PILOTO_EMISION_NO_AUTORIZADA|SOAP_EVIDENCIA_|PENDIENTE_DE_VERIFICACION_OFICIAL|CONTINGENCIA_PENDIENTE_VALIDACION_Y_AUTORIZACION/i.test(message);

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Método no permitido." }, 405);
  let body: Record<string, unknown> = {};
  try { const text = await request.text(); if (text) body = JSON.parse(text); }
  catch { return json({ error: "Solicitud inválida." }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Solicitud inválida." }, 400);
  const contingency = body.action === "contingency";
  const probe9b = body.action === "probe-9b-readonly";
  const allowContingency = Deno.env.get("SIAT_CONTINGENCIA_PILOTO_HABILITADA") === "true" && Boolean(Deno.env.get("SIAT_CONTINGENCIA_AGENTE_CODIGO"));
  if (contingency && !allowContingency) return json({ error: "CONTINGENCIA_PENDIENTE_VALIDACION_Y_AUTORIZACION" }, 409);
  const singleShot = body.action === "reconcile-held-invoice-once";
  const currentCufdShot = body.action === "reconcile-held-invoice-with-current-cufd-once";
  const configuredSecret = Deno.env.get("SIAT_WORKER_SECRET") ?? "";
  const workerAuthorized = Boolean(configuredSecret) && await secureEquals(request.headers.get("x-worker-secret") ?? "", configuredSecret);
  // La credencial de servicio solo permite consultas dirigidas, nunca drenar la cola.
  const serviceKey = singleShot || currentCufdShot || probe9b ? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "" : "";
  const serviceAuthorized = Boolean(serviceKey) && await secureEquals(request.headers.get("authorization") ?? "", `Bearer ${serviceKey}`);
  if ((!workerAuthorized && !serviceAuthorized) || (currentCufdShot && !serviceAuthorized)) return json({ error: "No autorizado." }, 401);
  if (body.action !== undefined && !singleShot && !currentCufdShot && !contingency && !probe9b) return json({ error: "Operación no permitida." }, 400);
  const db = serviceClient(); const repository = new SiatRepository(db);
  if (probe9b) {
    try { return json(await probeContingencyDenial((name, args) => db.rpc(name, args))); }
    catch { return json({ error: "PRUEBA_9B_RPC_NO_CONCLUYENTE" }, 409); }
  }
  const engine = new SiatEngine(repository, officialAdapter(), singleShot || currentCufdShot ? {} : {
    privateKeyPem: Deno.env.get("SIAT_PRIVATE_KEY_PEM"), certificatePem: Deno.env.get("SIAT_CERTIFICATE_PEM"),
  }, async (name) => xsdSiat(name),
  (invoice, operation, attempt) => prepareFiscalSoapEvidence(Deno.env.get("SIAT_SOAP_EVIDENCIA_KEY") ?? "", (name, args) => db.rpc(name, args), invoice, operation, attempt), contingency && allowContingency);
  if (singleShot || currentCufdShot) {
    try {
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (typeof body.facturaId !== "string" || !uuid.test(body.facturaId) || typeof body.outboxId !== "string" || !uuid.test(body.outboxId)) return json({ error: "Identificadores inválidos." }, 400);
      const [invoice, config] = await Promise.all([repository.invoice(body.facturaId), repository.configuration()]);
      if (config.ambiente !== "PRUEBAS" || config.siat_habilitado !== false || invoice.ambiente !== "PRUEBAS" || invoice.origen_fiscal !== "PILOTO"
        || !invoice.cuf || body.cuf !== invoice.cuf || !["ENVIANDO", "SIN_RESPUESTA", "CONCILIANDO"].includes(String(invoice.estado_fiscal))) return json({ error: "CONCILIACION_FUERA_DE_ALCANCE" }, 409);
      if (currentCufdShot && (body.facturaId !== "c2279bbb-e851-468b-afe6-8ebf0b436d28"
        || body.outboxId !== "e4d9ce8e-1c5c-4a08-94db-f4f50c3a8a0e" || invoice.codigo_estado !== 902)) {
        return json({ error: "CONCILIACION_CUFD_VIGENTE_FUERA_DE_ALCANCE" }, 409);
      }
      const currentCufd = currentCufdShot ? await repository.currentCufdForInvoice(invoice) : null;
      const job = currentCufd
        ? await repository.claimHeldReconciliationWithCurrentCufd(body.facturaId, body.outboxId, String(currentCufd.id))
        : await repository.claimHeldReconciliation(body.facturaId, body.outboxId);
      const response = await engine.reconcile(job, currentCufd ? { singleShot: true, currentCufd } : { singleShot: true });
      const current = await repository.invoice(body.facturaId);
      return json({ facturaId: body.facturaId, estadoFiscal: current.estado_fiscal, reenvioBloqueado: true, respuesta: response ? { codigoEstado: response.codigoEstado, codigoDescripcion: response.codigoDescripcion, codigoRecepcion: response.codigoRecepcion, transaccion: response.transaccion, mensajes: response.mensajes } : null });
    } catch (error) { return json({ error: errorMessage(error), reenvioBloqueado: true }, 409); }
  }
  const workerId = `edge-${crypto.randomUUID()}`; let processed = 0; const failures: string[] = [];
  const allowCancellation = Deno.env.get("SIAT_ANULACION_PILOTO_HABILITADA") === "true" && (Deno.env.get("SIAT_NOTIFICACION_HMAC_KEY") ?? "").length >= 32;
  for (let index = 0; index < 10; index += 1) {
    const job = contingency ? await repository.claimContingency(workerId, Deno.env.get("SIAT_CONTINGENCIA_AGENTE_CODIGO")!) : await repository.claim(workerId, allowCancellation); if (!job) break;
    try { await engine.process(job); processed += 1; }
    catch (error) { const message = errorMessage(error); failures.push(message); await repository.retryJob(String(job.id), Number(job.intentos ?? 1), message, permanentError(message)); }
  }
  return json({ processed, failures });
});

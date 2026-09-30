import { SiatRepository } from "../_shared/siat/repository.ts";
import { authenticatedUser, corsHeaders, json, officialAdapter, serviceClient, siatCredentialStatus } from "../_shared/siat/runtime.ts";
import { sanitizeErrorMessage } from "../_shared/siat/soap.ts";

const requests = new Map<string, { count: number; reset: number }>();
const rateLimit = (key: string, limit = 30) => {
  const now = Date.now(); const current = requests.get(key);
  if (!current || current.reset < now) { requests.set(key, { count: 1, reset: now + 60_000 }); return false; }
  current.count += 1; return current.count > limit;
};
const record = (value: unknown) => value && typeof value === "object" ? value as Record<string, unknown> : {};
const isAdmin = (role: string) => role.toLowerCase() === "administrador";

async function dispatchWorker() {
  const workerSecret = Deno.env.get("SIAT_WORKER_SECRET") ?? "";
  const baseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  if (!workerSecret || !baseUrl) throw new Error("La solicitud CUIS fue encolada, pero el worker SIAT no está configurado.");
  const response = await fetch(`${baseUrl}/functions/v1/siat-worker`, { method: "POST", headers: { "x-worker-secret": workerSecret } });
  const payload = record(await response.json().catch(() => ({})));
  if (!response.ok) throw new Error(`No fue posible activar el worker SIAT (HTTP ${response.status}).`);
  return { processed: Number(payload.processed ?? 0), failures: Array.isArray(payload.failures) ? payload.failures.map((item) => sanitizeErrorMessage(item)) : [] };
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (request.method !== "POST") return json({ error: "Método no permitido." }, 405, origin);
  try {
    const db = serviceClient(); const user = await authenticatedUser(request, db);
    if (rateLimit(user.authId)) return json({ error: "Demasiadas solicitudes. Intente nuevamente en un minuto." }, 429, origin);
    const body = record(await request.json()); const action = String(body.action ?? ""); const repository = new SiatRepository(db);
    if (action === "health") {
      const config = await repository.configuration();
      const [cuis, cufd, pending] = await Promise.all([
        db.from("siat_cuis").select("id,fecha_expiracion").eq("estado", "VIGENTE").gt("fecha_expiracion", new Date().toISOString()).order("fecha_expiracion", { ascending: false }).limit(1).maybeSingle(),
        db.from("siat_cufd").select("id,fecha_expiracion").eq("estado", "VIGENTE").order("fecha_expiracion", { ascending: false }).limit(1).maybeSingle(),
        db.from("siat_outbox").select("id", { count: "exact", head: true }).in("estado", ["PENDIENTE", "REINTENTAR", "PROCESANDO"]),
      ]);
      return json({ ambiente: config.ambiente, version: config.version_normativa, habilitado: config.siat_habilitado, credenciales: siatCredentialStatus(), conectividad: "NO_CONFIGURADO", cuis: cuis.data, cufd: cufd.data, ultimaVerificacionServicio: config.ultima_verificacion_servicio, ultimaSincronizacion: config.ultima_sincronizacion_exitosa, pendientes: pending.count ?? 0 }, 200, origin);
    }
    if (action === "verify-service") {
      if (!isAdmin(String(user.profile.rol))) throw new Error("Operación reservada a administración.");
      const response = await officialAdapter().verificarComunicacion();
      if (response.transaccion === true) {
        const { error } = await db.from("siat_configuracion").update({ ultima_verificacion_servicio: new Date().toISOString() }).eq("id", true);
        if (error) throw error;
      }
      const { error: auditError } = await db.from("siat_auditoria").insert({ actor_auth_user_id: user.authId, entidad: "siat_configuracion", entidad_id: "true", accion: "VERIFICAR_COMUNICACION", contexto: { codigoEstado: response.codigoEstado, mensajes: response.mensajes.map((item) => ({ codigo: item.codigo, descripcion: item.descripcion })) }, resultado: response.transaccion === true ? "EXITOSO" : "RECHAZADO" });
      if (auditError) throw auditError;
      return json({ transaccion: response.transaccion, codigoEstado: response.codigoEstado, mensajes: response.mensajes }, 200, origin);
    }
    if (action === "request-cuis") {
      if (!isAdmin(String(user.profile.rol))) throw new Error("Operación reservada a administración.");
      const config = await repository.configuration();
      if (!config.ultima_verificacion_servicio) throw new Error("Primero verifica la comunicación real con SIAT Piloto.");
      await repository.enqueue(null, "RENOVAR_CUIS", `renovar_cuis:${new Date().toISOString().slice(0, 10)}`, { actor: user.authId, origen: "ADMINISTRACION" });
      const worker = await dispatchWorker();
      return json({ estado: worker.processed > 0 ? "PROCESADA" : "EN_COLA", worker }, 202, origin);
    }
    if (["request-cufd", "sync", "prepare-invoice", "cancel", "reverse"].includes(action)) {
      return json({ error: "Esta operación fiscal permanece bloqueada hasta un paso posterior." }, 409, origin);
    }
    if (action === "prepare-invoice") {
      if (!["administrador", "vendedor", "caja"].includes(String(user.profile.rol).toLowerCase())) throw new Error("Su rol no puede emitir facturas fiscales.");
      const ventaId = String(body.ventaId ?? ""); if (!/^[0-9a-f-]{36}$/i.test(ventaId)) throw new Error("Venta inválida.");
      const { data, error } = await db.rpc("siat_crear_factura_outbox", { p_venta_id: ventaId }); if (error) throw error;
      return json({ facturaId: data, estado: data ? "EN_COLA" : "SIAT_DESHABILITADO" }, 202, origin);
    }
    if (action === "cancel" || action === "reverse") {
      if (!isAdmin(String(user.profile.rol))) throw new Error("Operación reservada a administración o supervisión.");
      const facturaId = String(body.facturaId ?? ""); const motivo = body.motivo == null ? null : Number(body.motivo);
      const { data, error } = await db.rpc("siat_solicitar_operacion_factura", { p_factura_id: facturaId, p_operacion: action === "cancel" ? "ANULAR" : "REVERTIR_ANULACION", p_actor_auth_user_id: user.authId, p_motivo_codigo: motivo });
      if (error) throw error; return json({ estado: data }, 202, origin);
    }
    if (action === "download") {
      if (!["administrador", "vendedor", "caja"].includes(String(user.profile.rol).toLowerCase())) throw new Error("Su rol no puede descargar documentos fiscales.");
      const facturaId = String(body.facturaId ?? ""); const type = String(body.type ?? "").toUpperCase(); const invoice = await repository.invoice(facturaId);
      if (type !== "PDF" && type !== "XML") throw new Error("Tipo de documento fiscal no permitido.");
      const path = type === "PDF" ? invoice.pdf_storage_path : type === "XML" ? invoice.xml_storage_path : null;
      if (!path) { await db.from("siat_entregas_documentos").insert({ factura_id: facturaId, tipo: type, actor_auth_user_id: user.authId, resultado: "FALLIDA", detalle: "Documento aún no disponible" }); throw new Error(`El ${type} fiscal todavía no está disponible.`); }
      return json({ url: await repository.signedDocument(facturaId, String(path), type as "PDF" | "XML", user.authId), expiresIn: 120 }, 200, origin);
    }
    throw new Error("Acción SIAT no soportada.");
  } catch (error) {
    const message = sanitizeErrorMessage(error) || "Error interno.";
    const status = /Sesión|autorizado|permisos|reservada/i.test(message) ? 403 : 400;
    return json({ error: message }, status, origin);
  }
});

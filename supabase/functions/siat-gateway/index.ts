import { SiatRepository } from "../_shared/siat/repository.ts";
import { authenticatedUser, corsHeaders, json, officialAdapter, serviceClient } from "../_shared/siat/runtime.ts";

const requests = new Map<string, { count: number; reset: number }>();
const rateLimit = (key: string, limit = 30) => {
  const now = Date.now(); const current = requests.get(key);
  if (!current || current.reset < now) { requests.set(key, { count: 1, reset: now + 60_000 }); return false; }
  current.count += 1; return current.count > limit;
};
const record = (value: unknown) => value && typeof value === "object" ? value as Record<string, unknown> : {};
const isAdmin = (role: string) => role.toLowerCase() === "administrador";

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
        db.from("siat_cuis").select("id,fecha_expiracion").eq("estado", "VIGENTE").order("fecha_expiracion", { ascending: false }).limit(1).maybeSingle(),
        db.from("siat_cufd").select("id,fecha_expiracion").eq("estado", "VIGENTE").order("fecha_expiracion", { ascending: false }).limit(1).maybeSingle(),
        db.from("siat_outbox").select("id", { count: "exact", head: true }).in("estado", ["PENDIENTE", "REINTENTAR", "PROCESANDO"]),
      ]);
      return json({ ambiente: config.ambiente, version: config.version_normativa, habilitado: config.siat_habilitado, secretos: { token: Boolean(Deno.env.get("SIAT_TOKEN_DELEGADO")), firma: Boolean(Deno.env.get("SIAT_PRIVATE_KEY_PEM") && Deno.env.get("SIAT_CERTIFICATE_PEM")) }, cuis: cuis.data, cufd: cufd.data, ultimaSincronizacion: config.ultima_sincronizacion_exitosa, pendientes: pending.count ?? 0 }, 200, origin);
    }
    if (action === "verify-service") {
      if (!isAdmin(String(user.profile.rol))) throw new Error("Operación reservada a administración.");
      const response = await officialAdapter().verificarComunicacion();
      await db.from("siat_configuracion").update({ ultima_verificacion_servicio: new Date().toISOString() }).eq("id", true);
      return json({ transaccion: response.transaccion, codigoEstado: response.codigoEstado, mensajes: response.mensajes }, 200, origin);
    }
    if (["request-cuis", "request-cufd", "sync"].includes(action)) {
      if (!isAdmin(String(user.profile.rol))) throw new Error("Operación reservada a administración.");
      const type = action === "request-cuis" ? "RENOVAR_CUIS" : action === "request-cufd" ? "RENOVAR_CUFD" : "SINCRONIZAR_CATALOGOS";
      await repository.enqueue(null, type, `${type.toLowerCase()}:${new Date().toISOString().slice(0, 10)}`, { actor: user.authId });
      return json({ estado: "EN_COLA" }, 202, origin);
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
    const message = error instanceof Error ? error.message : "Error interno.";
    const status = /Sesión|autorizado|permisos|reservada/i.test(message) ? 403 : 400;
    return json({ error: message.replace(/TokenApi\s+\S+/gi, "TokenApi [REDACTED]").slice(0, 500) }, status, origin);
  }
});

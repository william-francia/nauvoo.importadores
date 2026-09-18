import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

const fail = (error: { message?: string } | null, fallback: string): never => { throw new Error(error?.message || fallback); };

export class SiatRepository {
  constructor(readonly db: SupabaseClient) {}

  async configuration() {
    const { data, error } = await this.db.from("siat_configuracion").select("*").eq("id", true).single();
    if (error || !data) fail(error, "Configuración SIAT no disponible.");
    return data as Record<string, unknown>;
  }

  async claim(workerId: string) {
    const { data, error } = await this.db.rpc("siat_reclamar_outbox", { p_worker_id: workerId, p_lock_segundos: 120 });
    if (error) fail(error, "No se pudo reclamar el outbox.");
    return (data?.[0] ?? null) as Record<string, unknown> | null;
  }

  async invoice(id: string) {
    const { data, error } = await this.db.from("facturas_siat").select("*").eq("id", id).single();
    if (error || !data) fail(error, "Factura SIAT no encontrada.");
    return data as Record<string, unknown>;
  }

  async branch(id: string) {
    const { data, error } = await this.db.from("siat_sucursales").select("*").eq("id", id).single();
    if (error || !data) fail(error, "Sucursal SIAT no encontrada.");
    return data as Record<string, unknown>;
  }

  async cufd(id: string) {
    const { data, error } = await this.db.from("siat_cufd").select("*").eq("id", id).single();
    if (error || !data) fail(error, "CUFD de la factura no encontrado.");
    return data as Record<string, unknown>;
  }

  async event(id: string) {
    const { data, error } = await this.db.from("siat_eventos_significativos").select("*").eq("id", id).single();
    if (error || !data) fail(error, "Evento significativo no encontrado.");
    return data as Record<string, unknown>;
  }

  async package(id: string) {
    const { data, error } = await this.db.from("siat_paquetes").select("*").eq("id", id).single();
    if (error || !data) fail(error, "Paquete SIAT no encontrado.");
    return data as Record<string, unknown>;
  }

  async cafc(id: string) {
    const { data, error } = await this.db.from("siat_rangos_cafc").select("*").eq("id", id).single();
    if (error || !data) fail(error, "Rango CAFC no encontrado.");
    return data as Record<string, unknown>;
  }

  async activeFiscalCodes(sucursalId: string, puntoVentaId: string | null, ambiente: string) {
    let cuisQuery = this.db.from("siat_cuis").select("*").eq("sucursal_id", sucursalId).eq("ambiente", ambiente).eq("estado", "VIGENTE");
    cuisQuery = puntoVentaId ? cuisQuery.eq("punto_venta_id", puntoVentaId) : cuisQuery.is("punto_venta_id", null);
    const { data: cuis, error: cuisError } = await cuisQuery.order("fecha_expiracion", { ascending: false }).limit(1).maybeSingle();
    if (cuisError || !cuis) fail(cuisError, "CUIS vigente no encontrado para recuperación.");
    let cufdQuery = this.db.from("siat_cufd").select("*").eq("sucursal_id", sucursalId).eq("cuis_id", cuis.id).eq("ambiente", ambiente).eq("estado", "VIGENTE").gt("fecha_expiracion", new Date().toISOString());
    cufdQuery = puntoVentaId ? cufdQuery.eq("punto_venta_id", puntoVentaId) : cufdQuery.is("punto_venta_id", null);
    const { data: cufd, error: cufdError } = await cufdQuery.order("fecha_expiracion", { ascending: false }).limit(1).maybeSingle();
    if (cufdError || !cufd) fail(cufdError, "CUFD nuevo vigente no encontrado para recuperación.");
    return { cuis: cuis as Record<string, unknown>, cufd: cufd as Record<string, unknown> };
  }

  async updateEvent(id: string, values: Record<string, unknown>) {
    const { error } = await this.db.from("siat_eventos_significativos").update({ ...values, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) fail(error, "No se pudo actualizar el evento SIAT.");
  }

  async updatePackage(id: string, values: Record<string, unknown>) {
    const { error } = await this.db.from("siat_paquetes").update({ ...values, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) fail(error, "No se pudo actualizar el paquete SIAT.");
  }

  async offlineInvoices(eventId: string) {
    const { data, error } = await this.db.from("facturas_siat").select("*").eq("evento_id", eventId).eq("tipo_emision", "OFFLINE").eq("estado_fiscal", "OFFLINE").order("fecha_emision");
    if (error) fail(error, "No se pudieron consultar las facturas offline.");
    return (data ?? []) as Array<Record<string, unknown>>;
  }

  async packageInvoices(packageId: string) {
    const { data, error } = await this.db.from("siat_paquete_facturas").select("posicion,factura:facturas_siat(*)").eq("paquete_id", packageId).order("posicion");
    if (error) fail(error, "No se pudieron consultar las facturas del paquete.");
    return (data ?? []).map((row) => ({ posicion: Number(row.posicion), factura: (Array.isArray(row.factura) ? row.factura[0] : row.factura) as Record<string, unknown> }));
  }

  async createPackage(eventId: string, invoiceIds: string[], hash: string, path: string) {
    const { data, error } = await this.db.rpc("siat_crear_paquete_evento", { p_evento_id: eventId, p_factura_ids: invoiceIds, p_archivo_hash: hash, p_storage_path: path });
    if (error || !data) fail(error, "No se pudo crear el paquete SIAT.");
    return String(data);
  }

  async download(path: string) {
    const { data, error } = await this.db.storage.from("siat-documentos").download(path);
    if (error) fail(error, "No se pudo recuperar el archivo fiscal privado.");
    if (!data) throw new Error("No se pudo recuperar el archivo fiscal privado.");
    return new Uint8Array(await data.arrayBuffer());
  }

  async finishPackage(id: string, state: "VALIDADA" | "OBSERVADA", messages: unknown[]) {
    const links = await this.packageInvoices(id);
    for (const link of links) await this.updateInvoice(String(link.factura.id), { estado_fiscal: state, mensajes_siat: messages, fecha_validacion: state === "VALIDADA" ? new Date().toISOString() : null });
  }

  async refreshEventFromPackages(eventId: string) {
    const { data, error } = await this.db.from("siat_paquetes").select("estado").eq("evento_id", eventId);
    if (error) fail(error, "No se pudo consolidar el evento.");
    const states = (data ?? []).map((item) => String(item.estado));
    if (!states.length || states.some((state) => !["VALIDADO", "OBSERVADO", "RECHAZADO", "CON_ERROR"].includes(state))) return;
    const finalState = states.every((state) => state === "VALIDADO") ? "VALIDADO" : "OBSERVADO";
    await this.updateEvent(eventId, { estado: finalState });
    const event = await this.event(eventId);
    if (event.agente_local_id) {
      await this.db.from("siat_estado_operativo").update({ estado: finalState === "VALIDADO" ? "ONLINE" : "DEGRADADO", evento_id: null, changed_at: new Date().toISOString(), evidencia: { paquetes: states } }).eq("agente_id", event.agente_local_id);
    }
  }

  async point(id: string) {
    const { data, error } = await this.db.from("siat_puntos_venta").select("*").eq("id", id).single();
    if (error || !data) fail(error, "Punto de venta SIAT no encontrado.");
    return data as Record<string, unknown>;
  }

  async updateInvoice(id: string, values: Record<string, unknown>) {
    const { error } = await this.db.from("facturas_siat").update({ ...values, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) fail(error, "No se pudo actualizar la factura SIAT.");
  }

  async completeJob(id: string) {
    const { error } = await this.db.from("siat_outbox").update({ estado: "COMPLETADA", processed_at: new Date().toISOString(), locked_by: null, locked_until: null, ultimo_error: null }).eq("id", id).eq("estado", "PROCESANDO");
    if (error) fail(error, "No se pudo completar el outbox.");
  }

  async retryJob(id: string, attempts: number, errorMessage: string, permanent = false) {
    const backoffMinutes = Math.min(60, 2 ** Math.max(0, attempts - 1));
    const { error } = await this.db.from("siat_outbox").update({
      estado: permanent || attempts >= 8 ? "FALLIDA" : "REINTENTAR",
      disponible_desde: new Date(Date.now() + backoffMinutes * 60_000).toISOString(),
      locked_by: null, locked_until: null, ultimo_error: errorMessage.slice(0, 500),
    }).eq("id", id);
    if (error) fail(error, "No se pudo reprogramar el outbox.");
  }

  async enqueue(facturaId: string | null, type: string, idempotencyKey: string, payload: Record<string, unknown>) {
    const { error } = await this.db.from("siat_outbox").upsert({ factura_id: facturaId, tipo_tarea: type, idempotency_key: idempotencyKey, payload, estado: "PENDIENTE", disponible_desde: new Date().toISOString() }, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (error) fail(error, "No se pudo encolar la operación SIAT.");
  }

  async attempt(values: Record<string, unknown>) {
    const { data, error } = await this.db.from("siat_intentos_envio").insert(values).select("id").single();
    if (error) fail(error, "No se pudo registrar el intento SIAT.");
    if (!data) throw new Error("No se pudo registrar el intento SIAT.");
    return String(data.id);
  }

  async finishAttempt(id: string, values: Record<string, unknown>) {
    const { error } = await this.db.from("siat_intentos_envio").update({ ...values, finalizado_at: new Date().toISOString() }).eq("id", id);
    if (error) fail(error, "No se pudo finalizar el intento SIAT.");
  }

  async audit(facturaId: string, action: string, before: string | null, after: string | null, context: Record<string, unknown>, result = "EXITOSO") {
    const { error } = await this.db.from("siat_auditoria").insert({ entidad: "facturas_siat", entidad_id: facturaId, accion: action, estado_anterior: before ? { estado: before } : null, estado_nuevo: after ? { estado: after } : null, contexto: context, resultado: result });
    if (error) fail(error, "No se pudo registrar la auditoría SIAT.");
  }

  async auditEntity(entity: string, entityId: string, action: string, before: string | null, after: string | null, context: Record<string, unknown>, result = "EXITOSO") {
    const { error } = await this.db.from("siat_auditoria").insert({ entidad: entity, entidad_id: entityId, accion: action, estado_anterior: before ? { estado: before } : null, estado_nuevo: after ? { estado: after } : null, contexto: context, resultado: result });
    if (error) fail(error, "No se pudo registrar la auditoría SIAT.");
  }

  async store(path: string, bytes: Uint8Array, contentType: string) {
    const { error } = await this.db.storage.from("siat-documentos").upload(path, bytes, { contentType, upsert: true });
    if (error) fail(error, "No se pudo guardar el documento fiscal privado.");
  }

  async signedDocument(facturaId: string, path: string, type: "PDF" | "XML", actorId: string) {
    const { data, error } = await this.db.storage.from("siat-documentos").createSignedUrl(path, 120, { download: true });
    if (error || !data) fail(error, "No se pudo generar el enlace temporal.");
    if (!data) throw new Error("No se pudo generar el enlace temporal.");
    await this.db.from("siat_entregas_documentos").insert({ factura_id: facturaId, tipo: type, actor_auth_user_id: actorId, resultado: "EXITOSA", detalle: "Enlace privado temporal de 120 segundos" });
    return data.signedUrl;
  }

  async activeCuis(config: Record<string, unknown>) {
    let query = this.db.from("siat_cuis").select("*")
      .eq("sucursal_id", config.sucursal_predeterminada_id).eq("ambiente", config.ambiente).eq("estado", "VIGENTE");
    query = config.punto_venta_predeterminado_id ? query.eq("punto_venta_id", config.punto_venta_predeterminado_id) : query.is("punto_venta_id", null);
    const { data, error } = await query.order("fecha_expiracion", { ascending: false }).limit(1).maybeSingle();
    if (error) fail(error, "No se pudo consultar CUIS.");
    return data as Record<string, unknown> | null;
  }

  async saveCuis(config: Record<string, unknown>, result: { codigo: string; fechaVigencia: string | null }) {
    const { error } = await this.db.rpc("siat_guardar_cuis", { p_sucursal_id: config.sucursal_predeterminada_id, p_punto_venta_id: config.punto_venta_predeterminado_id, p_ambiente: config.ambiente, p_codigo: result.codigo, p_fecha_expiracion: result.fechaVigencia });
    if (error) fail(error, "No se pudo guardar el CUIS.");
  }

  async saveCufd(config: Record<string, unknown>, cuisId: string, result: { codigo: string; codigoControl: string; direccion: string | null; fechaVigencia: string }) {
    const { error } = await this.db.rpc("siat_guardar_cufd", { p_sucursal_id: config.sucursal_predeterminada_id, p_punto_venta_id: config.punto_venta_predeterminado_id, p_cuis_id: cuisId, p_ambiente: config.ambiente, p_codigo: result.codigo, p_codigo_control: result.codigoControl, p_direccion: result.direccion, p_fecha_expiracion: result.fechaVigencia });
    if (error) fail(error, "No se pudo guardar el CUFD.");
  }
}

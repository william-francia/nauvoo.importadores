import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { pilotCertificateEvidenceMatches, pilotIdentityAllowed } from "./pilot-approval.ts";
import { assertCurrentFiscalCodes } from "./fiscal-operation.ts";

const fail = (error: { message?: string } | null, fallback: string): never => { throw new Error(error?.message || fallback); };

export class SiatRepository {
  constructor(readonly db: SupabaseClient) {}

  async configuration() {
    const { data, error } = await this.db.from("siat_configuracion").select("*").eq("id", true).single();
    if (error || !data) fail(error, "Configuración SIAT no disponible.");
    return data as Record<string, unknown>;
  }

  async claim(workerId: string, allowCancellation = false) {
    const { data, error } = await this.db.rpc("siat_reclamar_outbox_9a", { p_worker_id: workerId, p_lock_segundos: 120, p_habilitar_anulacion: allowCancellation });
    if (error) fail(error, "No se pudo reclamar el outbox.");
    return (data?.[0] ?? null) as Record<string, unknown> | null;
  }

  async claimContingency(workerId: string, agentCode: string) {
    const { data, error } = await this.db.rpc("siat_reclamar_outbox_9b", { p_worker: workerId, p_agente: agentCode });
    if (error) fail(error, "No se pudo reclamar contingencia.");
    return (data?.[0] ?? null) as Record<string, unknown> | null;
  }
  async markRecoveryCufdStarted(id: string) {
    const { data, error } = await this.db.rpc("siat_9b_marcar_cufd", { p_job: id });
    if (error) fail(error, "No se pudo asegurar solicitud CUFD.");
    return data === true;
  }
  async invoice(id: string) {
    const { data, error } = await this.db.from("facturas_siat").select("*").eq("id", id).single();
    if (error || !data) fail(error, "Factura SIAT no encontrada.");
    return data as Record<string, unknown>;
  }

  async pilotEmissionAllowed(invoice: Record<string, unknown>, job: Record<string, unknown>, certificateHash: string): Promise<boolean> {
    if (invoice.origen_fiscal !== "PILOTO" || invoice.ambiente !== "PRUEBAS" || invoice.venta_id !== null || !invoice.piloto_autorizacion_id) return false;
    const payload = job.payload && typeof job.payload === "object" ? job.payload as Record<string, unknown> : {};
    if (payload.origenFiscal !== "PILOTO" || payload.autorizacionId !== invoice.piloto_autorizacion_id) return false;
    const [gate, authorization] = await Promise.all([
      this.db.from("siat_piloto_control").select("emision_habilitada,autorizacion_habilitada_id,eku_fiscal_aprobado,eku_tipo_evidencia,eku_alcance,eku_declaracion_at,eku_aprobado_por,nit_cliente_verificado,nit_cliente_id,nit_cliente_documento,nit_ambiente,nit_codigo_respuesta,nit_verificado_at,eku_cert_sha256,eku_aprobado_at").eq("id", true).single(),
      this.db.from("siat_piloto_autorizaciones").select("estado,cliente_id").eq("id", String(invoice.piloto_autorizacion_id)).single(),
    ]);
    if (gate.error || authorization.error) throw new Error("PILOTO_CONTROL_NO_DISPONIBLE");
    if (gate.data?.emision_habilitada !== true || gate.data?.autorizacion_habilitada_id !== invoice.piloto_autorizacion_id
      || authorization.data?.estado !== "CONSUMIDA"
      || !pilotCertificateEvidenceMatches(gate.data, certificateHash)) return false;
    const client = await this.db.from("clientes").select("id,codigo_cliente,nombre_razon_social,tipo_documento,numero_documento,complemento,activo").eq("id", authorization.data.cliente_id).single();
    if (client.error || !client.data || invoice.numero_documento !== client.data.numero_documento || invoice.tipo_documento !== client.data.tipo_documento) return false;
    return pilotIdentityAllowed(gate.data, client.data, invoice.ambiente);
  }

  async branch(id: string) {
    const { data, error } = await this.db.from("siat_sucursales").select("*").eq("id", id).single();
    if (error || !data) fail(error, "Sucursal SIAT no encontrada.");
    return data as Record<string, unknown>;
  }

  async cuis(id: string) {
    const { data, error } = await this.db.from("siat_cuis").select("*").eq("id", id).single();
    if (error || !data) fail(error, "CUIS de la factura no encontrado.");
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

  async activeCuisForScope(sucursalId: string, puntoVentaId: string | null, ambiente: string) {
    const now = new Date().toISOString();
    let cuisQuery = this.db.from("siat_cuis").select("*").eq("sucursal_id", sucursalId).eq("ambiente", ambiente).eq("estado", "VIGENTE").gt("fecha_expiracion", now);
    cuisQuery = puntoVentaId ? cuisQuery.eq("punto_venta_id", puntoVentaId) : cuisQuery.is("punto_venta_id", null);
    const { data: cuis, error: cuisError } = await cuisQuery.order("fecha_expiracion", { ascending: false }).limit(1).maybeSingle();
    if (cuisError || !cuis) fail(cuisError, "CUIS vigente no encontrado para recuperación.");
    return cuis as Record<string, unknown>;
  }

  async activeFiscalCodes(sucursalId: string, puntoVentaId: string | null, ambiente: string) {
    const now = new Date().toISOString();
    const cuis = await this.activeCuisForScope(sucursalId, puntoVentaId, ambiente);
    let cufdQuery = this.db.from("siat_cufd").select("*").eq("sucursal_id", sucursalId).eq("cuis_id", cuis.id).eq("ambiente", ambiente).eq("estado", "VIGENTE").lte("fecha_inicio", now).gt("fecha_expiracion", now);
    cufdQuery = puntoVentaId ? cufdQuery.eq("punto_venta_id", puntoVentaId) : cufdQuery.is("punto_venta_id", null);
    const { data: cufd, error: cufdError } = await cufdQuery.order("fecha_expiracion", { ascending: false }).limit(1).maybeSingle();
    if (cufdError || !cufd) fail(cufdError, "CUFD nuevo vigente no encontrado para recuperación.");
    assertCurrentFiscalCodes({ sucursal_id: sucursalId, punto_venta_id: puntoVentaId, ambiente }, cuis, cufd);
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
    const { data, error } = await this.db.from("facturas_siat").select("*").eq("evento_id", eventId).eq("tipo_emision", "OFFLINE").eq("estado_fiscal", "OFFLINE").order("fecha_emision").order("id");
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
    for (const link of links) {
      if (link.factura.estado_fiscal === state) continue;
      if (!await this.updateInvoiceIfState(String(link.factura.id), "EMPAQUETADA", { estado_fiscal: state, mensajes_siat: messages, fecha_validacion: state === "VALIDADA" ? new Date().toISOString() : null })) throw new Error("FACTURA_PAQUETE_CAMBIO_CONCURRENTE");
    }
  }

  async refreshEventFromPackages(eventId: string) {
    // Conteos exactos evitan tratar como completo un resultado paginado por Supabase.
    const [packages, active, notValid, invoices, invoicesNotValid] = await Promise.all([
      this.db.from("siat_paquetes").select("id", { count: "exact", head: true }).eq("evento_id", eventId),
      this.db.from("siat_paquetes").select("id", { count: "exact", head: true }).eq("evento_id", eventId).in("estado", ["PENDIENTE", "GENERANDO", "EN_COLA", "ENVIADO", "RECEPCIONADO", "VALIDANDO", "SIN_RESPUESTA", "CONCILIANDO"]),
      this.db.from("siat_paquetes").select("id", { count: "exact", head: true }).eq("evento_id", eventId).not("estado", "in", "(VALIDADO,OBSERVADO)"),
      this.db.from("facturas_siat").select("id", { count: "exact", head: true }).eq("evento_id", eventId).eq("tipo_emision", "OFFLINE"),
      this.db.from("facturas_siat").select("id", { count: "exact", head: true }).eq("evento_id", eventId).eq("tipo_emision", "OFFLINE").neq("estado_fiscal", "VALIDADA"),
    ]);
    const failure = [packages, active, notValid, invoices, invoicesNotValid].find((result) => result.error || result.count == null);
    if (failure) fail(failure.error, "No se pudo consolidar el evento.");
    if (!packages.count || active.count) return;
    const finalState = notValid.count === 0 && Boolean(invoices.count) && invoicesNotValid.count === 0 ? "VALIDADO" : "OBSERVADO";
    await this.updateEvent(eventId, { estado: finalState });
    // El agente solo podrá volver a ONLINE tras verificar el circuito remoto completo.
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

  async updateInvoiceIfState(id: string, expectedState: string, values: Record<string, unknown>): Promise<boolean> {
    const { data, error } = await this.db.from("facturas_siat").update({ ...values, updated_at: new Date().toISOString() })
      .eq("id", id).eq("estado_fiscal", expectedState).select("id").maybeSingle();
    if (error) fail(error, "No se pudo actualizar la factura SIAT de forma condicionada.");
    return Boolean(data);
  }

  async completeJob(id: string) {
    const { error } = await this.db.from("siat_outbox").update({ estado: "COMPLETADA", processed_at: new Date().toISOString(), locked_by: null, locked_until: null, ultimo_error: null }).eq("id", id).eq("estado", "PROCESANDO");
    if (error) fail(error, "No se pudo completar el outbox.");
  }

  // Se persiste antes de la llamada: tras caída o concurrencia nunca se vuelve a transmitir.
  async markFiscalMutationStarted(job: Record<string, unknown>): Promise<boolean> {
    const payload = job.payload && typeof job.payload === "object" ? job.payload as Record<string, unknown> : {};
    const { data, error } = await this.db.from("siat_outbox")
      .update({ payload: { ...payload, transmisionFiscalIniciadaAt: new Date().toISOString() } })
      .eq("id", String(job.id)).eq("estado", "PROCESANDO")
      .is("payload->transmisionFiscalIniciadaAt", null).select("id").maybeSingle();
    if (error) fail(error, "No se pudo asegurar la transmisión fiscal única.");
    return Boolean(data);
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

  async stopJob(id: string, message: string) {
    const { error } = await this.db.from("siat_outbox").update({ estado: "FALLIDA", locked_by: null, locked_until: null, ultimo_error: message.slice(0, 500) }).eq("id", id).eq("estado", "PROCESANDO");
    if (error) fail(error, "No se pudo detener el outbox SIAT.");
  }

  async claimHeldReconciliation(invoiceId: string, outboxId: string) {
    const { data: job, error } = await this.db.from("siat_outbox").select("*").eq("id", outboxId).eq("factura_id", invoiceId).eq("estado", "CANCELADA").single();
    if (error || !job || job.payload?.reenvioAutomaticoBloqueado !== true || job.locked_by || job.locked_until) throw new Error("CONCILIACION_REQUIERE_ENVIO_RETENIDO");
    // Compare-and-set: ni doble clic, concurrencia ni timeout pueden repetir la consulta.
    const { data: claimed, error: claimError } = await this.db.from("siat_outbox").update({ payload: { ...job.payload, conciliacionUnicaIniciadaAt: new Date().toISOString() } })
      .eq("id", outboxId).eq("factura_id", invoiceId).eq("estado", "CANCELADA")
      .eq("payload->>reenvioAutomaticoBloqueado", "true").is("locked_by", null).is("locked_until", null)
      .is("payload->conciliacionUnicaIniciadaAt", null).select("*").maybeSingle();
    if (claimError) fail(claimError, "No se pudo reservar la consulta única.");
    if (!claimed) throw new Error("CONCILIACION_UNICA_YA_SOLICITADA");
    return claimed as Record<string, unknown>;
  }

  async currentCufdForInvoice(invoice: Record<string, unknown>) {
    const cuis = await this.cuis(String(invoice.cuis_id ?? ""));
    const now = new Date().toISOString();
    if (invoice.ambiente !== "PRUEBAS" || cuis.estado !== "VIGENTE" || cuis.ambiente !== invoice.ambiente
      || cuis.sucursal_id !== invoice.sucursal_id || (cuis.punto_venta_id ?? null) !== (invoice.punto_venta_id ?? null)
      || cuis.codigo !== invoice.cuis || !Number.isFinite(Date.parse(String(cuis.fecha_expiracion ?? "")))
      || Date.parse(String(cuis.fecha_expiracion)) <= Date.parse(now)) {
      throw new Error("CONCILIACION_CUIS_NO_VIGENTE_O_NO_CORRESPONDE");
    }
    let query = this.db.from("siat_cufd").select("id,codigo,cuis_id,sucursal_id,punto_venta_id,ambiente,estado,fecha_inicio,fecha_expiracion")
      .eq("cuis_id", cuis.id).eq("sucursal_id", invoice.sucursal_id).eq("ambiente", invoice.ambiente)
      .eq("estado", "VIGENTE").lte("fecha_inicio", now).gt("fecha_expiracion", now);
    query = invoice.punto_venta_id ? query.eq("punto_venta_id", invoice.punto_venta_id) : query.is("punto_venta_id", null);
    const { data, error } = await query.order("fecha_expiracion", { ascending: false }).limit(1).maybeSingle();
    if (error) fail(error, "No se pudo consultar CUFD vigente para conciliación.");
    if (!data || !String(data.codigo ?? "").trim()) throw new Error("CONCILIACION_CUFD_VIGENTE_NO_DISPONIBLE");
    return data as Record<string, unknown>;
  }

  async claimHeldReconciliationWithCurrentCufd(invoiceId: string, outboxId: string, cufdId: string) {
    const { data: job, error } = await this.db.from("siat_outbox").select("*")
      .eq("id", outboxId).eq("factura_id", invoiceId).eq("estado", "CANCELADA").single();
    if (error || !job || job.payload?.reenvioAutomaticoBloqueado !== true
      || !job.payload?.conciliacionUnicaIniciadaAt || job.locked_by || job.locked_until) {
      throw new Error("CONCILIACION_REQUIERE_ENVIO_RETENIDO_Y_CONSULTA_PREVIA");
    }
    const { data: claimed, error: claimError } = await this.db.from("siat_outbox")
      .update({ payload: { ...job.payload, conciliacionCufdVigenteIniciadaAt: new Date().toISOString(), conciliacionCufdVigenteId: cufdId } })
      .eq("id", outboxId).eq("factura_id", invoiceId).eq("estado", "CANCELADA")
      .eq("payload->>reenvioAutomaticoBloqueado", "true")
      .is("locked_by", null).is("locked_until", null)
      .is("payload->conciliacionCufdVigenteIniciadaAt", null).select("*").maybeSingle();
    if (claimError) fail(claimError, "No se pudo reservar la conciliación con CUFD vigente.");
    if (!claimed) throw new Error("CONCILIACION_CUFD_VIGENTE_YA_SOLICITADA");
    return claimed as Record<string, unknown>;
  }

  async enqueue(facturaId: string | null, type: string, idempotencyKey: string, payload: Record<string, unknown>) {
    const { error } = await this.db.from("siat_outbox").upsert({ factura_id: facturaId, tipo_tarea: type, idempotency_key: idempotencyKey, payload, estado: "PENDIENTE", disponible_desde: new Date().toISOString() }, { onConflict: "idempotency_key", ignoreDuplicates: true });
    if (error) fail(error, "No se pudo encolar la operación SIAT.");
  }

  async applyCatalog(catalog: { codigo: string; nombre: string; items: Array<{ codigo: string; claveNatural: string; descripcion: string; metadatos: Record<string, unknown> }> }, correlationId: string) {
    const { error } = await this.db.rpc("siat_aplicar_catalogo", { p_codigo: catalog.codigo, p_nombre: catalog.nombre, p_version_normativa: "SIAT_VIGENTE", p_version_catalogo: new Date().toISOString(), p_items: catalog.items, p_correlation_id: correlationId });
    if (error) fail(error, `No se pudo persistir el catálogo ${catalog.codigo}.`);
  }

  async registerCatalogError(codigo: string, nombre: string, correlationId: string, message: string) {
    const { data: catalog, error: catalogError } = await this.db.from("siat_catalogos").upsert({ codigo, nombre, version_normativa: "SIAT_VIGENTE", estado: "CON_ERROR", ultimo_error: message.slice(0, 500) }, { onConflict: "codigo,version_normativa" }).select("id").single();
    if (catalogError || !catalog) fail(catalogError, `No se pudo registrar el error del catálogo ${codigo}.`);
    const { error } = await this.db.from("siat_sincronizaciones").insert({ catalogo_id: catalog!.id, operacion: `SINCRONIZAR_${codigo}`, estado: "CON_ERROR", fecha_fin: new Date().toISOString(), ultimo_error: message.slice(0, 500), correlation_id: correlationId });
    if (error) fail(error, `No se pudo registrar la sincronización fallida de ${codigo}.`);
  }

  async saveSynchronizationOffset(offsetMs: number) {
    const { error } = await this.db.from("siat_configuracion").update({ desfase_hora_sin_ms: offsetMs, ultima_sincronizacion_exitosa: new Date().toISOString() }).eq("id", true);
    if (error) fail(error, "No se pudo guardar la hora sincronizada del SIN.");
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
      .eq("sucursal_id", config.sucursal_predeterminada_id).eq("ambiente", config.ambiente).eq("estado", "VIGENTE").gt("fecha_expiracion", new Date().toISOString());
    query = config.punto_venta_predeterminado_id ? query.eq("punto_venta_id", config.punto_venta_predeterminado_id) : query.is("punto_venta_id", null);
    const { data, error } = await query.order("fecha_expiracion", { ascending: false }).limit(1).maybeSingle();
    if (error) fail(error, "No se pudo consultar CUIS.");
    return data as Record<string, unknown> | null;
  }

  async activeCufd(config: Record<string, unknown>, cuisId: string) {
    let query = this.db.from("siat_cufd").select("*")
      .eq("sucursal_id", config.sucursal_predeterminada_id).eq("cuis_id", cuisId).eq("ambiente", config.ambiente).eq("estado", "VIGENTE").gt("fecha_expiracion", new Date().toISOString());
    query = config.punto_venta_predeterminado_id ? query.eq("punto_venta_id", config.punto_venta_predeterminado_id) : query.is("punto_venta_id", null);
    const { data, error } = await query.order("fecha_expiracion", { ascending: false }).limit(1).maybeSingle();
    if (error) fail(error, "No se pudo consultar CUFD.");
    return data as Record<string, unknown> | null;
  }

  async saveCuis(config: Record<string, unknown>, result: { codigo: string; fechaVigencia: string }) {
    const { error } = await this.db.rpc("siat_guardar_cuis", { p_sucursal_id: config.sucursal_predeterminada_id, p_punto_venta_id: config.punto_venta_predeterminado_id, p_ambiente: config.ambiente, p_codigo: result.codigo, p_fecha_expiracion: result.fechaVigencia });
    if (error) fail(error, "No se pudo guardar el CUIS.");
  }

  async saveCufd(config: Record<string, unknown>, cuisId: string, result: { codigo: string; codigoControl: string; direccion: string | null; fechaVigencia: string }) {
    const { data, error } = await this.db.rpc("siat_guardar_cufd", { p_sucursal_id: config.sucursal_predeterminada_id, p_punto_venta_id: config.punto_venta_predeterminado_id, p_cuis_id: cuisId, p_ambiente: config.ambiente, p_codigo: result.codigo, p_codigo_control: result.codigoControl, p_direccion: result.direccion, p_fecha_expiracion: result.fechaVigencia });
    if (error || !data) fail(error, "No se pudo guardar el CUFD.");
    return String(data);
  }
}

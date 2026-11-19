import { fromBase64, gunzipBytes, sha256Hex } from "../_shared/siat/encoding.ts";
import { uploadImmutableFiscalArtifact } from "../_shared/siat/immutable-artifact.ts";
import { json, officialAdapter, secureEquals, serviceClient } from "../_shared/siat/runtime.ts";
import { sanitizeErrorMessage } from "../_shared/siat/soap.ts";
import { validateElectronicInvoiceXml, validateXmlAgainstXsd } from "../_shared/siat/xsd.ts";

import { xsdSiat } from "../_shared/siat/xsd-embebidos.ts";
import { verifyInvoiceSignature } from "../_shared/siat/xmldsig.ts";
import { SiatRepository } from "../_shared/siat/repository.ts";

async function dispatchContingency() {
  const url = Deno.env.get("SUPABASE_URL"); const key = Deno.env.get("SIAT_WORKER_SECRET");
  if (!url || !key) throw new Error("WORKER_CONTINGENCIA_NO_CONFIGURADO");
  const response = await fetch(url + "/functions/v1/siat-worker", { method: "POST", headers: { "content-type": "application/json", "x-worker-secret": key }, body: JSON.stringify({ action: "contingency" }), signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error("WORKER_CONTINGENCIA_NO_DISPONIBLE");
  const result = await response.json();
  if (Array.isArray(result.failures) && result.failures.length) throw new Error("RECUPERACION_CON_TAREAS_PENDIENTES_DE_REVISION");
}
const record = (value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const requiredText = (value: unknown, label: string) => {
  const result = String(value ?? "").trim();
  if (!result) throw new Error(`${label} es obligatorio.`);
  return result;
};
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((item) => item.toString(16).padStart(2, "0")).join("");

async function verifySignature(raw: string, timestamp: string, nonce: string, signature: string) {
  const secret = Deno.env.get("SIAT_AGENT_SHARED_SECRET") ?? "";
  if (secret.length < 32) throw new Error("SIAT_AGENT_SHARED_SECRET no está configurado de forma segura.");
  const when = Number(timestamp);
  if (!Number.isFinite(when) || Math.abs(Date.now() - when) > 300_000) throw new Error("Solicitud del agente expirada.");
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce) || !/^[a-f0-9]{64}$/i.test(signature)) throw new Error("Firma del agente inválida.");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${nonce}.${raw}`)));
  if (!await secureEquals(signature.toLowerCase(), expected)) throw new Error("Firma del agente inválida.");
}

async function bootstrap(db: ReturnType<typeof serviceClient>, agent: Record<string, unknown>, reserveNumbers: boolean, reserveCount: number, preparacionControlada: boolean) {
  if (reserveNumbers && (!Number.isSafeInteger(reserveCount) || reserveCount < 1 || reserveCount > 10000)) throw new Error("CANTIDAD_RESERVA_OFFLINE_INVALIDA");
  const [config, branch, point, products, homologations, stocks, warehouses, clients, payments, legends, cafc, rules] = await Promise.all([
    db.from("siat_configuracion").select("*").eq("id", true).single(),
    db.from("siat_sucursales").select("*").eq("id", agent.sucursal_id).single(),
    agent.punto_venta_id ? db.from("siat_puntos_venta").select("*").eq("id", agent.punto_venta_id).single() : Promise.resolve({ data: null, error: null }),
    db.from("productos").select("id,codigo_interno,nombre,descripcion,precio_pieza,activo").eq("activo", true),
    db.from("siat_producto_homologaciones").select("producto_id,codigo_producto_sin,actividad_economica,unidad_medida_sin,origen,version_catalogo,estado").eq("version_normativa", "SIAT_VIGENTE").eq("estado", "HOMOLOGADO"),
    db.from("stock_por_almacen").select("producto_id,almacen_id,cantidad_disponible"),
    db.from("almacenes").select("id,codigo,nombre,activo").eq("activo", true),
    db.from("clientes").select("id,codigo_cliente,nombre_razon_social,tipo_documento,numero_documento,complemento,correo,telefono,activo").eq("activo", true),
    db.from("siat_metodo_pago_mapeos").select("metodo_interno,codigo_metodo_pago").eq("version_normativa", "SIAT_VIGENTE"),
    db.from("siat_catalogo_items").select("codigo,descripcion,metadatos,catalogo:siat_catalogos!inner(codigo,version_normativa,estado)").eq("catalogo.codigo", "LEYENDAS_FACTURA").eq("catalogo.version_normativa", "SIAT_VIGENTE").eq("catalogo.estado", "VIGENTE").eq("activo", true),
    db.from("siat_rangos_cafc").select("*").eq("sucursal_id", agent.sucursal_id).eq("estado", "VIGENTE").lte("vigente_desde", new Date().toISOString()).gte("vigente_hasta", new Date().toISOString()),
    db.from("siat_reglas_normativas").select("codigo,valor,fuente_oficial").eq("version_normativa", "SIAT_VIGENTE").eq("estado", "VIGENTE"),
  ]);
  const failed = [config, branch, point, products, homologations, stocks, warehouses, clients, payments, legends, cafc, rules].find((result) => result.error);
  if (failed?.error) throw failed.error;
  if (!config.data || config.data.ambiente !== "PRUEBAS" || config.data.version_normativa !== "SIAT_VIGENTE") throw new Error("El agente local solo puede aprovisionarse para SIAT vigente en pruebas.");
  if (preparacionControlada && config.data.siat_habilitado !== false) throw new Error("APROVISIONAMIENTO_REQUIERE_EMISION_GENERAL_DESHABILITADA");
  const { cuis, cufd } = await new SiatRepository(db).activeFiscalCodes(String(agent.sucursal_id), agent.punto_venta_id ? String(agent.punto_venta_id) : null, "PRUEBAS");
  const block = reserveNumbers ? await db.rpc("siat_reservar_bloque_offline", { p_agente_codigo: agent.codigo, p_cantidad: reserveCount }) : { data: [], error: null };
  if (block.error) throw block.error;
  return { agentId: agent.id, config: config.data, branch: branch.data, point: point.data, cuis, cufd, products: products.data, homologations: homologations.data, stocks: stocks.data, warehouses: warehouses.data, clients: clients.data, payments: payments.data, legends: legends.data, cafc: cafc.data, rules: rules.data, numberBlock: block.data?.[0] ?? null, generatedAt: new Date().toISOString() };
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Método no permitido." }, 405);
  try {
    const raw = await request.text();
    const agentCode = requiredText(request.headers.get("x-siat-agent"), "Agente");
    const timestamp = requiredText(request.headers.get("x-siat-timestamp"), "Timestamp");
    const nonce = requiredText(request.headers.get("x-siat-nonce"), "Nonce");
    await verifySignature(raw, timestamp, nonce, requiredText(request.headers.get("x-siat-signature"), "Firma"));
    const db = serviceClient();
    const { data: agent, error: agentError } = await db.from("siat_agentes_locales").select("*").eq("codigo", agentCode).neq("estado", "BLOQUEADO").single();
    if (agentError || !agent) throw new Error("Agente local no registrado o bloqueado.");
    const body = record(JSON.parse(raw)); const action = requiredText(body.action, "Acción");
    if (action === "probe-9b-persistencia") {
      if (body.contrato !== 2 || Deno.env.get("SIAT_CONTINGENCIA_PILOTO_HABILITADA") === "true" || !/^9bprobe_[a-f0-9]{32}$/.test(nonce)) throw new Error("SONDA_9B_NO_AUTORIZADA");
      const { data: config, error: configError } = await db.from("siat_configuracion").select("ambiente,siat_habilitado").eq("id", true).single();
      if (configError || config?.ambiente !== "PRUEBAS" || config?.siat_habilitado !== false) throw new Error("SONDA_9B_NO_AUTORIZADA");
    }
    const { error: nonceError } = await db.from("siat_agent_nonces").insert({ agente_id: agent.id, nonce, fecha_solicitud: new Date(Number(timestamp)).toISOString(), expira_at: new Date(Number(timestamp) + 600_000).toISOString() });
    if (nonceError) throw new Error("Solicitud repetida o nonce inválido.");
    if (action === "probe-9b-persistencia") {
      const { data, error } = await db.rpc("siat_9b_verificar_nonce_prueba", { p_agente: agent.id, p_nonce: nonce });
      if (error || data?.persistido !== true) throw new Error("SONDA_9B_NO_CONFIRMADA");
      return json({ edge: true, rpc: "siat_9b_verificar_nonce_prueba", persistido: true, fiscal: false });
    }
    // La recuperación fiscal requiere controles de CUFD, CAFC y autorización aún pendientes.
    const enabled = Deno.env.get("SIAT_CONTINGENCIA_PILOTO_HABILITADA") === "true" && Deno.env.get("SIAT_CONTINGENCIA_AGENTE_CODIGO") === agentCode;
    if (["import-event", "import-invoice", "finalize-event", "recovery-status"].includes(action) && (!enabled || body.contrato !== 2)) {
      return json({ error: "CONTINGENCIA_PENDIENTE_VALIDACION_Y_AUTORIZACION" }, 409);
    }
    if (action === "bootstrap" && (body.contrato !== 2 || Deno.env.get("SIAT_CONTINGENCIA_AGENTE_CODIGO") !== agentCode || (!enabled && (body.reserveNumbers !== true || body.reserveCount !== 1)))) {
      return json({ error: "APROVISIONAMIENTO_NO_AUTORIZADO" }, 409);
    }
    if (action === "release-reservation" && (Deno.env.get("SIAT_CONTINGENCIA_AGENTE_CODIGO") !== agentCode || body.contrato !== 2)) {
      return json({ error: "CIERRE_RESERVA_NO_AUTORIZADO" }, 409);
    }

    if (action === "probe") {
      try {
        const response = await officialAdapter().verificarComunicacion();
        return json({ siatOnline: response.transaccion === true, revisionRequired: response.transaccion !== true, codigoEstado: response.codigoEstado, detail: response.codigoDescripcion ?? response.mensajes.map((item) => item.descripcion).join("; ") });
      } catch (error) {
        const detail = sanitizeErrorMessage(error);
        return json({ siatOnline: false, revisionRequired: !/timeout|timed out|abort|fetch failed|connection|network|HTTP 50[234]/i.test(detail), detail: detail || "Servicio SIAT inaccesible" });
      }
    }

    if (action === "recovery-status") {
      const eventId = requiredText(body.eventoId, "Evento");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId)) throw new Error("EVENTO_INVALIDO");
      const { data, error } = await db.rpc("siat_9b_estado_recuperacion", { p_agente: agent.id, p_evento: eventId });
      if (error || !data) throw new Error("ESTADO_RECUPERACION_NO_DISPONIBLE");
      if (data.confirmada !== true && body.sinFacturasLocales === true) {
        const { data: emptyConfirmed, error: emptyError } = await db.rpc("siat_9b_evento_vacio_confirmado", { p_agente: agent.id, p_evento: eventId });
        if (emptyError) throw new Error("ESTADO_RECUPERACION_NO_DISPONIBLE");
        if (emptyConfirmed === true) return json({ eventoId: eventId, confirmada: true, sinDocumentos: true });
      }
      if (data.confirmada !== true && body.sinFacturasLocales !== true) await dispatchContingency();
      return json(data);
    }

    if (action === "bootstrap") {
      const data = await bootstrap(db, agent, Boolean(body.reserveNumbers), Number(body.reserveCount), !enabled);
      await db.from("siat_agentes_locales").update({ ultima_conexion: new Date().toISOString(), estado: "ACTIVO", version_agente: String(body.versionAgente ?? agent.version_agente) }).eq("id", agent.id);
      return json(data);
    }
    if (action === "release-reservation") {
      const desde = Number(body.desde), hasta = Number(body.hasta), siguiente = Number(body.siguiente);
      if (![desde, hasta, siguiente].every(Number.isSafeInteger) || desde < 1 || hasta < desde || siguiente < desde || siguiente > hasta + 1) throw new Error("CIERRE_RESERVA_DATOS_INVALIDOS");
      const evento = body.eventoId == null ? null : requiredText(body.eventoId, "Evento");
      if (evento && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(evento)) throw new Error("EVENTO_INVALIDO");
      const { data, error } = await db.rpc("siat_9b_conciliar_reserva", { p_agente_codigo: agentCode, p_desde: desde, p_hasta: hasta, p_siguiente: siguiente, p_evento: evento });
      if (error || !data) {
        const message = String(error?.message ?? "");
        if (message.includes("RESERVA_NO_PERTENECE_AL_AGENTE")) throw new Error("RESERVA_NO_PERTENECE_AL_AGENTE");
        throw new Error("RESERVA_NO_CONCILIADA");
      }
      return json(data);
    }
    if (action === "heartbeat") {
      const state = requiredText(body.estado, "Estado");
      await db.from("siat_agentes_locales").update({ ultima_conexion: new Date().toISOString(), estado: state === "OFFLINE" ? "OFFLINE" : state === "DEGRADADO" ? "DEGRADADO" : "ACTIVO" }).eq("id", agent.id);
      await db.from("siat_estado_operativo").upsert({ agente_id: agent.id, estado: state, navegador_online: body.navegadorOnline, backend_remoto_online: body.backendRemotoOnline, servicio_siat_online: body.servicioSiatOnline, servicio_especifico: body.servicioEspecifico, fallos_consecutivos: Number(body.fallosConsecutivos ?? 0), evento_id: body.eventoId ?? null, evidencia: record(body.evidencia), changed_at: body.changedAt ?? new Date().toISOString() });
      return json({ ok: true });
    }
    if (action === "import-event") {
      const event = record(body.evento);
      if (event.cafcId || ["5", "6", "7"].includes(String(event.tipoEventoCodigo ?? ""))) throw new Error("CAFC_DESHABILITADO_PENDIENTE_AUTORIZACION");
      const { data, error } = await db.rpc("siat_importar_evento_offline_v2", { p_agente_codigo: agentCode, p_payload: event });
      if (error) throw error;
      return json({ eventoId: data });
    }
    if (action === "import-invoice") {
      const payload = record(body.factura); const invoiceId = requiredText(payload.facturaId, "Factura");
      if (payload.esManualCafc === true || payload.cafcId || payload.numeroManual != null || body.evidenciaBase64) throw new Error("CAFC_DESHABILITADO_PENDIENTE_AUTORIZACION");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId)
        || ["c2279bbb-e851-468b-afe6-8ebf0b436d28", "08dd889e-f2f7-4acb-be2e-2f911aae9919", "8c5c0f1d-efd5-492f-ad26-3013f33cc3fe"].includes(invoiceId.toLowerCase())) throw new Error("FACTURA_OFFLINE_NO_ADMITIDA");
      const xmlGzip = fromBase64(requiredText(body.xmlGzipBase64, "XML GZIP"));
      const expectedHash = requiredText(payload.xmlHash, "Hash XML").toUpperCase();
      if (await sha256Hex(xmlGzip) !== expectedHash) throw new Error("El XML offline no coincide con su SHA-256.");
      const xml = new TextDecoder().decode(await gunzipBytes(xmlGzip));
      const modality = requiredText(payload.modalidad, "Modalidad");
      const xsd = xsdSiat(modality === "ELECTRONICA" ? "facturaElectronicaCompraVenta.xsd" : "facturaComputarizadaCompraVenta.xsd");
      if (modality === "ELECTRONICA") {
        validateElectronicInvoiceXml(xml, xsd, xsdSiat("SignatureSchema.xsd"));
        if (!verifyInvoiceSignature(xml, (Deno.env.get("SIAT_CERTIFICATE_PEM") ?? "").replaceAll("\\n", "\n"))) throw new Error("FIRMA_OFFLINE_NO_VALIDA");
      }
      else validateXmlAgainstXsd(xml, xsd);
      const period = requiredText(payload.fechaEmision, "Fecha").slice(0, 7);
      const cuf = requiredText(payload.cuf, "CUF");
      if (!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(period) || !/^[A-F0-9]{1,100}$/i.test(cuf)) throw new Error("RUTA_FISCAL_OFFLINE_INVALIDA");
      const xmlPath = `${period}/offline/${invoiceId}/${cuf}.xml.gz`;
      const pdfPath = `${period}/offline/${invoiceId}/${cuf}.pdf`;
      const pdf = fromBase64(requiredText(body.pdfBase64, "PDF"));
      if (new TextDecoder().decode(pdf.slice(0, 4)) !== "%PDF") throw new Error("Representación gráfica offline inválida.");
      const bucket = db.storage.from("siat-documentos");
      await uploadImmutableFiscalArtifact(bucket, xmlPath, xmlGzip, "application/gzip");
      await uploadImmutableFiscalArtifact(bucket, pdfPath, pdf, "application/pdf");
      let evidencePath: string | null = null;
      let evidenceHash: string | null = null;
      if (body.evidenciaBase64) {
        const evidence = fromBase64(String(body.evidenciaBase64)); evidencePath = `${period}/offline/${invoiceId}/evidencia-original.bin`;
        evidenceHash = await sha256Hex(evidence);
        await uploadImmutableFiscalArtifact(bucket, evidencePath, evidence, String(body.evidenciaMime ?? "application/octet-stream"));
      }
      const enriched = { ...payload, xmlDocumento: xml, xmlStoragePath: xmlPath, pdfStoragePath: pdfPath, evidenciaOriginalStoragePath: evidencePath,
        adjuntosHash: { xml: expectedHash, pdf: await sha256Hex(pdf), evidencia: evidenceHash } };
      const { data, error } = await db.rpc("siat_importar_factura_offline_v2", { p_agente_codigo: agentCode, p_payload: enriched });
      if (error) throw error;
      return json({ facturaId: data });
    }
    if (action === "finalize-event") {
      const { error: scopeError } = await db.rpc("siat_9b_estado_recuperacion", { p_agente: agent.id, p_evento: requiredText(body.eventoId, "Evento") });
      if (scopeError) throw new Error("EVENTO_NO_PERTENECE_AL_AGENTE");
      const { data, error } = await db.rpc("siat_programar_recuperacion_evento", { p_evento_id: requiredText(body.eventoId, "Evento") });
      if (error) throw error;
      await dispatchContingency();
      return json({ estado: data }, 202);
    }
    if (action === "backup-evidence") {
      await db.from("siat_agentes_locales").update({ ultimo_backup_verificado: new Date().toISOString() }).eq("id", agent.id);
      await db.from("siat_evidencias_readiness").insert({ codigo: "RESTAURACION_AGENTE_LOCAL", resultado: body.restauracionOk ? "APROBADO" : "FALLIDO", version_software: String(body.versionAgente ?? agent.version_agente), detalle: { backupHash: body.backupHash, agente: agentCode } });
      return json({ ok: true });
    }
    throw new Error("Acción del agente no soportada.");
  } catch (error) {
    const message = sanitizeErrorMessage(error) || "Error interno.";
    return json({ error: message }, /firma|agente|nonce|expirada/i.test(message) ? 401 : 400);
  }
});

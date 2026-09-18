import { fromBase64, gunzipBytes, sha256Hex } from "../_shared/siat/encoding.ts";
import { json, officialAdapter, secureEquals, serviceClient } from "../_shared/siat/runtime.ts";
import { validateElectronicInvoiceXml, validateXmlAgainstXsd } from "../_shared/siat/xsd.ts";

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

async function bootstrap(db: ReturnType<typeof serviceClient>, agent: Record<string, unknown>, reserveNumbers: boolean) {
  const [config, branch, point, cuis, cufd, products, homologations, stocks, warehouses, clients, payments, legends, cafc, rules] = await Promise.all([
    db.from("siat_configuracion").select("*").eq("id", true).single(),
    db.from("siat_sucursales").select("*").eq("id", agent.sucursal_id).single(),
    agent.punto_venta_id ? db.from("siat_puntos_venta").select("*").eq("id", agent.punto_venta_id).single() : Promise.resolve({ data: null, error: null }),
    db.from("siat_cuis").select("*").eq("sucursal_id", agent.sucursal_id).eq("estado", "VIGENTE").order("fecha_expiracion", { ascending: false }).limit(1).maybeSingle(),
    db.from("siat_cufd").select("*").eq("sucursal_id", agent.sucursal_id).eq("estado", "VIGENTE").order("fecha_expiracion", { ascending: false }).limit(1).maybeSingle(),
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
  const failed = [config, branch, point, cuis, cufd, products, homologations, stocks, warehouses, clients, payments, legends, cafc, rules].find((result) => result.error);
  if (failed?.error) throw failed.error;
  if (!config.data || config.data.ambiente !== "PRUEBAS" || config.data.version_normativa !== "SIAT_VIGENTE") throw new Error("El agente local solo puede aprovisionarse para SIAT vigente en pruebas.");
  if (!cuis.data || !cufd.data) throw new Error("CUIS/CUFD no disponibles para aprovisionar el agente.");
  const block = reserveNumbers ? await db.rpc("siat_reservar_bloque_offline", { p_agente_codigo: agent.codigo, p_cantidad: 1000 }) : { data: [], error: null };
  if (block.error) throw block.error;
  return { config: config.data, branch: branch.data, point: point.data, cuis: cuis.data, cufd: cufd.data, products: products.data, homologations: homologations.data, stocks: stocks.data, warehouses: warehouses.data, clients: clients.data, payments: payments.data, legends: legends.data, cafc: cafc.data, rules: rules.data, numberBlock: block.data?.[0] ?? null, generatedAt: new Date().toISOString() };
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
    const { error: nonceError } = await db.from("siat_agent_nonces").insert({ agente_id: agent.id, nonce, fecha_solicitud: new Date(Number(timestamp)).toISOString(), expira_at: new Date(Number(timestamp) + 600_000).toISOString() });
    if (nonceError) throw new Error("Solicitud repetida o nonce inválido.");
    const body = record(JSON.parse(raw)); const action = requiredText(body.action, "Acción");

    if (action === "probe") {
      try {
        const response = await officialAdapter().verificarComunicacion();
        return json({ siatOnline: response.transaccion === true, codigoEstado: response.codigoEstado, detail: response.codigoDescripcion ?? response.mensajes.map((item) => item.descripcion).join("; ") });
      } catch (error) {
        return json({ siatOnline: false, detail: error instanceof Error ? error.message.slice(0, 300) : "Servicio SIAT inaccesible" });
      }
    }

    if (action === "bootstrap") {
      const data = await bootstrap(db, agent, Boolean(body.reserveNumbers));
      await db.from("siat_agentes_locales").update({ ultima_conexion: new Date().toISOString(), estado: "ACTIVO", version_agente: String(body.versionAgente ?? agent.version_agente) }).eq("id", agent.id);
      return json(data);
    }
    if (action === "heartbeat") {
      const state = requiredText(body.estado, "Estado");
      await db.from("siat_agentes_locales").update({ ultima_conexion: new Date().toISOString(), estado: state === "OFFLINE" ? "OFFLINE" : state === "DEGRADADO" ? "DEGRADADO" : "ACTIVO" }).eq("id", agent.id);
      await db.from("siat_estado_operativo").upsert({ agente_id: agent.id, estado: state, navegador_online: body.navegadorOnline, backend_remoto_online: body.backendRemotoOnline, servicio_siat_online: body.servicioSiatOnline, servicio_especifico: body.servicioEspecifico, fallos_consecutivos: Number(body.fallosConsecutivos ?? 0), evento_id: body.eventoId ?? null, evidencia: record(body.evidencia), changed_at: body.changedAt ?? new Date().toISOString() });
      return json({ ok: true });
    }
    if (action === "import-event") {
      const { data, error } = await db.rpc("siat_importar_evento_offline", { p_agente_codigo: agentCode, p_payload: record(body.evento) });
      if (error) throw error;
      return json({ eventoId: data });
    }
    if (action === "import-invoice") {
      const payload = record(body.factura); const invoiceId = requiredText(payload.facturaId, "Factura");
      const xmlGzip = fromBase64(requiredText(body.xmlGzipBase64, "XML GZIP"));
      const expectedHash = requiredText(payload.xmlHash, "Hash XML").toUpperCase();
      if (await sha256Hex(xmlGzip) !== expectedHash) throw new Error("El XML offline no coincide con su SHA-256.");
      const xml = new TextDecoder().decode(await gunzipBytes(xmlGzip));
      const modality = requiredText(payload.modalidad, "Modalidad");
      const xsd = await Deno.readTextFile(new URL(`../_shared/siat/artifacts/SIAT_VIGENTE/${modality === "ELECTRONICA" ? "facturaElectronicaCompraVenta.xsd" : "facturaComputarizadaCompraVenta.xsd"}`, import.meta.url));
      if (modality === "ELECTRONICA") validateElectronicInvoiceXml(xml, xsd, await Deno.readTextFile(new URL("../_shared/siat/artifacts/SIAT_VIGENTE/SignatureSchema.xsd", import.meta.url)));
      else validateXmlAgainstXsd(xml, xsd);
      const period = requiredText(payload.fechaEmision, "Fecha").slice(0, 7);
      const xmlPath = `${period}/offline/${invoiceId}/${requiredText(payload.cuf, "CUF")}.xml.gz`;
      const pdfPath = `${period}/offline/${invoiceId}/${requiredText(payload.cuf, "CUF")}.pdf`;
      const pdf = fromBase64(requiredText(body.pdfBase64, "PDF"));
      if (new TextDecoder().decode(pdf.slice(0, 4)) !== "%PDF") throw new Error("Representación gráfica offline inválida.");
      const xmlUpload = await db.storage.from("siat-documentos").upload(xmlPath, xmlGzip, { contentType: "application/gzip", upsert: true });
      if (xmlUpload.error) throw xmlUpload.error;
      const pdfUpload = await db.storage.from("siat-documentos").upload(pdfPath, pdf, { contentType: "application/pdf", upsert: true });
      if (pdfUpload.error) throw pdfUpload.error;
      let evidencePath: string | null = null;
      if (body.evidenciaBase64) {
        const evidence = fromBase64(String(body.evidenciaBase64)); evidencePath = `${period}/offline/${invoiceId}/evidencia-original.bin`;
        const evidenceUpload = await db.storage.from("siat-documentos").upload(evidencePath, evidence, { contentType: String(body.evidenciaMime ?? "application/octet-stream"), upsert: true });
        if (evidenceUpload.error) throw evidenceUpload.error;
      }
      const enriched = { ...payload, xmlDocumento: xml, xmlStoragePath: xmlPath, pdfStoragePath: pdfPath, evidenciaOriginalStoragePath: evidencePath };
      const { data, error } = await db.rpc("siat_importar_factura_offline", { p_agente_codigo: agentCode, p_payload: enriched });
      if (error) throw error;
      return json({ facturaId: data });
    }
    if (action === "finalize-event") {
      const { data, error } = await db.rpc("siat_programar_recuperacion_evento", { p_evento_id: requiredText(body.eventoId, "Evento") });
      if (error) throw error;
      return json({ estado: data }, 202);
    }
    if (action === "backup-evidence") {
      await db.from("siat_agentes_locales").update({ ultimo_backup_verificado: new Date().toISOString() }).eq("id", agent.id);
      await db.from("siat_evidencias_readiness").insert({ codigo: "RESTAURACION_AGENTE_LOCAL", resultado: body.restauracionOk ? "APROBADO" : "FALLIDO", version_software: String(body.versionAgente ?? agent.version_agente), detalle: { backupHash: body.backupHash, agente: agentCode } });
      return json({ ok: true });
    }
    throw new Error("Acción del agente no soportada.");
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).replace(/TokenApi\s+\S+/gi, "TokenApi [REDACTED]").slice(0, 500);
    return json({ error: message }, /firma|agente|nonce|expirada/i.test(message) ? 401 : 400);
  }
});

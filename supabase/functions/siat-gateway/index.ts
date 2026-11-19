import { SiatRepository } from "../_shared/siat/repository.ts";
import { authenticatedUser, corsHeaders, json, officialAdapter, serviceClient, siatCredentialStatus } from "../_shared/siat/runtime.ts";
import { sanitizeErrorMessage } from "../_shared/siat/soap.ts";
import { assertSignatureTestAdmin, testSignatureIsolated } from "../_shared/siat/signature-test.ts";
import { assertPilotPreviewAdmin, buildPilotPreview, pilotAuthorizationEnabled, pilotPreviewHash } from "../_shared/siat/pilot-preview.ts";
import { classifyPilotNit, pilotCertificateEvidenceMatches, pilotIdentityAllowed, pilotNitEvidenceMatches, publicCertificateSha256 } from "../_shared/siat/pilot-approval.ts";
import { validateSignatureCredentials } from "../_shared/siat/signature-credentials.ts";
import { assertFiscalDocumentAccess } from "../_shared/siat/document-access.ts";
import { evidenceDigest, maskRecipient, normalizeRecipient, recipientHmac, type NotificationChannel } from "../_shared/siat/notification-evidence.ts";
import { buildEmailNotice, sendResendEmail } from "../_shared/siat/notification-email.ts";
import { openFiscalSoapEvidence } from "../_shared/siat/fiscal-soap-evidence.ts";
import { fromBase64, gunzipBytes, sha256Hex, toBase64 } from "../_shared/siat/encoding.ts";
import { verifiedCafcDocument } from "../_shared/siat/cafc-document.ts";
import { uploadImmutableFiscalArtifact } from "../_shared/siat/immutable-artifact.ts";
import { generateCuf } from "../_shared/siat/cuf.ts";
import { officialQrUrl } from "../_shared/siat/qr.ts";
import { xsdSiat } from "../_shared/siat/xsd-embebidos.ts";
import { CAFC_LINK_ENABLED } from "../_shared/siat/cafc-link-control.ts";

const pilotControlFields = "emision_habilitada,autorizacion_habilitada_id,eku_fiscal_aprobado,eku_tipo_evidencia,eku_alcance,eku_declaracion_at,eku_aprobado_por,nit_cliente_verificado,nit_cliente_id,nit_cliente_documento,nit_ambiente,nit_codigo_respuesta,nit_consultado_at,nit_resultado,nit_verificado_at,eku_cert_sha256,eku_aprobado_at";
const pilotCertificateHash = async () => {
  try { return await publicCertificateSha256(Deno.env.get("SIAT_CERTIFICATE_PEM") ?? ""); }
  catch { return ""; }
};

const requests = new Map<string, { count: number; reset: number }>();
const rateLimit = (key: string, limit = 30) => {
  const now = Date.now(); const current = requests.get(key);
  if (!current || current.reset < now) { requests.set(key, { count: 1, reset: now + 60_000 }); return false; }
  current.count += 1; return current.count > limit;
};
const record = (value: unknown) => value && typeof value === "object" ? value as Record<string, unknown> : {};
const isAdmin = (role: string) => role.toLowerCase() === "administrador";

async function validatePilotCufdConfiguration(repository: SiatRepository, config: Record<string, unknown>) {
  const required = [["nit", "NIT"], ["codigo_sistema", "Código de sistema"], ["sucursal_predeterminada_id", "Sucursal tributaria"]] as const;
  const missing = required.filter(([key]) => !String(config[key] ?? "").trim()).map(([, label]) => label);
  if (missing.length) throw new Error(`Falta configurar: ${missing.join(", ")}.`);
  if (config.ambiente !== "PRUEBAS" || config.modalidad !== "ELECTRONICA" || Number(config.documento_sector) !== 1 || Number(config.tipo_factura) !== 1) throw new Error("El piloto CUFD requiere PRUEBAS, ELECTRONICA, documento sector 1 y tipo factura 1.");
  const branch = await repository.branch(String(config.sucursal_predeterminada_id));
  if (Number(branch.codigo) !== 0) throw new Error("El piloto CUFD requiere la sucursal Casa Matriz con código 0.");
  if (config.punto_venta_predeterminado_id) {
    const point = await repository.point(String(config.punto_venta_predeterminado_id));
    if (Number(point.codigo) !== 0) throw new Error("El piloto CUFD requiere punto de venta con código 0.");
  }
}

async function dispatchWorker() {
  const workerSecret = Deno.env.get("SIAT_WORKER_SECRET") ?? "";
  const baseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  if (!workerSecret || !baseUrl) throw new Error("La solicitud fue encolada, pero el worker SIAT no está configurado.");
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
    if (action === "9b-link-manual-cafc") {
      if (!isAdmin(String(user.profile.rol))) throw new Error("Operación reservada a administración.");
      if (!CAFC_LINK_ENABLED) return json({ error: "CAFC_VINCULACION_PENDIENTE_AUTORIZACION_PILOTO" }, 409, origin);
      if (body.confirmacion !== true || body.originalRevisado !== true) throw new Error("CAFC_CONFIRMACION_ORIGINAL_REQUERIDA");
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const id = String(body.facturaId ?? "").toLowerCase(), eventId = String(body.eventoId ?? "").toLowerCase();
      const rangeId = String(body.cafcId ?? "").toLowerCase(), agentId = String(body.agenteId ?? "").toLowerCase();
      const correlationId = String(body.correlationId ?? "").toLowerCase(), saleId = body.ventaId == null || body.ventaId === "" ? null : String(body.ventaId).toLowerCase();
      if (![id, eventId, rangeId, agentId, correlationId].every((value) => uuid.test(value)) || (saleId !== null && !uuid.test(saleId))
        || ["c2279bbb-e851-468b-afe6-8ebf0b436d28", "08dd889e-f2f7-4acb-be2e-2f911aae9919", "8c5c0f1d-efd5-492f-ad26-3013f33cc3fe"].includes(id)
        || !/^[A-Za-z0-9:_-]{16,160}$/.test(String(body.idempotencyKey ?? ""))) throw new Error("CAFC_IDENTIFICADORES_INVALIDOS");
      const compressed = fromBase64(String(body.xmlGzipBase64 ?? "")); const original = fromBase64(String(body.originalBase64 ?? ""));
      if (!compressed.length || compressed.length > 2_000_000 || !original.length || original.length > 8_000_000) throw new Error("CAFC_ADJUNTOS_INVALIDOS");
      const xmlHash = await sha256Hex(compressed), evidenceHash = await sha256Hex(original);
      if (body.xmlSha256 !== xmlHash || body.originalSha256 !== evidenceHash) throw new Error("CAFC_ADJUNTOS_HASH_NO_COINCIDE");
      const prefix = [...original.slice(0, 8)];
      if (!(prefix[0] === 0x25 && prefix[1] === 0x50 && prefix[2] === 0x44 && prefix[3] === 0x46)
        && !(prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff)
        && !(prefix.join(",") === "137,80,78,71,13,10,26,10")) throw new Error("CAFC_ORIGINAL_FORMATO_INVALIDO");
      const certificate = Deno.env.get("SIAT_CERTIFICATE_PEM") ?? ""; const certificateHash = await publicCertificateSha256(certificate);
      const control = await db.from("siat_piloto_control").select(pilotControlFields).eq("id", true).single();
      if (control.error || !control.data || !pilotCertificateEvidenceMatches(control.data, certificateHash)) throw new Error("CAFC_CERTIFICADO_SIN_APROBACION");
      const xsd = xsdSiat("facturaElectronicaCompraVenta.xsd");
      const signatureXsd = xsdSiat("SignatureSchema.xsd");
      const xmlBytes = await gunzipBytes(compressed); if (xmlBytes.length > 5_000_000) throw new Error("CAFC_XML_DEMASIADO_GRANDE");
      const fiscal = verifiedCafcDocument(new TextDecoder("utf-8", { fatal: true }).decode(xmlBytes), certificate, xsd, signatureXsd);
      const event = await repository.event(eventId); const cufd = await repository.cufd(String(event.cufd_id ?? ""));
      const expectedCuf = generateCuf({ nit: String(fiscal.nit), fechaEmision: String(fiscal.fechaEmision), codigoSucursal: Number(fiscal.codigoSucursal), modalidad: 1, tipoEmision: 2, tipoFactura: 1, documentoSector: 1, numeroFactura: String(fiscal.numeroFactura), codigoPuntoVenta: Number(fiscal.codigoPuntoVenta), codigoControl: String(cufd.codigo_control ?? "") });
      if (!cufd.codigo_control || fiscal.cuf !== expectedCuf) throw new Error("CAFC_CUF_NO_CORRESPONDE");
      const base = `cafc/${eventId}/${id}`; const xmlPath = `${base}/firmado.xml.gz`, evidencePath = `${base}/original.bin`;
      const bucket = db.storage.from("siat-documentos");
      await uploadImmutableFiscalArtifact(bucket, xmlPath, compressed, "application/gzip");
      await uploadImmutableFiscalArtifact(bucket, evidencePath, original, "application/octet-stream");
      const payload = { ...fiscal, facturaId: id, eventoId: eventId, cafcId: rangeId, agenteId: agentId, correlationId,
        idempotencyKey: String(body.idempotencyKey), xmlPath, evidenciaPath: evidencePath, xmlHash, evidenciaHash: evidenceHash,
        qrContenido: officialQrUrl("PRUEBAS", String(fiscal.nit), String(fiscal.cuf), String(fiscal.numeroFactura)), hashXsd: await sha256Hex(new TextEncoder().encode(xsd)), origenCaja: "CAFC" };
      const result = await db.rpc("siat_9b_vincular_cafc", { p: payload, p_venta: saleId, p_actor: user.authId, p_confirmacion: true });
      if (result.error || !result.data) throw new Error("CAFC_VINCULACION_NO_DISPONIBLE");
      return json(result.data, 200, origin);
    }
    if (action === "9a-read-soap-evidence") {
      if (!isAdmin(String(user.profile.rol))) throw new Error("Operación reservada a administración.");
      const { data, error } = await db.rpc("siat_9a_leer_soap", { p_intento: String(body.intentoId ?? ""), p_actor: user.authId });
      if (error || !data) throw new Error("SOAP_EVIDENCIA_NO_DISPONIBLE");
      const evidence = record(data);
      if (evidence.estado !== "RECIBIDA") return json({ estado: evidence.estado, httpEstado: evidence.http_estado, cuerpoBase64: null }, 200, origin);
      const bytes = await openFiscalSoapEvidence(Deno.env.get("SIAT_SOAP_EVIDENCIA_KEY") ?? "", evidence);
      return json({ estado: evidence.estado, httpEstado: evidence.http_estado, sha256: evidence.sha256, cuerpoBase64: toBase64(bytes) }, 200, origin);
    }
    if (action === "9a-capabilities") {
      if (!isAdmin(String(user.profile.rol))) throw new Error("Operación reservada a administración.");
      const config = await repository.configuration();
      const cancelacion = config.ambiente === "PRUEBAS" && Deno.env.get("SIAT_ANULACION_PILOTO_HABILITADA") === "true" && (Deno.env.get("SIAT_NOTIFICACION_HMAC_KEY") ?? "").length >= 32;
      const correoAutomatico = (Deno.env.get("SIAT_NOTIFICACION_HMAC_KEY") ?? "").length >= 32 && Boolean((Deno.env.get("RESEND_API_KEY") ?? "").trim()) && Boolean((Deno.env.get("SIAT_EMAIL_FROM") ?? "").trim());
      return json({ cancelacion, reversion: false, correoAutomatico }, 200, origin);
    }
    if (action === "9a-notification-status") {
      if (!isAdmin(String(user.profile.rol))) throw new Error("Operación reservada a administración.");
      const { data, error } = await db.from("siat_9a_notificaciones").select("operacion,canal,destinatario_mascara,estado,preparado_at,enviado_at,enviado_por,confirmado_at,confirmado_por,evidencia_tipo,envio_intentado_at").eq("factura_id", String(body.facturaId ?? ""));
      if (error) throw error;
      return json({ notificaciones: data ?? [] }, 200, origin);
    }
    if (action === "9a-notification") {
      if (!isAdmin(String(user.profile.rol))) throw new Error("Operación reservada a administración.");
      if (body.confirmacion !== true || !["ANULACION", "REVERSION"].includes(String(body.operacion)) || !["CORREO", "WHATSAPP"].includes(String(body.canal)) || !["PREPARAR", "REGISTRAR_ENVIO_MANUAL", "CONFIRMAR_ENTREGA_MANUAL"].includes(String(body.etapa))) throw new Error("Confirmación o datos de notificación inválidos.");
      const channel = String(body.canal) as NotificationChannel; const recipient = normalizeRecipient(channel, body.destinatario);
      const hmac = await recipientHmac(Deno.env.get("SIAT_NOTIFICACION_HMAC_KEY") ?? "", channel, recipient);
      const requiresEvidence = body.etapa !== "PREPARAR";
      const hash = requiresEvidence ? await evidenceDigest(body.evidencia) : null;
      const fechaEnvio = requiresEvidence ? Date.parse(String(body.fechaEnvio ?? "")) : null;
      if (requiresEvidence && (fechaEnvio === null || !Number.isFinite(fechaEnvio) || fechaEnvio > Date.now())) throw new Error("FECHA_ENVIO_DECLARADA_INVALIDA");
      const { data, error } = await db.rpc("siat_9a_guardar_notificacion", { p_factura: String(body.facturaId ?? ""), p_actor: user.authId,
        p_operacion: body.operacion, p_canal: channel, p_destino_hmac: hmac, p_destino_mascara: maskRecipient(recipient), p_accion: body.etapa,
        p_confirmacion: true, p_evidencia_hash: hash, p_fecha_envio: fechaEnvio === null ? null : new Date(fechaEnvio).toISOString() });
      if (error) throw error;
      return json({ estado: data, entregaConfirmada: data === "ENTREGA_CONFIRMADA", verificacion: data === "ENTREGA_CONFIRMADA" ? "ACUSE_REVISADO_POR_ADMINISTRACION" : "NO_VERIFICADA" }, 200, origin);
    }
    if (action === "9a-review") {
      if (!isAdmin(String(user.profile.rol))) throw new Error("Operación reservada a administración.");
      if (body.confirmacion !== true) throw new Error("Confirmación administrativa requerida.");
      const hash = await evidenceDigest(body.evidencia);
      const { data, error } = await db.rpc("siat_9a_guardar_revision", { p_factura: String(body.facturaId ?? ""), p_actor: user.authId,
        p_tipo: body.tipo, p_hash: hash, p_dictamen: body.dictamen, p_confirmacion: true });
      if (error) throw error;
      return json({ revisionId: data, estadoFiscalModificado: false, reenvio: false }, 200, origin);
    }
    if (action === "9a-send-auto") {
      if (!isAdmin(String(user.profile.rol))) throw new Error("Operación reservada a administración.");
      if (body.confirmacion !== true || !["ANULACION", "REVERSION"].includes(String(body.operacion))) throw new Error("Confirmación o tipo de aviso inválidos.");
      const key = Deno.env.get("RESEND_API_KEY") ?? ""; const from = Deno.env.get("SIAT_EMAIL_FROM") ?? "";
      if (!key.trim() || !from.trim()) throw new Error("CORREO_AUTOMATICO_NO_CONFIGURADO");
      const recipient = normalizeRecipient("CORREO", body.destinatario); const recipientHash = await recipientHmac(Deno.env.get("SIAT_NOTIFICACION_HMAC_KEY") ?? "", "CORREO", recipient);
      const facturaId = String(body.facturaId ?? ""); const invoice = await repository.invoice(facturaId); const config = await repository.configuration();
      let reason: string | null = null;
      if (body.operacion === "ANULACION") {
        const catalog = await db.from("siat_catalogos").select("id").eq("codigo", "MOTIVOS_ANULACION").eq("version_normativa", "SIAT_VIGENTE").eq("estado", "VIGENTE").maybeSingle();
        if (catalog.error || !catalog.data) throw new Error("AVISO_MOTIVO_NO_DISPONIBLE");
        const item = await db.from("siat_catalogo_items").select("descripcion").eq("catalogo_id", catalog.data.id).eq("codigo", String(invoice.motivo_anulacion_codigo ?? "")).eq("activo", true).maybeSingle();
        if (item.error || !item.data) throw new Error("AVISO_MOTIVO_NO_DISPONIBLE");
        reason = String(item.data.descripcion ?? "");
      }
      const notice = buildEmailNotice({ operation: body.operacion as "ANULACION" | "REVERSION", invoice, config, motivo: reason });
      const reserved = await db.rpc("siat_9a_reservar_correo", { p_factura: facturaId, p_actor: user.authId, p_operacion: body.operacion, p_destino_hmac: recipientHash, p_confirmacion: true });
      if (reserved.error || !reserved.data) throw reserved.error ?? new Error("CORREO_RESERVA_NO_DISPONIBLE");
      const providerId = await sendResendEmail({ apiKey: key, from, to: recipient, text: notice, attempt: String(reserved.data) });
      const confirmed = await db.rpc("siat_9a_confirmar_correo_proveedor", { p_intento: reserved.data, p_actor: user.authId, p_evidencia_hash: await evidenceDigest(providerId) });
      if (confirmed.error) throw new Error("CORREO_RESULTADO_INCIERTO_REQUIERE_REVISION");
      return json({ estado: confirmed.data, entregaConfirmada: false }, 200, origin);
    }
    if (action === "test-signature") {
      assertSignatureTestAdmin(String(user.profile.rol));
      try {
        const result = await testSignatureIsolated(Deno.env.get("SIAT_PRIVATE_KEY_PEM"), Deno.env.get("SIAT_CERTIFICATE_PEM"),
          async (name) => xsdSiat(name));
        return json(result, 200, origin);
      } catch (error) {
        const code = error instanceof Error && /^(FIRMA_|CERTIFICADO_)[A-Z_]+$/.test(error.message) ? error.message : "FIRMA_PRUEBA_FALLIDA";
        return json({ ok: false, code }, 400, origin);
      }
    }
    if (action === "verify-pilot-client-nit") {
      assertPilotPreviewAdmin(String(user.profile.rol));
      const config = await repository.configuration();
      if (config.ambiente !== "PRUEBAS" || config.modalidad !== "ELECTRONICA" || config.nit !== "72229012"
        || config.siat_habilitado !== false || !String(config.codigo_sistema ?? "").trim()
        || !config.sucursal_predeterminada_id) throw new Error("PILOTO_CONFIGURACION_INVALIDA");
      const [client, control] = await Promise.all([
        db.from("clientes").select("id,codigo_cliente,tipo_documento,numero_documento,activo").eq("codigo_cliente", "CLI-000006").single(),
        db.from("siat_piloto_control").select(pilotControlFields).eq("id", true).single(),
      ]);
      if (client.error || !client.data || control.error || !control.data) throw new Error("PILOTO_DATOS_NO_DISPONIBLES");
      if (client.data.tipo_documento !== "NIT" || client.data.numero_documento !== "9204357" || client.data.activo !== true) throw new Error("PILOTO_CLIENTE_INVALIDO");
      if (pilotNitEvidenceMatches(control.data, client.data, config.ambiente)) return json({ resultado: "ACTIVO", codigo: 986, aprobado: true, yaVerificado: true }, 200, origin);
      const lastCheck = Date.parse(String(control.data.nit_consultado_at ?? ""));
      if (control.data.nit_cliente_id === client.data.id && control.data.nit_cliente_documento === client.data.numero_documento
        && control.data.nit_ambiente === "PRUEBAS" && Number.isFinite(lastCheck)
        && lastCheck <= Date.now() && Date.now() - lastCheck < 10 * 60 * 1000) return json({ resultado: control.data.nit_resultado, codigo: control.data.nit_codigo_respuesta, aprobado: false, yaVerificado: false, consultaReciente: true }, 200, origin);
      const branch = await repository.branch(String(config.sucursal_predeterminada_id));
      if (Number(branch.codigo) !== 0) throw new Error("PILOTO_SUCURSAL_INVALIDA");
      const cuis = await repository.activeCuis(config);
      if (!cuis) throw new Error("PILOTO_CUIS_NO_VIGENTE");
      const context = {
        ambiente: "PRUEBAS" as const, versionNormativa: "SIAT_VIGENTE" as const,
        modalidad: "ELECTRONICA" as const, codigoSistema: String(config.codigo_sistema),
        codigoSucursal: 0, codigoPuntoVenta: null, nit: String(config.nit), cuis: String(cuis.codigo),
      };
      let result: ReturnType<typeof classifyPilotNit>;
      let transaccion: boolean | null = null;
      try {
        const response = await officialAdapter().verificarNit(context, "9204357");
        transaccion = response.transaccion;
        result = classifyPilotNit(response);
      } catch {
        result = { resultado: "ERROR_SERVICIO", codigo: null };
      }
      const { data: approved, error: saveError } = await db.rpc("siat_registrar_nit_cliente_piloto", {
        p_actor_auth_user_id: user.authId, p_cliente_id: client.data.id,
        p_documento: client.data.numero_documento, p_ambiente: "PRUEBAS",
        p_transaccion: transaccion, p_codigo: result.codigo, p_resultado: result.resultado,
      });
      if (saveError) throw saveError;
      return json({ ...result, aprobado: approved === true, yaVerificado: false }, 200, origin);
    }
    if (action === "approve-pilot-certificate") {
      assertPilotPreviewAdmin(String(user.profile.rol));
      const config = await repository.configuration();
      if (config.ambiente !== "PRUEBAS" || config.nit !== "72229012" || config.siat_habilitado !== false) throw new Error("PILOTO_CONFIGURACION_INVALIDA");
      const verbal = body.tipoEvidencia === "CONFIRMACION_VERBAL_REPORTADA_POR_USUARIO";
      if (verbal ? (body.entidadConfirmadora !== "SIN_REPORTADO_POR_USUARIO"
        || body.fechaConfirmacion != null || body.referenciaDocumental != null
        || body.confirmacionAdministrativa !== "DECLARO CONFIRMACION VERBAL REPORTADA POR EL USUARIO SOLO PARA SIAT PILOTO")
        : (body.tipoEvidencia !== "ACEPTACION_SIAT_PILOTO" || body.entidadConfirmadora !== "SIN"
        || typeof body.fechaConfirmacion !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.fechaConfirmacion)
        || typeof body.referenciaDocumental !== "string" || body.referenciaDocumental.trim().length < 8
        || body.confirmacionAdministrativa !== "CONFIRMO ACEPTACION FORMAL DEL SIN PARA ESTE CERTIFICADO EN SIAT PILOTO")) throw new Error("PILOTO_EVIDENCIA_CERTIFICADO_INSUFICIENTE");
      const credentials = validateSignatureCredentials(Deno.env.get("SIAT_PRIVATE_KEY_PEM"), Deno.env.get("SIAT_CERTIFICATE_PEM"));
      if (!credentials.nitCoincidenciaTextual) throw new Error("PILOTO_CERTIFICADO_NIT_NO_COINCIDE");
      const fingerprint = await pilotCertificateHash();
      if (!fingerprint) throw new Error("PILOTO_CERTIFICADO_NO_DISPONIBLE");
      const { error } = await db.rpc("siat_aprobar_certificado_piloto", {
        p_actor_auth_user_id: user.authId, p_tipo_evidencia: body.tipoEvidencia,
        p_entidad: body.entidadConfirmadora, p_fecha_confirmacion: verbal ? null : body.fechaConfirmacion,
        p_referencia: verbal ? null : (body.referenciaDocumental as string).trim(), p_cert_sha256: fingerprint,
      });
      if (error) throw error;
      return json({ aprobado: true, certificadoSha256: fingerprint, transmisionHabilitada: false }, 200, origin);
    }
    if (action === "pilot-enable-authorization") {
      assertPilotPreviewAdmin(String(user.profile.rol));
      const authorizationId = String(body.authorizationId ?? "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(authorizationId)
        || body.confirmacion !== "HABILITO SOLO ESTA AUTORIZACION PARA UNA FACTURA EN SIAT PILOTO") throw new Error("PILOTO_HABILITACION_INDIVIDUAL_REQUERIDA");
      const credentials = validateSignatureCredentials(Deno.env.get("SIAT_PRIVATE_KEY_PEM"), Deno.env.get("SIAT_CERTIFICATE_PEM"));
      if (!credentials.nitCoincidenciaTextual) throw new Error("PILOTO_CERTIFICADO_NIT_NO_COINCIDE");
      const fingerprint = await pilotCertificateHash();
      const { error } = await db.rpc("siat_habilitar_autorizacion_piloto", {
        p_actor_auth_user_id: user.authId, p_autorizacion_id: authorizationId, p_cert_sha256: fingerprint,
      });
      if (error) throw error;
      return json({ authorizationId, habilitada: true, facturaEmitida: false }, 200, origin);
    }
    if (action === "pilot-issue") {
      assertPilotPreviewAdmin(String(user.profile.rol));
      const authorizationId = String(body.authorizationId ?? "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(authorizationId)) throw new Error("PILOTO_AUTORIZACION_INVALIDA");
      if (body.confirmacion !== "AUTORIZO EMITIR ESTA UNICA FACTURA EN SIAT PILOTO") throw new Error("PILOTO_CONFIRMACION_REQUERIDA");
      const config = await repository.configuration();
      const [client, control, fingerprint] = await Promise.all([
        db.from("clientes").select("id,codigo_cliente,nombre_razon_social,tipo_documento,numero_documento,complemento,activo").eq("codigo_cliente", "CLI-000006").single(),
        db.from("siat_piloto_control").select(pilotControlFields).eq("id", true).single(),
        pilotCertificateHash(),
      ]);
      if (client.error || control.error || !client.data || !control.data || config.ambiente !== "PRUEBAS"
        || control.data.emision_habilitada !== true
        || control.data.autorizacion_habilitada_id !== authorizationId
        || !pilotIdentityAllowed(control.data, client.data, config.ambiente)
        || !pilotCertificateEvidenceMatches(control.data, fingerprint)) throw new Error("PILOTO_PREAPROBACION_PENDIENTE");
      const { data, error } = await db.rpc("siat_crear_factura_piloto_outbox", {
        p_autorizacion_id: authorizationId, p_actor_auth_user_id: user.authId, p_confirmacion: body.confirmacion,
      });
      if (error || !data) throw error ?? new Error("PILOTO_NO_ENCOLADO");
      const worker = await dispatchWorker();
      return json({ facturaId: data, estado: worker.failures.length ? "ERROR" : worker.processed > 0 ? "PROCESADA" : "EN_COLA", worker }, 202, origin);
    }
    if (action === "pilot-preview" || action === "pilot-prepare") {
      assertPilotPreviewAdmin(String(user.profile.rol));
      const config = await repository.configuration();
      if (config.ambiente !== "PRUEBAS") throw new Error("PILOTO_SOLO_PRUEBAS");
      const [client, product, payment, pending, catalogRows, control, stage] = await Promise.all([
        db.from("clientes").select("id,codigo_cliente,nombre_razon_social,tipo_documento,numero_documento,complemento,activo").eq("codigo_cliente", "CLI-000006").maybeSingle(),
        db.from("productos").select("id,codigo_interno,nombre,precio_pieza,activo").eq("codigo_interno", "ph1234").maybeSingle(),
        db.from("siat_metodo_pago_mapeos").select("codigo_metodo_pago").eq("metodo_interno", "EFECTIVO").eq("version_normativa", "SIAT_VIGENTE").maybeSingle(),
        db.from("siat_outbox").select("id", { count: "exact", head: true }).in("estado", ["PENDIENTE", "REINTENTAR", "PROCESANDO"]),
        db.from("siat_catalogos").select("id,codigo,estado").eq("version_normativa", "SIAT_VIGENTE").in("codigo", ["ACTIVIDADES", "PRODUCTOS_SERVICIOS", "UNIDADES_MEDIDA", "METODOS_PAGO", "TIPOS_DOCUMENTO"]),
        db.from("siat_piloto_control").select(pilotControlFields).eq("id", true).single(),
        db.rpc("siat_etapa_segundo_piloto"),
      ]);
      const firstError = [client, product, payment, pending, catalogRows, control, stage].find((item) => item.error)?.error;
      if (firstError) throw firstError;
      const enabledAuthorization = control.data?.autorizacion_habilitada_id
        ? await db.from("siat_piloto_autorizaciones").select("estado,expires_at").eq("id", control.data.autorizacion_habilitada_id).maybeSingle()
        : { data: null, error: null };
      if (enabledAuthorization.error) throw enabledAuthorization.error;
      const emissionEnabled = pilotAuthorizationEnabled(control.data!, enabledAuthorization.data, new Date());
      const catalogIds = (catalogRows.data ?? []).map((item) => item.id);
      const { data: items, error: itemsError } = catalogIds.length
        ? await db.from("siat_catalogo_items").select("catalogo_id,codigo,descripcion,activo,metadatos").in("catalogo_id", catalogIds).in("codigo", ["4752100", "1003451", "47", "1", "5"])
        : { data: [], error: null };
      if (itemsError) throw itemsError;
      const catalogById = new Map((catalogRows.data ?? []).map((item) => [item.id, item]));
      const cuis = await repository.activeCuis(config);
      const cufd = cuis ? await repository.activeCufd(config, String(cuis.id)) : null;
      const fingerprint = await pilotCertificateHash();
      const nitApproved = pilotNitEvidenceMatches(control.data!, client.data ?? {}, config.ambiente);
      const identityReady = pilotIdentityAllowed(control.data!, client.data ?? {}, config.ambiente);
      const ekuApproved = pilotCertificateEvidenceMatches(control.data!, fingerprint);
      const preview = buildPilotPreview({
        config, client: client.data, product: product.data, paymentCode: payment.data?.codigo_metodo_pago ?? null,
        pendingJobs: pending.count ?? 0, cuis, cufd, now: new Date(),
        catalogs: (items ?? []).map((item) => ({ catalog: String(catalogById.get(item.catalogo_id)?.codigo ?? ""), state: String(catalogById.get(item.catalogo_id)?.estado ?? ""), code: item.codigo, description: item.descripcion, active: item.activo, activity: String((item.metadatos as Record<string, unknown> | null)?.codigoActividad ?? "") })),
        proposedPrice: body.precio === undefined ? undefined : Number(body.precio),
        proposedDiscount: body.descuento === undefined ? undefined : Number(body.descuento),
        ekuFiscalApproved: ekuApproved,
        nitClientVerified: nitApproved,
        emissionEnabled,
        routeReady: stage.data === 0 || stage.data === 1 || stage.data === 2,
      });
      const previewHash = await pilotPreviewHash(preview, stage.data === 1, stage.data === 2);
      const hardBlockers = preview.blockers.filter((code) => !["CERTIFICADO_EKU_FISCAL_PENDIENTE", "NIT_CLIENTE_SIN_VERIFICAR", "PILOTO_EMISION_CERRADA", "AUTORIZACION_EXPLICITA_PENDIENTE"].includes(code));
      const gate = { emisionHabilitada: emissionEnabled, autorizacionHabilitadaId: emissionEnabled ? control.data!.autorizacion_habilitada_id : null,
        ekuFiscalAprobado: ekuApproved, ekuTipoEvidencia: control.data!.eku_tipo_evidencia ?? null,
        nitClienteVerificado: nitApproved, documentoListo: identityReady };
      if (action === "pilot-prepare") {
        if (String(body.previewHash ?? "") !== previewHash || hardBlockers.length || !identityReady || !client.data || !product.data) throw new Error("PILOTO_PREVIEW_NO_VALIDO");
        const { error: insertError } = await db.from("siat_piloto_autorizaciones").upsert({
          actor_auth_user_id: user.authId, cliente_id: client.data.id, producto_id: product.data.id,
          preview_hash: previewHash, producto_descripcion_snapshot: preview.producto.descripcion,
          precio_unitario: preview.montos.precio, descuento: preview.montos.descuento,
          ...(stage.data === 2 ? { proposito: "ANULACION_9A" } : {}),
        }, { onConflict: "actor_auth_user_id,preview_hash", ignoreDuplicates: true });
        if (insertError) throw insertError;
        const { data: authorization, error: authorizationError } = await db.from("siat_piloto_autorizaciones").select("id,estado,expires_at").eq("actor_auth_user_id", user.authId).eq("preview_hash", previewHash).single();
        if (authorizationError || !authorization) throw authorizationError ?? new Error("PILOTO_AUTORIZACION_NO_DISPONIBLE");
        return json({ authorizationId: authorization.id, estado: authorization.estado, expiresAt: authorization.expires_at, previewHash }, 200, origin);
      }
      return json({ ...preview, previewHash, etapaPiloto: stage.data, control: gate, puedeConfirmar: !hardBlockers.length && gate.emisionHabilitada && gate.ekuFiscalAprobado && gate.documentoListo }, 200, origin);
    }
    if (action === "health") {
      const config = await repository.configuration();
      const [cuis, cufd, pending, syncPending, latestSync, catalogos, catalogsWithError, items] = await Promise.all([
        db.from("siat_cuis").select("id,fecha_expiracion").eq("estado", "VIGENTE").gt("fecha_expiracion", new Date().toISOString()).order("fecha_expiracion", { ascending: false }).limit(1).maybeSingle(),
        db.from("siat_cufd").select("id,fecha_expiracion").eq("estado", "VIGENTE").gt("fecha_expiracion", new Date().toISOString()).order("fecha_expiracion", { ascending: false }).limit(1).maybeSingle(),
        db.from("siat_outbox").select("id", { count: "exact", head: true }).in("estado", ["PENDIENTE", "REINTENTAR", "PROCESANDO"]),
        db.from("siat_outbox").select("id", { count: "exact", head: true }).eq("tipo_tarea", "SINCRONIZAR_CATALOGOS").in("estado", ["PENDIENTE", "REINTENTAR", "PROCESANDO"]),
        db.from("siat_sincronizaciones").select("estado").order("fecha_inicio", { ascending: false }).limit(1).maybeSingle(),
        db.from("siat_catalogos").select("id", { count: "exact", head: true }).eq("version_normativa", "SIAT_VIGENTE").eq("estado", "VIGENTE"),
        db.from("siat_catalogos").select("id", { count: "exact", head: true }).eq("version_normativa", "SIAT_VIGENTE").eq("estado", "CON_ERROR"),
        db.from("siat_catalogo_items").select("id", { count: "exact", head: true }).eq("activo", true),
      ]);
      const syncStatus = (syncPending.count ?? 0) > 0 ? "SINCRONIZANDO" : (catalogsWithError.count ?? 0) > 0 || latestSync.data?.estado === "CON_ERROR" ? "ERROR" : (catalogos.count ?? 0) > 0 ? "SINCRONIZADO" : "NO_SINCRONIZADO";
      return json({ ambiente: config.ambiente, version: config.version_normativa, habilitado: config.siat_habilitado, credenciales: siatCredentialStatus(), conectividad: "NO_CONFIGURADO", cuis: cuis.data, cufd: cufd.data, ultimaVerificacionServicio: config.ultima_verificacion_servicio, ultimaSincronizacion: config.ultima_sincronizacion_exitosa, pendientes: pending.count ?? 0, sincronizacion: { estado: syncStatus, catalogosProcesados: catalogos.count ?? 0, itemsRecibidos: items.count ?? 0 } }, 200, origin);
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
    if (action === "sync") {
      if (!isAdmin(String(user.profile.rol))) throw new Error("Operación reservada a administración.");
      const config = await repository.configuration();
      if (!config.ultima_verificacion_servicio) throw new Error("Primero verifica la comunicación real con SIAT Piloto.");
      if (!await repository.activeCuis(config)) throw new Error("Se requiere un CUIS vigente para sincronizar catálogos.");
      const { data: failedCatalogs, error: failedCatalogsError } = await db.from("siat_catalogos").select("codigo").eq("estado", "CON_ERROR").eq("version_normativa", "SIAT_VIGENTE");
      if (failedCatalogsError) throw failedCatalogsError;
      const catalogos = (failedCatalogs ?? []).map((catalog) => String(catalog.codigo)).sort();
      const scope = catalogos.length ? catalogos.join(",") : "COMPLETA";
      await repository.enqueue(null, "SINCRONIZAR_CATALOGOS", `sincronizar_catalogos:${scope}:${new Date().toISOString().slice(0, 10)}`, { actor: user.authId, origen: "ADMINISTRACION", catalogos });
      const worker = await dispatchWorker();
      return json({ estado: worker.failures.length ? "ERROR" : worker.processed > 0 ? "SINCRONIZADO" : "SINCRONIZANDO", worker }, 202, origin);
    }
    if (action === "request-cufd") {
      if (!isAdmin(String(user.profile.rol))) throw new Error("Operación reservada a administración.");
      const config = await repository.configuration();
      if (!config.ultima_verificacion_servicio) throw new Error("Primero verifica la comunicación real con SIAT Piloto.");
      await validatePilotCufdConfiguration(repository, config);
      const cuis = await repository.activeCuis(config);
      if (!cuis) throw new Error("Se requiere un CUIS vigente antes de solicitar CUFD.");
      if (await repository.activeCufd(config, String(cuis.id))) return json({ estado: "VIGENTE", worker: { processed: 0, failures: [] } }, 200, origin);
      await repository.enqueue(null, "RENOVAR_CUFD", `renovar_cufd:${String(cuis.id)}:${new Date().toISOString().slice(0, 10)}`, { actor: user.authId, origen: "ADMINISTRACION" });
      const worker = await dispatchWorker();
      return json({ estado: worker.processed > 0 ? "PROCESADA" : "EN_COLA", worker }, 202, origin);
    }
    if (["prepare-invoice", "reverse"].includes(action) || (action === "cancel" && (Deno.env.get("SIAT_ANULACION_PILOTO_HABILITADA") !== "true" || (Deno.env.get("SIAT_NOTIFICACION_HMAC_KEY") ?? "").length < 32))) {
      return json({ error: "Esta operación fiscal permanece bloqueada hasta un paso posterior." }, 409, origin);
    }
    if (action === "prepare-invoice") {
      if (!["administrador", "vendedor", "caja"].includes(String(user.profile.rol).toLowerCase())) throw new Error("Su rol no puede emitir facturas fiscales.");
      const ventaId = String(body.ventaId ?? ""); if (!/^[0-9a-f-]{36}$/i.test(ventaId)) throw new Error("Venta inválida.");
      const { data, error } = await db.rpc("siat_crear_factura_outbox", { p_venta_id: ventaId }); if (error) throw error;
      return json({ facturaId: data, estado: data ? "EN_COLA" : "SIAT_DESHABILITADO" }, 202, origin);
    }
    if (action === "cancel" || action === "reverse") {
      if (!isAdmin(String(user.profile.rol))) throw new Error("Operación reservada a administración.");
      const facturaId = String(body.facturaId ?? ""); const motivo = body.motivo == null ? null : Number(body.motivo); const idempotencia = String(body.idempotencia ?? "");
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(facturaId) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idempotencia)) throw new Error("Identificador inválido.");
      if (body.confirmacion !== true || (action === "cancel" && (body.noUtilizadaDdjj !== true || !Number.isInteger(motivo)))) throw new Error("Falta confirmación administrativa o declaración requerida.");
      const sucursal = body.sucursalOperacionId == null ? null : String(body.sucursalOperacionId); const punto = body.puntoVentaOperacionId == null ? null : String(body.puntoVentaOperacionId);
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if ((sucursal && !uuid.test(sucursal)) || (punto && (!sucursal || !uuid.test(punto)))) throw new Error("Sucursal o punto de venta inválidos.");
      const { data, error } = await db.rpc("siat_solicitar_operacion_factura_confirmada", { p_factura_id: facturaId, p_operacion: action === "cancel" ? "ANULAR" : "REVERTIR_ANULACION", p_actor_auth_user_id: user.authId, p_motivo_codigo: motivo, p_confirmacion: body.confirmacion === true, p_no_utilizada_ddjj: action === "cancel" ? body.noUtilizadaDdjj === true : null, p_idempotencia: idempotencia, p_sucursal_operacion: sucursal, p_punto_venta_operacion: punto });
      if (error) throw error;
      if (action === "cancel" && data === "ANULACION_PENDIENTE") {
        // La RPC ya confirmó la solicitud. Un fallo de despacho no la deshace
        // ni autoriza otro envío; el estado fiscal se consulta por separado.
        try { return json({ estado: data, worker: await dispatchWorker() }, 202, origin); }
        catch (dispatchError) { return json({ estado: data, worker: { processed: 0, failures: [sanitizeErrorMessage(dispatchError)] } }, 202, origin); }
      }
      return json({ estado: data }, 202, origin);
    }
    if (action === "download") {
      if (!isAdmin(String(user.profile.rol))) throw new Error("Documentos fiscales reservados a administración.");
      const facturaId = String(body.facturaId ?? ""); const type = String(body.type ?? "").toUpperCase(); const invoice = await repository.invoice(facturaId);
      if (type !== "PDF" && type !== "XML") throw new Error("Tipo de documento fiscal no permitido.");
      assertFiscalDocumentAccess(String(user.profile.rol), invoice);
      const path = type === "PDF" ? invoice.pdf_storage_path : type === "XML" ? invoice.xml_storage_path : null;
      if (!path) { await db.from("siat_entregas_documentos").insert({ factura_id: facturaId, tipo: type, actor_auth_user_id: user.authId, resultado: "FALLIDA", detalle: "Documento aún no disponible" }); throw new Error(`El ${type} fiscal todavía no está disponible.`); }
      return json({ url: await repository.signedDocument(facturaId, String(path), type as "PDF" | "XML", user.authId), expiresIn: 120, documentAccess: "ADMIN_VALIDATED_V1" }, 200, origin);
    }
    throw new Error("Acción SIAT no soportada.");
  } catch (error) {
    const message = sanitizeErrorMessage(error) || "Error interno.";
    const status = /Sesión|autorizado|permisos|reservada/i.test(message) ? 403 : 400;
    return json({ error: message }, status, origin);
  }
});

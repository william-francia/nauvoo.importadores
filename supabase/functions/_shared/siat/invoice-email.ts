import { assertFiscalDocumentAccess } from "./document-access.ts";
import { originalSignedXml, snapshotFromSignedXml } from "./fiscal-document.ts";
import { generateFiscalPdf } from "./fiscal-pdf.ts";
import { cancelledWatermark } from "./pdf-watermark.ts";
import { toBase64 } from "./encoding.ts";
import { officialQrUrl } from "./qr.ts";
import { evidenceDigest, maskRecipient, normalizeRecipient, recipientHmac } from "./notification-evidence.ts";
import { sendResendEmail } from "./notification-email.ts";

type Row = Record<string, unknown>;
export type InvoiceEmailDependencies = {
  role: string; actor: string; apiKey: string; from: string; hmacKey: string;
  invoice: (id: string) => Promise<Row>;
  gzip: (path: string) => Promise<Uint8Array>;
  rpc: (name: string, args: Row) => PromiseLike<{ data: unknown; error: unknown }>;
  transport?: typeof fetch;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};

export async function resendInvoiceDocument(body: Row, deps: InvoiceEmailDependencies) {
  if (deps.role.toLowerCase() !== "administrador") throw new Error("Documentos fiscales reservados a administración.");
  if (body.confirmacion !== true || !uuid.test(String(body.facturaId ?? "")) || !uuid.test(String(body.idempotencia ?? ""))) throw new Error("CORREO_CONFIRMACION_O_IDENTIFICADOR_INVALIDO");
  if (!deps.apiKey.trim() || !deps.from.trim() || deps.hmacKey.length < 32) throw new Error("CORREO_FACTURA_NO_CONFIGURADO");
  const to = normalizeRecipient("CORREO", String(body.destinatario ?? ""));
  const invoice = await deps.invoice(String(body.facturaId));
  assertFiscalDocumentAccess(deps.role, invoice);
  const gzip = await deps.gzip(String(invoice.xml_storage_path));
  const xml = await originalSignedXml(gzip, String(invoice.xml_hash));
  const client = record(invoice.cliente_snapshot);
  const snapshot = snapshotFromSignedXml(xml, {
    id: String(invoice.id), ambiente: String(invoice.ambiente), estadoFiscal: String(invoice.estado_fiscal),
    codigoEstado: Number(invoice.codigo_estado), transaccion: invoice.transaccion === true,
    codigoRecepcion: String(invoice.codigo_recepcion), cuf: String(invoice.cuf), numeroFactura: String(invoice.numero_factura),
    cliente: String(client.nombreRazonSocial ?? invoice.nombre_razon_social ?? ""), documento: String(client.numeroDocumento ?? invoice.numero_documento ?? ""),
    total: Number(invoice.monto_total), fechaEmision: String(invoice.fecha_emision), sucursal: String(invoice.codigo_sucursal),
    puntoVenta: String(invoice.codigo_punto_venta ?? 0), xmlHash: String(invoice.xml_hash), xmlFirmado: invoice.xml_firmado === true,
  });
  const url = officialQrUrl("PRUEBAS", snapshot.nit, snapshot.cuf, snapshot.numeroFactura);
  const pdf = await cancelledWatermark(await generateFiscalPdf(snapshot, url, { format: "carta" }), invoice.estado_fiscal === "ANULADA");
  const claim = await deps.rpc("siat_reservar_correo_documento", {
    p_id: body.idempotencia, p_factura: invoice.id, p_actor: deps.actor,
    p_destino_hmac: await recipientHmac(deps.hmacKey, "CORREO", to), p_destino_mascara: maskRecipient(to), p_confirmacion: true,
  });
  if (claim.error) throw new Error("CORREO_NO_RESERVADO: revise configuración, permisos o un envío anterior pendiente.");
  const reserved = record(claim.data);
  if (reserved.claimed !== true) {
    if (reserved.estado === "ENVIADA") return { estado: "ENVIADA", entregaConfirmada: false, reutilizado: true };
    throw new Error("CORREO_RESULTADO_INCIERTO_REQUIERE_REVISION");
  }
  try {
    const providerId = await sendResendEmail({ apiKey: deps.apiKey, from: deps.from, to, attempt: String(body.idempotencia),
      idempotencyPrefix: "siat-documento", subject: `Factura ${snapshot.numeroFactura} · ${snapshot.razonSocial} · PILOTO`,
      text: `${snapshot.razonSocial}: adjuntamos la representación gráfica y el XML firmado de la factura ${snapshot.numeroFactura}, ambiente PILOTO. Consulta fiscal: ${url}`,
      attachments: [{ filename: `factura-${snapshot.numeroFactura}.pdf`, content: toBase64(pdf) }, { filename: `factura-${snapshot.numeroFactura}.xml`, content: toBase64(xml) }],
    }, deps.transport);
    const saved = await deps.rpc("siat_finalizar_correo_documento", { p_id: body.idempotencia, p_actor: deps.actor, p_estado: "ENVIADA", p_evidencia_hash: await evidenceDigest(providerId) });
    if (saved.error) throw new Error("CORREO_PERSISTENCIA_INCIERTA");
    return { estado: "ENVIADA", entregaConfirmada: false, reutilizado: false };
  } catch {
    // Nunca reintentar el proveedor: incluso un error de persistencia exige revisión.
    await deps.rpc("siat_finalizar_correo_documento", { p_id: body.idempotencia, p_actor: deps.actor, p_estado: "INCIERTA", p_evidencia_hash: null });
    throw new Error("CORREO_RESULTADO_INCIERTO_REQUIERE_REVISION");
  }
}

import { SiatRepository } from "../_shared/siat/repository.ts";
import { toBase64, sha256Hex } from "../_shared/siat/encoding.ts";
import { originalSignedXml } from "../_shared/siat/fiscal-document.ts";
import { sendResendEmail } from "../_shared/siat/notification-email.ts";
import { normalizeRecipient } from "../_shared/siat/notification-evidence.ts";
import { sendWhatsAppDocument, whatsappConfigured } from "../_shared/siat/whatsapp-document.ts";

export async function deliverCheckout(repository: SiatRepository, invoiceId: string) {
  const db = repository.db;
  const record = await db.from("siat_checkout_ventas").select("*").eq("factura_id", invoiceId).maybeSingle();
  if (record.error) throw record.error;
  const delivery = record.data;
  if (!delivery || !["PENDIENTE", "CONFIGURACION_PENDIENTE"].includes(delivery.entrega_estado) || !delivery.consentimiento || delivery.canal === "NINGUNO") return;
  const invoice = await repository.invoice(invoiceId);
  if (invoice.ambiente !== "PRUEBAS" || invoice.estado_fiscal !== "VALIDADA" || invoice.codigo_estado !== 908 || invoice.transaccion !== true || !invoice.codigo_recepcion || !invoice.pdf_storage_path || !invoice.xml_storage_path || !invoice.xml_hash || invoice.xml_firmado !== true) return;
  const wa = { token: Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? "", phoneId: Deno.env.get("WHATSAPP_PHONE_NUMBER_ID") ?? "", version: Deno.env.get("WHATSAPP_GRAPH_VERSION") ?? "", template: Deno.env.get("WHATSAPP_INVOICE_TEMPLATE") ?? "", language: Deno.env.get("WHATSAPP_TEMPLATE_LANGUAGE") ?? "" };
  const apiKey = Deno.env.get("RESEND_API_KEY") ?? "", from = Deno.env.get("SIAT_EMAIL_FROM") ?? "";
  if (delivery.canal === "WHATSAPP" ? !whatsappConfigured(wa) : !apiKey || !from) {
    await db.from("siat_checkout_ventas").update({ entrega_estado: "CONFIGURACION_PENDIENTE" }).eq("id", delivery.id).in("entrega_estado", ["PENDIENTE", "CONFIGURACION_PENDIENTE"]); return;
  }
  const pdf = await db.storage.from("siat-documentos").download(String(invoice.pdf_storage_path));
  const gzip = await db.storage.from("siat-documentos").download(String(invoice.xml_storage_path));
  if (pdf.error || gzip.error || !pdf.data || !gzip.data) throw Error("ENTREGA_DOCUMENTO_NO_DISPONIBLE");
  const xml = await originalSignedXml(new Uint8Array(await gzip.data.arrayBuffer()), String(invoice.xml_hash));
  const bytes = new Uint8Array(await pdf.data.arrayBuffer());
  const recipient = normalizeRecipient(delivery.canal, delivery.destinatario);
  const claimed = await db.from("siat_checkout_ventas").update({ entrega_estado: "ENVIANDO", entrega_at: new Date().toISOString() }).eq("id", delivery.id).in("entrega_estado", ["PENDIENTE", "CONFIGURACION_PENDIENTE"]).select("id").maybeSingle();
  if (claimed.error) throw claimed.error;
  if (!claimed.data) return;
  try {
    const filename = `factura-${invoice.numero_factura}.pdf`;
    const provider = delivery.canal === "WHATSAPP"
      ? await sendWhatsAppDocument(wa, recipient, bytes, filename, true)
      : await sendResendEmail({ apiKey, from, to: recipient, attempt: delivery.id, idempotencyPrefix: "siat-documento", subject: `Factura ${invoice.numero_factura} · PILOTO`, text: "Adjuntamos su factura electrónica en ambiente PILOTO.", attachments: [{ filename, content: toBase64(bytes) }, { filename: `factura-${invoice.numero_factura}.xml`, content: toBase64(xml) }] });
    const saved = await db.from("siat_checkout_ventas").update({ entrega_estado: "ENVIADA", entrega_evidencia: await sha256Hex(new TextEncoder().encode(provider)), entrega_at: new Date().toISOString() }).eq("id", delivery.id).eq("entrega_estado", "ENVIANDO");
    if (saved.error) throw saved.error;
  } catch {
    await db.from("siat_checkout_ventas").update({ entrega_estado: "INCIERTA" }).eq("id", delivery.id).eq("entrega_estado", "ENVIANDO");
    // Fallo de entrega no modifica factura, venta ni provoca otro envío automático.
  }
}

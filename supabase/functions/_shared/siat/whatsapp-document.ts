// Meta Cloud API: plantilla Utility aprobada, cabecera DOCUMENT y sin variables de cuerpo.
export type WhatsAppConfig = { token: string; phoneId: string; version: string; template: string; language: string };
export function whatsappConfigured(c: WhatsAppConfig) {
  return Boolean(c.token.trim() && /^\d+$/.test(c.phoneId) && /^v\d+\.\d+$/.test(c.version) && /^[a-z0-9_]+$/.test(c.template) && /^[a-z]{2}(?:_[A-Z]{2})?$/.test(c.language));
}
export async function sendWhatsAppDocument(c: WhatsAppConfig, to: string, pdf: Uint8Array, filename: string, consent: boolean, transport: typeof fetch = fetch): Promise<string> {
  if (!whatsappConfigured(c) || !consent || !/^\+?[1-9]\d{7,14}$/.test(to)) throw Error("WHATSAPP_CONFIGURACION_O_CONSENTIMIENTO_REQUERIDO");
  const base = `https://graph.facebook.com/${c.version}/${c.phoneId}`;
  const form = new FormData(); form.append("messaging_product", "whatsapp"); form.append("type", "application/pdf");
  form.append("file", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), filename);
  const upload = await transport(`${base}/media`, { method: "POST", headers: { Authorization: `Bearer ${c.token}` }, body: form, signal: AbortSignal.timeout(15000) });
  if (!upload.ok) throw Error("WHATSAPP_CARGA_NO_CONFIRMADA");
  const media = await upload.json(); if (typeof media.id !== "string" || !/^\d+$/.test(media.id)) throw Error("WHATSAPP_CARGA_NO_CONFIRMADA");
  const response = await transport(`${base}/messages`, { method: "POST", headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" }, signal: AbortSignal.timeout(15000), body: JSON.stringify({ messaging_product: "whatsapp", to: to.replace(/^\+/, ""), type: "template", template: { name: c.template, language: { code: c.language }, components: [{ type: "header", parameters: [{ type: "document", document: { id: media.id, filename } }] }] } }) });
  if (!response.ok) throw Error("WHATSAPP_RESULTADO_INCIERTO");
  const result = await response.json(); const id = result.messages?.[0]?.id;
  if (typeof id !== "string" || !id.startsWith("wamid.")) throw Error("WHATSAPP_RESULTADO_INCIERTO");
  return id; // Aceptado por proveedor; no equivale a entrega al comprador.
}

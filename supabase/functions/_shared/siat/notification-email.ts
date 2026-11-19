export function buildEmailNotice(input: { operation: "ANULACION" | "REVERSION"; invoice: Record<string, unknown>; config: Record<string, unknown>; motivo: string | null }): string {
  const numero = String(input.invoice.numero_factura ?? "").trim(); const cuf = String(input.invoice.cuf ?? "").trim();
  const emisor = String(input.config.razon_social ?? "").trim(); const nit = String(input.config.nit ?? "").trim();
  if (!numero || !cuf || !emisor || !/^\d+$/.test(nit)) throw new Error("AVISO_DATOS_FISCALES_INCOMPLETOS");
  if (input.operation === "ANULACION") {
    const motivo = String(input.motivo ?? "").trim(); if (!motivo) throw new Error("AVISO_MOTIVO_NO_DISPONIBLE");
    const notice = `${emisor} (NIT ${nit}) informa la anulación de la factura N.º ${numero}, código de autorización ${cuf}. Motivo: ${motivo}.`;
    return input.invoice.estado_fiscal === "REVERTIDA" ? `${notice} La anulación fue revertida posteriormente.` : notice;
  }
  return `${emisor} (NIT ${nit}) informa la reversión de la anulación de la factura N.º ${numero}, código de autorización ${cuf}.`;
}

export async function sendResendEmail(input: { apiKey: string; from: string; to: string; text: string; attempt: string }, transport: typeof fetch = fetch): Promise<string> {
  if (!input.apiKey.trim() || !input.from.trim()) throw new Error("CORREO_AUTOMATICO_NO_CONFIGURADO");
  let response: Response;
  try {
    response = await transport("https://api.resend.com/emails", { method: "POST", signal: AbortSignal.timeout(15_000),
      headers: { authorization: `Bearer ${input.apiKey}`, "content-type": "application/json", "idempotency-key": `siat-9a/${input.attempt}` },
      body: JSON.stringify({ from: input.from, to: [input.to], subject: "Aviso de operación de factura", text: input.text }) });
  } catch { throw new Error("CORREO_RESULTADO_INCIERTO_REQUIERE_REVISION"); }
  if (!response.ok) throw new Error("CORREO_RESULTADO_INCIERTO_REQUIERE_REVISION");
  const data = await response.json().catch(() => null) as { id?: unknown } | null;
  const id = typeof data?.id === "string" ? data.id.trim() : "";
  if (id.length < 12 || id.length > 200) throw new Error("CORREO_RESULTADO_INCIERTO_REQUIERE_REVISION");
  return id;
}

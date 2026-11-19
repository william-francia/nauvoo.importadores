import { describe, expect, it } from "vitest";
import { evidenceDigest, maskRecipient, normalizeRecipient, recipientHmac } from "../../supabase/functions/_shared/siat/notification-evidence.ts";
import { prepararAvisoFiscal } from "../../src/features/facturas/services/aviso-fiscal.service.ts";
import { buildEmailNotice, sendResendEmail } from "../../supabase/functions/_shared/siat/notification-email.ts";
import { vi } from "vitest";

describe("notificación y revisión 9A, sin envíos", () => {
  it("valida destinatarios sin inventarlos y exige prefijo internacional", () => {
    expect(normalizeRecipient("CORREO", " TEST@EXAMPLE.COM ")).toBe("test@example.com");
    expect(() => normalizeRecipient("CORREO", "ninguno")).toThrow("CORREO_INVALIDO");
    expect(normalizeRecipient("WHATSAPP", "+591 7000-0000")).toBe("+59170000000");
    expect(() => normalizeRecipient("WHATSAPP", "70000000")).toThrow("CODIGO_PAIS");
  });

  it("protege el destinatario y exige clave específica configurada", async () => {
    const email = normalizeRecipient("CORREO", "buyer@example.com");
    expect(maskRecipient(email)).not.toContain(email);
    await expect(recipientHmac("corta", "CORREO", email)).rejects.toThrow("NO_CONFIGURADA");
    const first = await recipientHmac("a".repeat(32), "CORREO", email);
    expect(first).toMatch(/^[A-F0-9]{64}$/); expect(first).not.toContain(email);
    expect(await recipientHmac("b".repeat(32), "CORREO", email)).not.toBe(first);
  });

  it("requiere referencia de evidencia y conserva su huella", async () => {
    await expect(evidenceDigest("sin prueba")).rejects.toThrow("REFERENCIA_VERIFICABLE");
    const hash = await evidenceDigest("comprobante-sintetico-001"); expect(hash).toMatch(/^[A-F0-9]{64}$/);
    expect(hash).not.toContain("comprobante");
  });

  it("el aviso exige CUF, número, motivo y datos reales del emisor", () => {
    const data = { estadoFiscal: "ANULADA", numeroFactura: "20", cuf: "CUF-TEST", motivo: "Error", emisor: "Emisor sintético", nitEmisor: "123456" };
    expect(prepararAvisoFiscal(data)).toContain("Emisor sintético (NIT 123456)");
    expect(prepararAvisoFiscal(data)).toContain("CUF-TEST"); expect(prepararAvisoFiscal(data)).toContain("Motivo: Error");
    expect(prepararAvisoFiscal({ ...data, emisor: "" })).toBeNull();
    expect(buildEmailNotice({ operation: "ANULACION", invoice: { numero_factura: "20", cuf: "CUF-TEST" }, config: { razon_social: "Emisor sintético", nit: "123456" }, motivo: "Error" })).toBe(prepararAvisoFiscal(data));
    expect(buildEmailNotice({ operation: "ANULACION", invoice: { numero_factura: "20", cuf: "CUF-TEST", estado_fiscal: "REVERTIDA" }, config: { razon_social: "Emisor sintético", nit: "123456" }, motivo: "Error" })).toContain("revertida posteriormente");
  });

  it("acepta respuesta de proveedor sin afirmar entrega y usa idempotencia", async () => {
    const transport = vi.fn(async () => new Response(JSON.stringify({ id: "mock-provider-id-12345" }), { status: 200 }));
    const result = await sendResendEmail({ apiKey: "mock-only", from: "test@example.invalid", to: "buyer@example.invalid", text: "Aviso sintético", attempt: "mock-attempt" }, transport as unknown as typeof fetch);
    expect(result).toBe("mock-provider-id-12345"); expect(transport).toHaveBeenCalledTimes(1);
    const request = transport.mock.calls[0] as unknown as [string, RequestInit];
    expect(request[0]).toBe("https://api.resend.com/emails"); expect(request[1].headers).toMatchObject({ "idempotency-key": "siat-9a/mock-attempt" });
  });

  it("no reintenta correo tras fallo o respuesta incompleta", async () => {
    const transport = vi.fn(async () => { throw new Error("timeout"); });
    await expect(sendResendEmail({ apiKey: "mock-only", from: "test@example.invalid", to: "buyer@example.invalid", text: "Aviso", attempt: "mock-attempt" }, transport as unknown as typeof fetch)).rejects.toThrow("INCIERTO");
    expect(transport).toHaveBeenCalledTimes(1);
    const incomplete = vi.fn(async () => new Response("{}", { status: 200 }));
    await expect(sendResendEmail({ apiKey: "mock-only", from: "test@example.invalid", to: "buyer@example.invalid", text: "Aviso", attempt: "mock-attempt" }, incomplete as unknown as typeof fetch)).rejects.toThrow("INCIERTO");
    expect(incomplete).toHaveBeenCalledTimes(1);
    const unavailable = vi.fn();
    await expect(sendResendEmail({ apiKey: "", from: "", to: "buyer@example.invalid", text: "Aviso", attempt: "mock-attempt" }, unavailable)).rejects.toThrow("NO_CONFIGURADO");
    expect(unavailable).not.toHaveBeenCalled();
  });
});

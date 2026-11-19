import { afterEach, describe, expect, it, vi } from "vitest";
import { OfficialVigenteAdapter } from "../../supabase/functions/_shared/siat/official-vigente.adapter.ts";
import { openFiscalSoapEvidence, prepareFiscalSoapEvidence } from "../../supabase/functions/_shared/siat/fiscal-soap-evidence.ts";
import { fromBase64, sha256Hex, toBase64 } from "../../supabase/functions/_shared/siat/encoding.ts";

const invoice = "11111111-1111-4111-8111-111111111111";
const attempt = "22222222-2222-4222-8222-222222222222";
const keyBytes = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const key64 = toBase64(keyBytes);
const context = { ambiente: "PRUEBAS" as const, versionNormativa: "SIAT_VIGENTE" as const, modalidad: "ELECTRONICA" as const, codigoSistema: "SISTEMA", codigoSucursal: 0, codigoPuntoVenta: null, nit: "1", cuis: "CUISMOCK", cufd: "CUFDMOCK", documentoSector: 1, tipoFactura: 1 };
const owned = (v: Uint8Array) => Uint8Array.from(v).buffer as ArrayBuffer;

afterEach(() => vi.restoreAllMocks());

describe("evidencia SOAP fiscal cifrada, sin red", () => {
  it.each([
    ["ANULACION", 200, '<Envelope><codigoEstado>905</codigoEstado><transaccion>true</transaccion></Envelope>', false],
    ["ANULACION", 200, '<Envelope><codigoEstado>906</codigoEstado><transaccion>false</transaccion></Envelope>', false],
    ["REVERSION", 200, '<Envelope><codigoEstado>907</codigoEstado><transaccion>true</transaccion></Envelope>', false],
    ["REVERSION", 200, '<Envelope><Fault><faultstring>Error simulado</faultstring></Fault></Envelope>', true],
    ["ANULACION", 500, '<Envelope><Fault><faultstring>Error HTTP</faultstring></Fault></Envelope>', true],
  ] as const)("conserva íntegro %s HTTP %s", async (operation, status, body, failure) => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const rpc = async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { error: null }; };
    const capture = await prepareFiscalSoapEvidence(key64, rpc, invoice, operation, attempt);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, { status }));
    const adapter = new OfficialVigenteAdapter("token-delegado-mock", { compraVenta: "https://invalid.test" });
    const task = operation === "ANULACION" ? adapter.anularFactura(context, "CUF", 1, capture) : adapter.revertirAnulacion(context, "CUF", capture);
    if (failure) await expect(task).rejects.toThrow(); else await expect(task).resolves.toBeDefined();
    const saved = calls[1]!.args;
    expect(saved).toMatchObject({ p_intento: attempt, p_estado: "RECIBIDA", p_http: status, p_sha256: await sha256Hex(new TextEncoder().encode(body)) });
    expect(JSON.stringify(calls)).not.toContain(body);
    const key = await crypto.subtle.importKey("raw", owned(keyBytes), "AES-GCM", false, ["decrypt"]);
    const clear = await crypto.subtle.decrypt({ name: "AES-GCM", iv: owned(fromBase64(String(saved.p_nonce))), additionalData: owned(new TextEncoder().encode(`SIAT-9A|${invoice}|${operation}|${attempt}`)) }, key, owned(fromBase64(String(saved.p_cifrado))));
    expect(new TextDecoder().decode(clear)).toBe(body);
    const persisted = { factura_id: invoice, operacion: operation, intento_id: attempt, estado: "RECIBIDA", clave_id: (await sha256Hex(keyBytes)).slice(0, 16), nonce: saved.p_nonce, cifrado: saved.p_cifrado, sha256: saved.p_sha256 };
    expect(new TextDecoder().decode(await openFiscalSoapEvidence(key64, persisted))).toBe(body);
    await expect(openFiscalSoapEvidence(key64, { ...persisted, factura_id: "otra" })).rejects.toThrow("INTEGRIDAD");
    await expect(openFiscalSoapEvidence(toBase64(new Uint8Array(32)), persisted)).rejects.toThrow("NO_DISPONIBLE");
    await expect(crypto.subtle.decrypt({ name: "AES-GCM", iv: owned(fromBase64(String(saved.p_nonce))), additionalData: owned(new TextEncoder().encode("otro intento")) }, key, owned(fromBase64(String(saved.p_cifrado))))).rejects.toThrow();
  });

  it("timeout sin cuerpo no inventa respuesta", async () => {
    const rpc = vi.fn(async () => ({ error: null })); const capture = await prepareFiscalSoapEvidence(key64, rpc, invoice, "ANULACION", attempt);
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("timeout", "AbortError"));
    const adapter = new OfficialVigenteAdapter("token-delegado-mock", { compraVenta: "https://invalid.test" });
    await expect(adapter.anularFactura(context, "CUF", 1, capture)).rejects.toThrow();
    expect(rpc.mock.calls[1]![1]).toMatchObject({ p_estado: "TIMEOUT", p_cifrado: null, p_sha256: null, p_http: null });
  });

  it("rechaza material sensible sin guardarlo", async () => {
    const rpc = vi.fn(async () => ({ error: null })); const capture = await prepareFiscalSoapEvidence(key64, rpc, invoice, "REVERSION", attempt);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('<Fault><token>token-delegado-mock</token></Fault>', { status: 500 }));
    const adapter = new OfficialVigenteAdapter("token-delegado-mock", { compraVenta: "https://invalid.test" });
    await expect(adapter.revertirAnulacion(context, "CUF", capture)).rejects.toThrow();
    expect(rpc.mock.calls[1]![1]).toMatchObject({ p_estado: "BLOQUEADO_SENSIBLE", p_cifrado: null, p_sha256: null });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("token-delegado-mock");
  });

  it("no reserva ni transmite con clave ausente o almacenamiento no disponible", async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    await expect(prepareFiscalSoapEvidence("", rpc, invoice, "ANULACION", attempt)).rejects.toThrow("CLAVE_INVALIDA");
    expect(rpc).not.toHaveBeenCalled();
    await expect(prepareFiscalSoapEvidence(key64, async () => ({ error: new Error("db") }), invoice, "ANULACION", attempt)).rejects.toThrow("RESERVA_FALLIDA");
  });
});

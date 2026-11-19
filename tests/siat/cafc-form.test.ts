import { describe, expect, it, vi } from "vitest";
import { transcribirCafc, type FormularioCafc } from "../../src/features/facturas/services/cafc-transcripcion";

const sale = "11111111-1111-4111-8111-111111111111", event = "22222222-2222-4222-8222-222222222222", range = "33333333-3333-4333-8333-333333333333";
const file = new File(["%PDF-sintetico"], "original.pdf", { type: "application/pdf" });
const form: FormularioCafc = { ventaId: sale, eventoId: event, cafcId: range, numeroFactura: 54, fechaEmision: "2026-11-01T09:00", clienteId: "cliente", metodoPago: "EFECTIVO", tarjetaOfuscada: null, descuentoAdicional: 0, totalOriginal: "5", totalSujetoIva: "5", leyenda: "Leyenda", originalRevisado: true, original: file, items: [{ productoId: "producto", codigoOriginal: "P1", descripcionOriginal: "Perno", subtotalOriginal: "5", cantidad: 1, precioUnitario: 5, descuento: 0 }] };
function services() {
  const records = new Map<string, string>();
  const preparar = vi.fn(async (input: { formulario: Record<string, unknown>; originalBase64: string; originalSha256: string; originalRevisado: true; idempotencyKey: string; ventaId: string | null }) => ({ facturaId: String(input.formulario.facturaId), eventoId: String(input.formulario.eventoId), cafcId: String(input.formulario.cafcId), agenteId: "44444444-4444-4444-8444-444444444444", correlationId: String(input.formulario.correlationId), idempotencyKey: input.idempotencyKey, ventaId: input.ventaId, originalBase64: input.originalBase64, originalSha256: input.originalSha256, originalRevisado: true as const, xmlGzipBase64: "eA==", xmlSha256: "A".repeat(64) }));
  const vincular = vi.fn(async (input: Awaited<ReturnType<typeof preparar>> & { confirmacion: true }) => { records.set(input.idempotencyKey, input.facturaId); return { estado: "VINCULADA" as const, facturaId: input.facturaId }; });
  return { preparar, vincular, records };
}
describe("formulario CAFC y servicios sintéticos", () => {
  it("prepara y vincula con identidad estable en reintentos", async () => {
    const s = services(); const first = await transcribirCafc(form, s); const second = await transcribirCafc(form, s);
    expect(first.facturaId).toBe(second.facturaId); expect(s.records.size).toBe(1); expect(s.preparar.mock.calls[0][0].ventaId).toBe(sale);
    expect(s.vincular.mock.calls[0][0].confirmacion).toBe(true);
  });
  it("bloquea venta ausente y adjunto no revisado antes de invocar servicios", async () => {
    const s = services(); await expect(transcribirCafc({ ...form, ventaId: "" }, s)).rejects.toThrow("venta original");
    await expect(transcribirCafc({ ...form, originalRevisado: false }, s)).rejects.toThrow("adjunta"); expect(s.preparar).not.toHaveBeenCalled();
  });
  it("impide doble clic concurrente sin reenviar", async () => {
    const s = services(); let release!: () => void; const pause = new Promise<void>(resolve => { release = resolve; });
    const original = s.preparar; s.preparar = vi.fn(async (...args: Parameters<typeof original>) => { await pause; return original(...args); });
    const first = transcribirCafc(form, s); await vi.waitFor(() => expect(s.preparar).toHaveBeenCalledOnce());
    await expect(transcribirCafc(form, s)).rejects.toThrow("ya se está procesando"); release(); await first; expect(s.vincular).toHaveBeenCalledOnce();
  });
  it("permite reintentar con la misma identidad después de un error de conexión", async () => {
    const s = services(); const link = s.vincular;
    s.vincular = vi.fn().mockRejectedValueOnce(new Error("Conexión interrumpida")).mockImplementation(link);
    await expect(transcribirCafc(form, s)).rejects.toThrow("Conexión interrumpida");
    await transcribirCafc(form, s);
    expect(s.preparar.mock.calls[0][0].idempotencyKey).toBe(s.preparar.mock.calls[1][0].idempotencyKey);
    expect(s.records.size).toBe(1);
  });
});

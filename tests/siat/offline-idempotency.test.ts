import { describe, expect, it, vi } from "vitest";
import { finishOfflineSale, offlineSaleKey } from "../../src/features/facturas/services/offline-idempotency";

describe("identidad de venta offline", () => {
  it("conserva la clave en respuesta perdida y la renueva solo tras éxito", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => { values.delete(k); } };
    const random = vi.fn().mockReturnValueOnce("11111111-1111-4111-8111-111111111111").mockReturnValueOnce("22222222-2222-4222-8222-222222222222");
    const first = offlineSaleKey(storage, random);
    expect(offlineSaleKey(storage, random)).toBe(first);
    expect(random).toHaveBeenCalledTimes(1);
    finishOfflineSale(storage);
    expect(offlineSaleKey(storage, random)).not.toBe(first);
  });
  it("bloquea una clave pendiente corrupta", () => {
    expect(() => offlineSaleKey({ getItem: () => "invalida", setItem: () => {} })).toThrow("requiere revisión");
  });
});

import { describe, expect, it, vi } from "vitest";
import { SiatRepository } from "../../supabase/functions/_shared/siat/repository.ts";

it("resuelve CUIS/CUFD por UUID de la sucursal sin enviar undefined", async () => {
  const branchId = "6adbd463-6037-4c84-882c-ffc096e0054f";
  const cuis = { id: "cuis-real", codigo: "CUIS", sucursal_id: branchId, punto_venta_id: null, ambiente: "PRUEBAS", estado: "VIGENTE", fecha_expiracion: "2099-01-01T00:00:00Z" };
  const cufd = { id: "cufd-real", codigo: "CUFD", cuis_id: cuis.id, sucursal_id: branchId, punto_venta_id: null, ambiente: "PRUEBAS", estado: "VIGENTE", fecha_inicio: "2026-01-01T00:00:00Z", fecha_expiracion: "2099-01-01T00:00:00Z" };
  const filters: Array<[string, unknown]> = [];
  const db = { from: vi.fn((table: string) => {
    const query = {
      select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      is: () => query, gt: () => query, lte: () => query, order: () => query, limit: () => query,
      maybeSingle: async () => ({ data: table === "siat_cuis" ? cuis : cufd, error: null }),
    };
    return query;
  }) };
  const repository = new SiatRepository(db as never);
  expect((await repository.activeFiscalCodes(branchId, null, "PRUEBAS")).cufd.id).toBe(cufd.id);
  expect((await repository.activeCuis({ sucursal_predeterminada_id: branchId, punto_venta_predeterminado_id: null, ambiente: "PRUEBAS" }))?.id).toBe(cuis.id);
  expect(filters.filter(([key]) => key === "sucursal_id")).toEqual([["sucursal_id", branchId], ["sucursal_id", branchId], ["sucursal_id", branchId]]);
  expect(filters.some(([, value]) => value === undefined)).toBe(false);
});

function repositoryWithCounts(counts: number[]) {
  let next = 0;
  const db = { from: vi.fn(() => {
    const count = counts[next++];
    const query = { select: () => query, eq: () => query, in: () => query, neq: () => query, not: () => query,
      then: (resolve: (value: unknown) => void) => Promise.resolve({ count, error: null }).then(resolve) };
    return query;
  }) };
  const repository = new SiatRepository(db as never); const update = vi.spyOn(repository, "updateEvent").mockResolvedValue();
  return { repository, update };
}

describe("consolidación de eventos sin resultados parciales", () => {
  it("no declara validado un evento con factura pendiente fuera de la primera página", async () => {
    const { repository, update } = repositoryWithCounts([3, 0, 0, 1500, 1]);
    await repository.refreshEventFromPackages("event");
    expect(update).toHaveBeenCalledWith("event", { estado: "OBSERVADO" });
  });
  it("solo valida con paquetes y facturas completas; espera cuando hay trabajos activos", async () => {
    const complete = repositoryWithCounts([3, 0, 0, 1500, 0]);
    await complete.repository.refreshEventFromPackages("event"); expect(complete.update).toHaveBeenCalledWith("event", { estado: "VALIDADO" });
    const pending = repositoryWithCounts([3, 1, 0, 1500, 0]);
    await pending.repository.refreshEventFromPackages("event"); expect(pending.update).not.toHaveBeenCalled();
  });
});

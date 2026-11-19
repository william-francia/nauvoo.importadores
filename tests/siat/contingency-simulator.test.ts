import { afterEach, describe, expect, it, vi } from "vitest";
import { SyntheticContingencySin } from "../fixtures/siat-contingency-simulator.ts";
import type { SiatContext } from "../../supabase/functions/_shared/siat/types.ts";

const context: SiatContext = { ambiente: "PRUEBAS", versionNormativa: "SIAT_VIGENTE", modalidad: "ELECTRONICA", nit: "123456789", codigoSistema: "TEST", codigoSucursal: 0, codigoPuntoVenta: null, cuis: "CUIS-SYNTHETIC" };
afterEach(() => vi.unstubAllGlobals());

describe("simulador SIAT aislado", () => {
  it("opera sin ninguna comunicación de red", async () => {
    const network = vi.fn(() => { throw new Error("RED_PROHIBIDA"); });
    vi.stubGlobal("fetch", network);
    const simulator = new SyntheticContingencySin();
    expect((await simulator.solicitarCufd(context)).codigo).toBe("CUFD-SYNTHETIC-NEW");
    expect((await simulator.verificarFactura(context)).codigoEstado).toBe(908);
    expect(network).not.toHaveBeenCalled();
  });
  it.each([{ ambiente: "PRODUCCION" }, { nit: "72229012" }, { codigoSistema: "real" }])("rechaza ámbito real o no sintético: %o", async (override) => {
    await expect(new SyntheticContingencySin().solicitarCufd({ ...context, ...override } as SiatContext)).rejects.toThrow("SIMULADOR_CONTEXTO_NO_SINTETICO");
  });
});

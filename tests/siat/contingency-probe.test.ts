import { describe, expect, it, vi } from "vitest";
import { probeContingencyDenial } from "../../supabase/functions/_shared/siat/contingency-probe.ts";

describe("prueba 9B de solo lectura", () => {
  it("confirma Edge/RPC únicamente ante el rechazo esperado", async () => {
    const rpc = vi.fn(async () => ({ error: { message: "Evento no disponible para este agente." } }));
    await expect(probeContingencyDenial(rpc)).resolves.toMatchObject({ rechazoEsperado: true, escritura: false });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("siat_9b_estado_recuperacion", { p_agente: expect.any(String), p_evento: expect.any(String) });
  });
  it("rechaza respuestas inesperadas y errores de infraestructura", async () => {
    await expect(probeContingencyDenial(async () => ({ error: null }))).rejects.toThrow("NO_CONCLUYENTE");
    await expect(probeContingencyDenial(async () => ({ error: { message: "RPC no existe" } }))).rejects.toThrow("NO_CONCLUYENTE");
  });
});

import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "../../agent-local/src/config.ts";
import type { AgentStore } from "../../agent-local/src/store.ts";
import type { LocalSession } from "../../agent-local/src/types.ts";
import { LocalAgentApp } from "../../agent-local/src/app.ts";

const prepare = vi.hoisted(() => vi.fn(() => ({ xml: "<xml-sintetico/>", cuf: "TEST", originalSha256: "A".repeat(64), fingerprint: "B".repeat(64) })));
vi.mock("../../agent-local/src/manual-cafc.ts", () => ({ prepareManualCafcXml: prepare }));
vi.mock("../../agent-local/src/contingency-safety.ts", async (load) => ({ ...(await load<typeof import("../../agent-local/src/contingency-safety.ts")>()), assertContingencyPilotReady: () => {}, assertCafcEnabled: () => {} }));

const session = { id: "test", userId: "admin", userName: "Administrador", role: "administrador", expiresAt: "2099-01-01T00:00:00Z" } satisfies LocalSession;
const snapshot = { id: "11111111-1111-4111-8111-111111111111", correlationId: "22222222-2222-4222-8222-222222222222" };
const localEvent = { id: "33333333-3333-4333-8333-333333333333", cafcId: "range", cufdId: "cufd", cufd: { id: "cufd" }, tipoEventoCodigo: "5", fechaInicio: "2026-11-01T12:00:00Z", fechaFin: "2026-11-01T13:00:00Z" };
function setup(event: Record<string, unknown> | null = localEvent) {
  const store = { getState: () => ({ state: "REGISTRANDO_EVENTO" }), pendingRecoveryEvent: () => event, closedEvent: (id: string) => id === event?.id ? event : null,
    getBootstrap: () => ({ agentId: "44444444-4444-4444-8444-444444444444", branch: { id: "branch", codigo: 0 }, point: null, config: { nit: "123456789" }, cafc: [{ id: "range" }] }) };
  return new LocalAgentApp({} as AgentConfig, store as unknown as AgentStore);
}
const input = { snapshot, originalBase64: Buffer.from("prueba").toString("base64"), originalSha256: "A".repeat(64), originalRevisado: true, idempotencyKey: "idempotencia-cafc-123456", ventaId: null };

describe("preparación administrativa de CAFC en agente", () => {
  it("devuelve el XML preparado sin crear venta ni exigir una venta ficticia", async () => {
    const result = await setup().prepareManualCafc(session, input);
    expect(gunzipSync(Buffer.from(result.xmlGzipBase64, "base64")).toString()).toBe("<xml-sintetico/>");
    expect(result.xmlSha256).toBe(createHash("sha256").update(Buffer.from(result.xmlGzipBase64, "base64")).digest("hex").toUpperCase());
    expect(result).toMatchObject({ facturaId: snapshot.id, ventaId: null, cafcId: "range", originalRevisado: true });
    expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ event: expect.objectContaining({ cafc_id: "range", cufd_id: "cufd" }), originalReviewed: true }));
  });
  it("bloquea usuarios no administradores y eventos sin CAFC", async () => {
    await expect(setup().prepareManualCafc({ ...session, role: "vendedor" }, input)).rejects.toThrow("administración");
    await expect(setup({ ...localEvent, cafcId: null }).prepareManualCafc(session, input)).rejects.toThrow("EVENTO_CERRADO");
  });
  it("exige seleccionar el evento cerrado exacto del formulario", async () => {
    await expect(setup().prepareManualCafc(session, { ...input, formulario: { eventoId: "otro" } })).rejects.toThrow("EVENTO_CERRADO");
  });
  it("conserva el CAFC del evento y rechaza uno de otra sucursal", async () => {
    const now = Date.now(); const begin = new Date(now - 60_000).toISOString(), end = new Date(now + 60_000).toISOString();
    const store = { getState: () => ({ state: "DEGRADADO" }), activeEvent: () => null, startEvent: vi.fn(async () => {}), setState: vi.fn(async () => {}),
      getBootstrap: () => ({ config: { ambiente: "PRUEBAS" }, branch: { id: "branch" }, point: null, cufd: { id: "cufd", fecha_inicio: begin, fecha_expiracion: end },
        cafc: [{ id: "range", estado: "VIGENTE", sucursal_id: "branch", punto_venta_id: null, vigente_desde: begin, vigente_hasta: end }] }) };
    const app = new LocalAgentApp({} as AgentConfig, store as unknown as AgentStore);
    const result = await app.manualEvent(session, { tipoEventoCodigo: "5", descripcion: "Falla de prueba", evidencia: "Evidencia sintética para prueba", cafcId: "range" });
    expect(result.cafcId).toBe("range"); expect(store.startEvent).toHaveBeenCalledOnce();
    const invalid = new LocalAgentApp({} as AgentConfig, store as unknown as AgentStore);
    await expect(invalid.manualEvent(session, { tipoEventoCodigo: "5", descripcion: "Falla", evidencia: "Evidencia sintética", cafcId: "otro" })).rejects.toThrow("EVENTO_CAFC_NO_AUTORIZADO");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalAgentApp } from "../../agent-local/src/app.ts";
import type { AgentConfig } from "../../agent-local/src/config.ts";
import type { AgentStore } from "../../agent-local/src/store.ts";

const config: AgentConfig = { port: 4737, host: "127.0.0.1", dataDir: "unused", agentCode: "TEST", sharedSecret: "a".repeat(32), storageSecret: "b".repeat(32), ingestUrl: "https://invalid", supabaseUrl: "https://invalid", supabaseAnonKey: "anon", allowedOrigins: new Set(), sessionHours: 12, version: "test", defaultEventCode: null };
const store = () => ({ getState: () => ({ state: "ONLINE", evidence: {} }), activeEvent: () => null, pendingRecoveryEvent: () => null, pendingCount: () => 0 } as unknown as AgentStore);
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("disponibilidad del agente sin habilitar contingencia", () => {
  it("notifica al backend sin afirmar comunicacion con el SIN", async () => {
    vi.stubEnv("SIAT_CONTINGENCIA_PILOTO_HABILITADA", "false");
    const app = new LocalAgentApp(config, store());
    const send = vi.spyOn(app.remote, "action").mockResolvedValue({ ok: true });
    await app.reportDisabledAvailability();
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ action: "heartbeat", estado: "DEGRADADO", servicioSiatOnline: null, evidencia: { modo: "FISCAL_DESHABILITADO", siatVerificado: false } }));
  });

  it("no sobrescribe una contingencia pendiente ni ejecuta el aviso en modo fiscal habilitado", async () => {
    vi.stubEnv("SIAT_CONTINGENCIA_PILOTO_HABILITADA", "false");
    const pending = store(); vi.spyOn(pending, "pendingRecoveryEvent").mockReturnValue({ id: "evento" });
    const app = new LocalAgentApp(config, pending);
    const send = vi.spyOn(app.remote, "action").mockResolvedValue({ ok: true });
    await app.reportDisabledAvailability();
    vi.stubEnv("SIAT_CONTINGENCIA_PILOTO_HABILITADA", "true"); vi.stubEnv("SIAT_CONTINGENCIA_AMBIENTE", "PRUEBAS");
    await app.reportDisabledAvailability();
    expect(send).not.toHaveBeenCalled();
  });

  it("reanuda el aviso periodico al iniciar de nuevo", async () => {
    vi.useFakeTimers(); vi.stubEnv("SIAT_CONTINGENCIA_PILOTO_HABILITADA", "false");
    const app = new LocalAgentApp(config, store());
    const send = vi.spyOn(app.remote, "action").mockResolvedValue({ ok: true });
    app.start(); await vi.advanceTimersByTimeAsync(30_000); app.stop();
    app.start(); await vi.advanceTimersByTimeAsync(0); app.stop();
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls.every(([body]) => body.action === "heartbeat")).toBe(true);
  });
});

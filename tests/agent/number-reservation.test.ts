import { afterEach, expect, it, vi } from "vitest";
import { RemoteGateway } from "../../agent-local/src/remote.ts";
import type { AgentConfig } from "../../agent-local/src/config.ts";
import { assertCafcEnabled } from "../../agent-local/src/contingency-safety.ts";
import { LocalAgentApp } from "../../agent-local/src/app.ts";
import type { AgentStore } from "../../agent-local/src/store.ts";

const config: AgentConfig = { port: 4737, host: "127.0.0.1", dataDir: "unused", agentCode: "TEST", sharedSecret: "a".repeat(32), storageSecret: "b".repeat(32), ingestUrl: "https://invalid", supabaseUrl: "https://invalid", supabaseAnonKey: "anon", allowedOrigins: new Set(), sessionHours: 12, version: "test", defaultEventCode: null };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("exige una cantidad explícita y la envía al contrato de aprovisionamiento", async () => {
  const remote = new RemoteGateway(config);
  const send = vi.spyOn(remote, "action").mockResolvedValue({});
  expect(() => remote.bootstrap(0)).toThrow("CANTIDAD_RESERVA_OFFLINE_INVALIDA");
  expect(() => remote.bootstrap(Number.NaN)).toThrow("CANTIDAD_RESERVA_OFFLINE_INVALIDA");
  expect(() => remote.bootstrap(1.5)).toThrow("CANTIDAD_RESERVA_OFFLINE_INVALIDA");
  expect(send).not.toHaveBeenCalled();
  await remote.bootstrap(2);
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ action: "bootstrap", reserveNumbers: true, reserveCount: 2 }), 40_000);
});

it("mantiene CAFC deshabilitado independientemente del flujo digital", () => {
  expect(() => assertCafcEnabled()).toThrow("CAFC_DESHABILITADO_PENDIENTE_AUTORIZACION");
});

it("bloquea eventos CAFC incluso con contingencias digitales activas", async () => {
  vi.stubEnv("SIAT_CONTINGENCIA_PILOTO_HABILITADA", "true"); vi.stubEnv("SIAT_CONTINGENCIA_AMBIENTE", "PRUEBAS");
  const store = { getState: () => ({ state: "DEGRADADO" }), activeEvent: () => null, startEvent: vi.fn() };
  const app = new LocalAgentApp(config, store as unknown as AgentStore);
  const admin = { id: "s", userId: "u", userName: "Admin", role: "administrador", expiresAt: "2099-01-01" };
  for (const code of ["5", "6", "7"]) await expect(app.manualEvent(admin, { tipoEventoCodigo: code, cafcId: "CAFC-SINTETICO", evidencia: "evidencia sintética" })).rejects.toThrow("CAFC_DESHABILITADO_PENDIENTE_AUTORIZACION");
  expect(store.startEvent).not.toHaveBeenCalled();
});

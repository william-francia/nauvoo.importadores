import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ handler: null as unknown, nonces: new Set<string>(), rpc: vi.fn(), operations: [] as string[], ambiente: "PRUEBAS" }));
vi.mock("../../supabase/functions/_shared/siat/runtime.ts", () => ({
  json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  officialAdapter: () => { throw new Error("SIN bloqueado en prueba"); },
  secureEquals: async (a: string, b: string) => a === b,
  serviceClient: () => ({
    from: (table: string) => {
      state.operations.push(table);
      if (table === "siat_agentes_locales") return { select: () => ({ eq: () => ({ neq: () => ({ single: async () => ({ data: { id: "agent-synthetic" }, error: null }) }) }) }) };
      if (table === "siat_configuracion") return { select: () => ({ eq: () => ({ single: async () => ({ data: { ambiente: state.ambiente, siat_habilitado: false }, error: null }) }) }) };
      if (table === "siat_agent_nonces") return { insert: async (row: { nonce: string }) => { if (state.nonces.has(row.nonce)) return { error: true }; state.nonces.add(row.nonce); return { error: null }; } };
      throw new Error(`Acceso no permitido: ${table}`);
    },
    rpc: state.rpc,
  }),
}));

const secret = "synthetic-only-secret-000000000000000";
const makeRequest = (nonce: string, signatureCorrect = true, payload: Record<string, unknown> = { action: "probe-9b-persistencia", contrato: 2 }) => {
  const body = JSON.stringify(payload); const time = String(Date.now());
  const signature = createHmac("sha256", secret).update(`${time}.${nonce}.${body}`).digest("hex");
  return new Request("http://local.invalid", { method: "POST", body, headers: { "x-siat-agent": "SINTETICO", "x-siat-timestamp": time, "x-siat-nonce": nonce, "x-siat-signature": signatureCorrect ? signature : "0".repeat(64) } });
};
beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: (key: string) => key === "SIAT_AGENT_SHARED_SECRET" ? secret : process.env[key] }, serve: (handler: unknown) => { state.handler = handler; } });
  await import("../../supabase/functions/siat-local-ingest/index.ts");
});
beforeEach(() => { state.nonces.clear(); state.operations = []; state.ambiente = "PRUEBAS"; state.rpc.mockReset(); vi.stubEnv("SIAT_CONTINGENCIA_PILOTO_HABILITADA", "false"); });
afterAll(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("sonda Edge autenticada aislada", () => {
  it("confirma la persistencia de un nonce sintético por RPC sin invocar otras tablas", async () => {
    const nonce = `9bprobe_${"a".repeat(32)}`;
    state.rpc.mockImplementation(async (name, args) => ({ data: { persistido: name === "siat_9b_verificar_nonce_prueba" && args.p_agente === "agent-synthetic" && state.nonces.has(args.p_nonce) }, error: null }));
    const handler = state.handler as (request: Request) => Promise<Response>;
    const response = await handler(makeRequest(nonce));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ edge: true, rpc: "siat_9b_verificar_nonce_prueba", persistido: true, fiscal: false });
    expect(state.operations).toEqual(["siat_agentes_locales", "siat_configuracion", "siat_agent_nonces"]); expect(state.rpc).toHaveBeenCalledOnce();
    expect((await handler(makeRequest(nonce))).status).toBe(401);
  });
  it("rechaza firma incorrecta y no ejecuta RPC cuando 9B está activo", async () => {
    const handler = state.handler as (request: Request) => Promise<Response>;
    expect((await handler(makeRequest(`9bprobe_${"b".repeat(32)}`, false))).status).toBe(401);
    expect(state.operations).toEqual([]);
    vi.stubEnv("SIAT_CONTINGENCIA_PILOTO_HABILITADA", "true");
    expect((await handler(makeRequest(`9bprobe_${"c".repeat(32)}`))).status).not.toBe(200);
    expect(state.nonces.size).toBe(0); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("rechaza producción antes de escribir el nonce", async () => {
    state.ambiente = "PRODUCCION";
    const handler = state.handler as (request: Request) => Promise<Response>;
    expect((await handler(makeRequest(`9bprobe_${"d".repeat(32)}`))).status).not.toBe(200);
    expect(state.nonces.size).toBe(0); expect(state.rpc).not.toHaveBeenCalled();
  });
  it("solo permite preparar un número al agente seleccionado, manteniendo bloqueada la contingencia", async () => {
    const handler = state.handler as (request: Request) => Promise<Response>;
    vi.stubEnv("SIAT_CONTINGENCIA_AGENTE_CODIGO", "SINTETICO");
    const denied = await handler(makeRequest(`9bprobe_${"e".repeat(32)}`, true, { action: "bootstrap", contrato: 2, reserveNumbers: true, reserveCount: 2 }));
    expect(denied.status).toBe(409);
    const pending = await handler(makeRequest(`9bprobe_${"f".repeat(32)}`, true, { action: "import-event", contrato: 2 }));
    expect(pending.status).toBe(409);
    const allowed = await handler(makeRequest(`9bprobe_${"1".repeat(32)}`, true, { action: "bootstrap", contrato: 2, reserveNumbers: true, reserveCount: 1 }));
    expect(allowed.status).toBe(400); // El fixture niega toda lectura de tablas comerciales.
    expect(state.operations).toContain("siat_sucursales");
  });
});

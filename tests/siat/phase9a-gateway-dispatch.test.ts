import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), env: vi.fn(), fetch: vi.fn(), role: "administrador" }));
vi.mock("../../supabase/functions/_shared/siat/repository.ts", () => ({ SiatRepository: class {} }));
vi.mock("../../supabase/functions/_shared/siat/runtime.ts", () => ({
  serviceClient: () => ({ rpc: mocks.rpc }),
  authenticatedUser: async () => ({ authId: "11111111-1111-4111-8111-111111111111", profile: { rol: mocks.role } }),
  corsHeaders: () => ({}), json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
  officialAdapter: () => { throw new Error("SIN BLOQUEADO EN PRUEBA"); }, siatCredentialStatus: () => ({}),
}));

let handler: (request: Request) => Promise<Response>;
const input = { action: "cancel", facturaId: "22222222-2222-4222-8222-222222222222", motivo: 1,
  idempotencia: "33333333-3333-4333-8333-333333333333", confirmacion: true, noUtilizadaDdjj: true };
const request = (overrides: Record<string, unknown> = {}) => new Request("https://gateway.invalid", { method: "POST", body: JSON.stringify({ ...input, ...overrides }) });

beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: mocks.env }, serve: (callback: typeof handler) => { handler = callback; } });
  vi.stubGlobal("fetch", mocks.fetch);
  await import("../../supabase/functions/siat-gateway/index.ts");
});
beforeEach(() => {
  vi.resetAllMocks(); mocks.role = "administrador";
  mocks.env.mockImplementation((name: string) => ({ SIAT_WORKER_SECRET: "synthetic-worker-secret", SUPABASE_URL: "https://worker.invalid",
    SIAT_ANULACION_PILOTO_HABILITADA: "true", SIAT_NOTIFICACION_HMAC_KEY: "x".repeat(32) })[name]);
  mocks.rpc.mockResolvedValue({ data: "ANULACION_PENDIENTE", error: null });
  mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ processed: 1, failures: [] })));
});
afterAll(() => vi.unstubAllGlobals());

describe("9A: despacho simulado después de autorización RPC", () => {
  it("encola mediante la RPC confirmada y despierta el worker existente una vez", async () => {
    const response = await handler(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ estado: "ANULACION_PENDIENTE", worker: { processed: 1, failures: [] } });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("siat_solicitar_operacion_factura_confirmada", expect.objectContaining({ p_confirmacion: true, p_idempotencia: input.idempotencia }));
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith("https://worker.invalid/functions/v1/siat-worker", { method: "POST", headers: { "x-worker-secret": "synthetic-worker-secret" } });
    expect(mocks.rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.fetch.mock.invocationCallOrder[0]);
  });
  it.each(["flag", "rol", "confirmacion", "reverse"])("no encola ni despacha cuando falta permiso: %s", async (reason) => {
    if (reason === "flag") mocks.env.mockReturnValue(undefined);
    if (reason === "rol") mocks.role = "vendedor";
    const response = await handler(request(reason === "confirmacion" ? { confirmacion: false } : reason === "reverse" ? { action: "reverse" } : {}));
    expect(response.ok).toBe(false); expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("no despacha si la RPC rechaza la factura o autorización", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error("Factura protegida") });
    expect((await handler(request())).status).toBe(400); expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("un reintento ya terminado no despierta el worker", async () => {
    mocks.rpc.mockResolvedValue({ data: "ANULADA", error: null });
    expect(await (await handler(request())).json()).toEqual({ estado: "ANULADA" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it.each(["timeout", "http"])("conserva la solicitud y advierte sin repetir ante %s del dispatcher", async (reason) => {
    if (reason === "timeout") mocks.fetch.mockRejectedValue(new Error("Worker sin respuesta"));
    else mocks.fetch.mockResolvedValue(new Response("unavailable", { status: 503 }));
    const response = await handler(request()); const result = await response.json();
    expect(response.status).toBe(202); expect(result.estado).toBe("ANULACION_PENDIENTE");
    expect(result.worker.failures[0]).toContain(reason === "timeout" ? "sin respuesta" : "503");
    expect(mocks.rpc).toHaveBeenCalledOnce(); expect(mocks.fetch).toHaveBeenCalledOnce();
  });
  it("expone fallos del worker sin convertir el despacho en éxito fiscal", async () => {
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ processed: 1, failures: ["SOAP Fault"] })));
    const result = await (await handler(request())).json();
    expect(result.estado).toBe("ANULACION_PENDIENTE"); expect(result.worker.failures).toEqual(["SOAP Fault"]);
  });
});

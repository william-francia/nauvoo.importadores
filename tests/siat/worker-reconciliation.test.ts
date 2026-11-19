import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  repository: { invoice: vi.fn(), configuration: vi.fn(), claimHeldReconciliation: vi.fn(), claimHeldReconciliationWithCurrentCufd: vi.fn(), currentCufdForInvoice: vi.fn(), claim: vi.fn(), retryJob: vi.fn() },
  engine: { reconcile: vi.fn(), process: vi.fn() },
  env: vi.fn(),
}));

vi.mock("../../supabase/functions/_shared/siat/repository.ts", () => ({
  SiatRepository: vi.fn(function () { return mocks.repository; }),
}));
vi.mock("../../supabase/functions/_shared/siat/engine.ts", () => ({
  SiatEngine: vi.fn(function () { return mocks.engine; }),
  errorMessage: (error: unknown) => error instanceof Error ? error.message : String(error),
}));
vi.mock("../../supabase/functions/_shared/siat/runtime.ts", () => ({
  json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
  serviceClient: () => ({}),
  officialAdapter: () => ({}),
  secureEquals: async (left: string, right: string) => left === right,
}));

const facturaId = "c2279bbb-e851-468b-afe6-8ebf0b436d28";
const outboxId = "e4d9ce8e-1c5c-4a08-94db-f4f50c3a8a0e";
const cuf = "CUF_EXISTENTE_DE_PRUEBA";
const operation = { action: "reconcile-held-invoice-once", facturaId, outboxId, cuf };
const invoice = { id: facturaId, ambiente: "PRUEBAS", origen_fiscal: "PILOTO", estado_fiscal: "SIN_RESPUESTA", cuf, codigo_estado: 902 };
const job = { id: outboxId, factura_id: facturaId, estado: "CANCELADA", payload: { reenvioAutomaticoBloqueado: true } };
const currentCufd = { id: "nuevo-cufd", codigo: "CUFD_VIGENTE", ambiente: "PRUEBAS", estado: "VIGENTE", cuis_id: "cuis",
  sucursal_id: "branch", punto_venta_id: null, fecha_inicio: "2026-10-29T00:00:00Z", fecha_expiracion: "2026-10-31T00:00:00Z" };
const currentOperation = { ...operation, action: "reconcile-held-invoice-with-current-cufd-once" };
let handler: (request: Request) => Promise<Response>;

beforeAll(async () => {
  vi.stubGlobal("Deno", { env: { get: mocks.env }, serve: (callback: typeof handler) => { handler = callback; }, readTextFile: vi.fn() });
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Las pruebas no permiten acceso de red")));
  await import("../../supabase/functions/siat-worker/index.ts");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.mockImplementation((name: string) => ({ SIAT_WORKER_SECRET: "test-worker-secret", SUPABASE_SERVICE_ROLE_KEY: "test-service-role" })[name]);
  mocks.repository.invoice.mockResolvedValue({ ...invoice });
  mocks.repository.configuration.mockResolvedValue({ ambiente: "PRUEBAS", siat_habilitado: false });
  mocks.repository.claimHeldReconciliation.mockResolvedValue(job);
  mocks.repository.claimHeldReconciliationWithCurrentCufd.mockResolvedValue(job);
  mocks.repository.currentCufdForInvoice.mockResolvedValue(currentCufd);
  mocks.repository.claim.mockResolvedValue(null);
  mocks.engine.reconcile.mockResolvedValue({ codigoEstado: 924, transaccion: false, mensajes: [] });
});

afterAll(() => vi.unstubAllGlobals());

const request = (body: unknown = operation, authorization = "Bearer test-service-role") => new Request("https://worker.invalid", {
  method: "POST", headers: { authorization, "content-type": "application/json" }, body: JSON.stringify(body),
});

describe("worker: conciliación dirigida sin recepción ni cola", () => {
  it("permite a service role exactamente una consulta dirigida sin cargar la firma", async () => {
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(mocks.repository.claimHeldReconciliation).toHaveBeenCalledExactlyOnceWith(facturaId, outboxId);
    expect(mocks.engine.reconcile).toHaveBeenCalledExactlyOnceWith(job, { singleShot: true });
    expect(mocks.repository.claim).not.toHaveBeenCalled();
    expect(mocks.engine.process).not.toHaveBeenCalled();
    expect(mocks.repository.retryJob).not.toHaveBeenCalled();
    expect(mocks.env).not.toHaveBeenCalledWith("SIAT_PRIVATE_KEY_PEM");
    expect(mocks.env).not.toHaveBeenCalledWith("SIAT_CERTIFICATE_PEM");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("el segundo request concurrente no vuelve a consultar cuando falla el claim", async () => {
    let claimed = false;
    mocks.repository.claimHeldReconciliation.mockImplementation(async () => {
      if (claimed) throw new Error("CONCILIACION_UNICA_YA_SOLICITADA");
      claimed = true;
      return job;
    });
    const responses = await Promise.all([handler(request()), handler(request())]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(mocks.engine.reconcile).toHaveBeenCalledTimes(1);
    expect(mocks.repository.claim).not.toHaveBeenCalled();
    expect(mocks.repository.retryJob).not.toHaveBeenCalled();
  });

  it("consulta con CUFD vigente una sola vez y sin procesar el outbox retenido", async () => {
    const response = await handler(request(currentOperation));
    expect(response.status).toBe(200);
    expect(mocks.repository.currentCufdForInvoice).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: facturaId }));
    expect(mocks.repository.claimHeldReconciliationWithCurrentCufd).toHaveBeenCalledExactlyOnceWith(facturaId, outboxId, currentCufd.id);
    expect(mocks.engine.reconcile).toHaveBeenCalledExactlyOnceWith(job, { singleShot: true, currentCufd });
    expect(mocks.repository.claim).not.toHaveBeenCalled();
    expect(mocks.engine.process).not.toHaveBeenCalled();
  });

  it("sin CUFD vigente no reserva una consulta ni llama al SIN", async () => {
    mocks.repository.currentCufdForInvoice.mockRejectedValue(new Error("CONCILIACION_CUFD_VIGENTE_NO_DISPONIBLE"));
    const response = await handler(request(currentOperation));
    expect(response.status).toBe(409);
    expect(mocks.repository.claimHeldReconciliationWithCurrentCufd).not.toHaveBeenCalled();
    expect(mocks.engine.reconcile).not.toHaveBeenCalled();
  });

  it("bloquea concurrencia de la segunda consulta sin ejecutar dos verificaciones", async () => {
    let reserved = false;
    mocks.repository.claimHeldReconciliationWithCurrentCufd.mockImplementation(async () => {
      if (reserved) throw new Error("CONCILIACION_CUFD_VIGENTE_YA_SOLICITADA");
      reserved = true;
      return job;
    });
    const responses = await Promise.all([handler(request(currentOperation)), handler(request(currentOperation))]);
    expect(responses.map((item) => item.status).sort()).toEqual([200, 409]);
    expect(mocks.engine.reconcile).toHaveBeenCalledTimes(1);
  });

  it("requiere credencial administrativa y los identificadores de la factura retenida", async () => {
    const workerOnly = new Request("https://worker.invalid", { method: "POST", headers: { "x-worker-secret": "test-worker-secret" }, body: JSON.stringify(currentOperation) });
    expect((await handler(workerOnly)).status).toBe(401);
    expect((await handler(request({ ...currentOperation, facturaId: "11111111-1111-4111-8111-111111111111" }))).status).toBe(409);
    expect(mocks.repository.currentCufdForInvoice).not.toHaveBeenCalled();
    expect(mocks.engine.reconcile).not.toHaveBeenCalled();
  });

  it.each([{}, { action: "emit" }, { action: "reconcile-held-invoice-once-extra" }])("service role no puede drenar la cola: %j", async (body) => {
    expect((await handler(request(body))).status).toBe(401);
    expect(mocks.repository.claim).not.toHaveBeenCalled();
    expect(mocks.engine.process).not.toHaveBeenCalled();
    expect(mocks.engine.reconcile).not.toHaveBeenCalled();
  });

  it("rechaza credenciales incorrectas sin consultar ni reservar", async () => {
    expect((await handler(request(operation, "Bearer invalid"))).status).toBe(401);
    expect(mocks.repository.claimHeldReconciliation).not.toHaveBeenCalled();
    expect(mocks.engine.reconcile).not.toHaveBeenCalled();
  });

  it.each([
    { body: { ...operation, facturaId: "invalid" }, status: 400 },
    { body: { ...operation, outboxId: "invalid" }, status: 400 },
    { body: { ...operation, cuf: "OTRO_CUF" }, status: 409 },
  ])("rechaza identificadores o CUF fuera de alcance: $status", async ({ body, status }) => {
    expect((await handler(request(body))).status).toBe(status);
    expect(mocks.repository.claimHeldReconciliation).not.toHaveBeenCalled();
    expect(mocks.engine.reconcile).not.toHaveBeenCalled();
  });

  it.each([
    { config: { ambiente: "PRODUCCION", siat_habilitado: false }, invoice },
    { config: { ambiente: "PRUEBAS", siat_habilitado: true }, invoice },
    { config: { ambiente: "PRUEBAS", siat_habilitado: false }, invoice: { ...invoice, ambiente: "PRODUCCION" } },
    { config: { ambiente: "PRUEBAS", siat_habilitado: false }, invoice: { ...invoice, origen_fiscal: "VENTA" } },
    { config: { ambiente: "PRUEBAS", siat_habilitado: false }, invoice: { ...invoice, estado_fiscal: "VALIDADA" } },
  ])("rechaza producción, emisión general, ventas y facturas ya resueltas", async (fixture) => {
    mocks.repository.configuration.mockResolvedValue(fixture.config);
    mocks.repository.invoice.mockResolvedValue(fixture.invoice);
    expect((await handler(request())).status).toBe(409);
    expect(mocks.repository.claimHeldReconciliation).not.toHaveBeenCalled();
    expect(mocks.engine.reconcile).not.toHaveBeenCalled();
  });
});

describe("reserva atómica de conciliación retenida", () => {
  it("el repositorio permite un solo claim concurrente y conserva el error previo", async () => {
    const { SiatRepository } = await vi.importActual<typeof import("../../supabase/functions/_shared/siat/repository.ts")>("../../supabase/functions/_shared/siat/repository.ts");
    const held: Record<string, unknown> = { ...job, locked_by: null, locked_until: null, ultimo_error: "SOAP_FAULT_PREVIO", intentos: 1 };
    const from = vi.fn(() => {
      const filters: Array<[string, unknown]> = [];
      let update: Record<string, unknown> | undefined;
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn((key: string, value: unknown) => { filters.push([key, value]); return chain; }),
        is: vi.fn((key: string, value: unknown) => { filters.push([key, value]); return chain; }),
        update: vi.fn((value: Record<string, unknown>) => { update = value; return chain; }),
        single: async () => ({ data: structuredClone(held), error: null }),
        maybeSingle: async () => {
          expect(filters).toEqual(expect.arrayContaining([
            ["id", outboxId], ["factura_id", facturaId], ["estado", "CANCELADA"], ["payload->conciliacionUnicaIniciadaAt", null],
          ]));
          const payload = held.payload as Record<string, unknown>;
          if (payload.conciliacionUnicaIniciadaAt) return { data: null, error: null };
          Object.assign(held, update);
          return { data: structuredClone(held), error: null };
        },
      };
      return chain;
    });
    const repository = new SiatRepository({ from } as unknown as ConstructorParameters<typeof SiatRepository>[0]);
    const results = await Promise.allSettled([
      repository.claimHeldReconciliation(facturaId, outboxId), repository.claimHeldReconciliation(facturaId, outboxId),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(held).toMatchObject({ estado: "CANCELADA", ultimo_error: "SOAP_FAULT_PREVIO", intentos: 1, payload: { reenvioAutomaticoBloqueado: true, conciliacionUnicaIniciadaAt: expect.any(String) } });
  });

  it("reserva una sola segunda consulta y mantiene el outbox cancelado y su historial", async () => {
    const { SiatRepository } = await vi.importActual<typeof import("../../supabase/functions/_shared/siat/repository.ts")>("../../supabase/functions/_shared/siat/repository.ts");
    const held: Record<string, unknown> = {
      ...job, locked_by: null, locked_until: null, ultimo_error: "SOAP_FAULT_PREVIO", intentos: 1,
      payload: { reenvioAutomaticoBloqueado: true, conciliacionUnicaIniciadaAt: "2026-10-24T02:00:56.553Z" },
    };
    const from = vi.fn(() => {
      const filters: Array<[string, unknown]> = [];
      let update: Record<string, unknown> | undefined;
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn((key: string, value: unknown) => { filters.push([key, value]); return chain; }),
        is: vi.fn((key: string, value: unknown) => { filters.push([key, value]); return chain; }),
        update: vi.fn((value: Record<string, unknown>) => { update = value; return chain; }),
        single: async () => ({ data: structuredClone(held), error: null }),
        maybeSingle: async () => {
          expect(filters).toEqual(expect.arrayContaining([
            ["id", outboxId], ["factura_id", facturaId], ["estado", "CANCELADA"],
            ["payload->conciliacionCufdVigenteIniciadaAt", null],
          ]));
          const payload = held.payload as Record<string, unknown>;
          if (payload.conciliacionCufdVigenteIniciadaAt) return { data: null, error: null };
          Object.assign(held, update);
          return { data: structuredClone(held), error: null };
        },
      };
      return chain;
    });
    const repository = new SiatRepository({ from } as unknown as ConstructorParameters<typeof SiatRepository>[0]);
    const results = await Promise.allSettled([
      repository.claimHeldReconciliationWithCurrentCufd(facturaId, outboxId, currentCufd.id),
      repository.claimHeldReconciliationWithCurrentCufd(facturaId, outboxId, currentCufd.id),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(held).toMatchObject({
      estado: "CANCELADA", ultimo_error: "SOAP_FAULT_PREVIO", intentos: 1,
      payload: { reenvioAutomaticoBloqueado: true, conciliacionUnicaIniciadaAt: "2026-10-24T02:00:56.553Z",
        conciliacionCufdVigenteIniciadaAt: expect.any(String), conciliacionCufdVigenteId: currentCufd.id },
    });
  });
});

import { describe, expect, it, vi } from "vitest";
import type { AgentConfig } from "../../agent-local/src/config.ts";
import type { AgentStore } from "../../agent-local/src/store.ts";
import { LocalAgentApp } from "../../agent-local/src/app.ts";

// Se sustituye solo el control de bloqueo en esta simulación; no se contacta red ni se crean eventos.
vi.mock("../../agent-local/src/contingency-safety.ts", async (load) => ({
  ...(await load<typeof import("../../agent-local/src/contingency-safety.ts")>()),
  assertContingencyPilotReady: () => {},
}));

describe("recuperación local simulada", () => {
  it("vuelve a OFFLINE si se pierde la respuesta al importar el evento", async () => {
    const store = {
      getState: () => ({ state: "RECUPERANDO", evidence: {} }),
      activeEvent: () => ({ id: "evento-sintetico", evidencia: {} }), pendingRecoveryEvent: () => null,
      closeEvent: vi.fn(async () => {}), setState: vi.fn(async () => {}), pendingInvoices: () => [], pendingCount: () => 0, listInvoices: () => [{ eventId: "evento-sintetico" }],
    };
    const app = new LocalAgentApp({} as AgentConfig, store as unknown as AgentStore);
    vi.spyOn(app.remote, "action").mockRejectedValue(new TypeError("conexión interrumpida"));
    await expect(app.recover()).rejects.toThrow("conexión interrumpida");
    expect(app.machine.state).toBe("OFFLINE");
    expect(store.setState).toHaveBeenLastCalledWith("OFFLINE", expect.objectContaining({ resultado: "RECUPERACION_PENDIENTE" }));
  });
  it("no declara ONLINE cuando solo se encoló la recuperación remota", async () => {
    const store = {
      getState: () => ({ state: "RECUPERANDO", evidence: {} }),
      activeEvent: () => ({ id: "evento-sintetico", evidencia: {} }), pendingRecoveryEvent: () => null,
      closeEvent: vi.fn(async () => {}), setState: vi.fn(async () => {}), pendingInvoices: () => [], pendingCount: () => 0, listInvoices: () => [{ eventId: "evento-sintetico" }],
    };
    const app = new LocalAgentApp({} as AgentConfig, store as unknown as AgentStore);
    const remote = vi.spyOn(app.remote, "action").mockResolvedValue({});
    await expect(app.recover({ test: true })).resolves.toEqual({ status: "EN_COLA_REMOTA" });
    expect(remote).toHaveBeenCalledTimes(2);
    expect(app.machine.state).toBe("REGISTRANDO_EVENTO");
    expect(store.setState).not.toHaveBeenCalledWith("ONLINE", expect.anything());
    expect(store.setState).toHaveBeenLastCalledWith("REGISTRANDO_EVENTO", expect.objectContaining({ validacionRemotaPendiente: true }));
  });

  it.each([false, undefined])("mantiene pendiente una respuesta no confirmada: %s", async (confirmed) => {
    const store = { getState: () => ({ state: "REGISTRANDO_EVENTO" }), pendingRecoveryEvent: () => ({ id: "event-test" }), pendingCount: () => 0, listInvoices: () => [{ eventId: "event-test" }], confirmRecovery: vi.fn(async () => {}), saveBootstrap: vi.fn(async () => {}), retireNumberBlock: vi.fn(async () => ({ desde: 10, hasta: 12, siguiente: 11, eventoId: "event-test" })), confirmRetirement: vi.fn(async () => {}) };
    const app = new LocalAgentApp({} as AgentConfig, store as unknown as AgentStore);
    vi.spyOn(app.remote, "action").mockResolvedValue({ eventoId: "event-test", confirmada: confirmed });
    await expect(app.confirmRemoteRecovery()).resolves.toEqual({ status: "PENDIENTE" });
    expect(store.confirmRecovery).not.toHaveBeenCalled(); expect(app.machine.state).toBe("REGISTRANDO_EVENTO");
  });

  it("solo pasa a ONLINE con confirmación del mismo evento y sin pendientes locales", async () => {
    const store = { getState: () => ({ state: "REGISTRANDO_EVENTO" }), pendingRecoveryEvent: () => ({ id: "event-test" }), pendingCount: () => 0, listInvoices: () => [{ eventId: "event-test" }], confirmRecovery: vi.fn(async () => {}), saveBootstrap: vi.fn(async () => {}), retireNumberBlock: vi.fn(async () => ({ desde: 10, hasta: 12, siguiente: 11, eventoId: "event-test" })), confirmRetirement: vi.fn(async () => {}) };
    const app = new LocalAgentApp({} as AgentConfig, store as unknown as AgentStore);
    const status = vi.spyOn(app.remote, "action").mockResolvedValue({ eventoId: "otro", confirmada: true });
    await expect(app.confirmRemoteRecovery()).resolves.toEqual({ status: "PENDIENTE" });
    status.mockImplementation(async body => body.action === "recovery-status" ? { eventoId: "event-test", confirmada: true } : body.action === "release-reservation" ? { estado: "CONCILIADA", desde: 10, hasta: 12 } : {});
    await expect(app.confirmRemoteRecovery()).resolves.toEqual({ status: "ONLINE" });
    expect(store.confirmRecovery).toHaveBeenCalledOnce(); expect(app.machine.state).toBe("ONLINE");
  });

  it("mantiene la recuperación pendiente si la liberación remota falla y permite reintentarla", async () => {
    const retirement = { desde: 10, hasta: 12, siguiente: 11, eventoId: "event-test" };
    const store = { getState: () => ({ state: "REGISTRANDO_EVENTO" }), pendingRecoveryEvent: () => ({ id: "event-test" }), pendingCount: () => 0, listInvoices: () => [{ eventId: "event-test" }],
      retireNumberBlock: vi.fn(async () => retirement), confirmRetirement: vi.fn(async () => {}), confirmRecovery: vi.fn(async () => {}), saveBootstrap: vi.fn(async () => {}) };
    const app = new LocalAgentApp({} as AgentConfig, store as unknown as AgentStore);
    let first = true;
    vi.spyOn(app.remote, "action").mockImplementation(async body => {
      if (body.action === "recovery-status") return { eventoId: "event-test", confirmada: true };
      if (body.action === "release-reservation" && first) { first = false; throw new Error("RESPUESTA_INCIERTA"); }
      if (body.action === "release-reservation") return { estado: "CONCILIADA", desde: 10, hasta: 12 };
      return {};
    });
    await expect(app.confirmRemoteRecovery()).rejects.toThrow("RESPUESTA_INCIERTA");
    expect(store.confirmRecovery).not.toHaveBeenCalled(); expect(app.machine.state).toBe("REGISTRANDO_EVENTO");
    await expect(app.confirmRemoteRecovery()).resolves.toEqual({ status: "ONLINE" });
    expect(store.retireNumberBlock).toHaveBeenCalledTimes(2); expect(store.confirmRecovery).toHaveBeenCalledOnce();
  });
  it("no registra ni envía paquetes vacíos y conserva la revisión si el SIN no confirmó", async () => {
    const event = { id: "empty-event" };
    const store = { getState: () => ({ state: "RECUPERANDO", evidence: {} }), activeEvent: () => event, pendingRecoveryEvent: () => event,
      closeEvent: vi.fn(async () => {}), setState: vi.fn(async () => {}), listInvoices: () => [], pendingCount: () => 0 };
    const app = new LocalAgentApp({} as AgentConfig, store as unknown as AgentStore);
    const remote = vi.spyOn(app.remote, "action").mockResolvedValue({ eventoId: event.id, confirmada: false });
    await expect(app.recover()).resolves.toEqual({ status: "SIN_DOCUMENTOS_PENDIENTE" });
    expect(remote).not.toHaveBeenCalled();
    await expect(app.confirmRemoteRecovery()).resolves.toEqual({ status: "PENDIENTE" });
    expect(remote).toHaveBeenCalledTimes(1);
    expect(remote).toHaveBeenCalledWith(expect.objectContaining({ action: "recovery-status", sinFacturasLocales: true }));
  });
  it("cierra un evento vacío ya confirmado sin registrarlo ni enviar paquetes", async () => {
    const event = { id: "empty-event" };
    const store = { getState: () => ({ state: "REGISTRANDO_EVENTO" }), pendingRecoveryEvent: () => event, pendingCount: () => 0,
      listInvoices: () => [], retireNumberBlock: vi.fn(async () => ({ desde: 10, hasta: 10, siguiente: 10, eventoId: event.id })),
      confirmRetirement: vi.fn(async () => {}), confirmRecovery: vi.fn(async () => {}), saveBootstrap: vi.fn(async () => {}) };
    const app = new LocalAgentApp({} as AgentConfig, store as unknown as AgentStore);
    const remote = vi.spyOn(app.remote, "action").mockImplementation(async body => {
      if (body.action === "recovery-status") return { eventoId: event.id, confirmada: true, sinDocumentos: true };
      if (body.action === "release-reservation") return { estado: "CONCILIADA", desde: 10, hasta: 10 };
      if (body.action === "bootstrap") return {};
      throw new Error("No debe registrar evento ni enviar paquete");
    });
    await expect(app.confirmRemoteRecovery()).resolves.toEqual({ status: "ONLINE" });
    expect(remote.mock.calls.map(([body]) => body.action)).toEqual(["recovery-status", "release-reservation", "bootstrap"]);
    expect(store.confirmRecovery).toHaveBeenCalledOnce();
  });
});

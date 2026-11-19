import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentStore } from "../../agent-local/src/store.ts";
import { LocalAgentApp } from "../../agent-local/src/app.ts";
import type { AgentConfig } from "../../agent-local/src/config.ts";
import type { BootstrapBundle, LocalInvoice } from "../../agent-local/src/types.ts";

const directories: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const setup = async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "siat-agent-test-")); directories.push(dataDir);
  const config: AgentConfig = { port: 4737, host: "127.0.0.1", dataDir, agentCode: "TEST", sharedSecret: "a".repeat(32), storageSecret: "b".repeat(32), ingestUrl: "http://invalid", supabaseUrl: "http://invalid", supabaseAnonKey: "anon", allowedOrigins: new Set(), sessionHours: 12, version: "test", defaultEventCode: "1" };
  const store = new AgentStore(config); await store.init(); return { store, dataDir, config };
};
const bundle: BootstrapBundle = {
  config: {}, branch: {}, point: null, cuis: {}, cufd: { id: "cufd-1" },
  products: [{ id: "p1", codigo_interno: "P1", nombre: "Producto confidencial" }], homologations: [{ producto_id: "p1", estado: "HOMOLOGADO" }],
  stocks: [{ producto_id: "p1", almacen_id: "a1", cantidad_disponible: 2 }], warehouses: [{ id: "a1", nombre: "Central" }],
  clients: [{ id: "c1", nombre_razon_social: "Cliente secreto" }], payments: [], legends: [], cafc: [], rules: [], numberBlock: { numero_desde: 10, numero_hasta: 20 }, generatedAt: new Date().toISOString(),
};
const invoice = (idempotencyKey: string, number: number): LocalInvoice => ({ id: crypto.randomUUID(), idempotencyKey, correlationId: crypto.randomUUID(), cajaId: "CAJA-1", eventId: "e1", numeroFactura: number, cuf: `CUF-${number}`, fechaEmision: new Date().toISOString(), cliente: {}, total: "10.00", estado: "PENDIENTE", paqueteId: null, xmlPath: resolve("x"), pdfPath: resolve("p"), xmlHash: "HASH", snapshot: {}, syncError: null, createdBy: crypto.randomUUID() });

describe("persistencia local", () => {
  it("solo permite emisión offline con autorización, evento, CUFD vigente y numeración reservada", async () => {
    const { store, config } = await setup();
    const now = Date.now();
    const cufd = { id: "cufd-1", fecha_inicio: new Date(now - 60_000).toISOString(), fecha_expiracion: new Date(now + 60_000).toISOString() };
    await store.saveBootstrap({ ...bundle, config: { ambiente: "PRUEBAS" }, cufd });
    await store.startEvent({ id: "e1", tipoEventoCodigo: "1", cufdId: cufd.id, cufd, fechaInicio: new Date(now - 30_000).toISOString() });
    await store.setState("OFFLINE", {});
    const app = new LocalAgentApp(config, store);
    expect(app.offlineSaleReady()).toBe(false);
    vi.stubEnv("SIAT_CONTINGENCIA_PILOTO_HABILITADA", "true"); vi.stubEnv("SIAT_CONTINGENCIA_AMBIENTE", "PRUEBAS");
    expect(app.offlineSaleReady()).toBe(true);
    const admin = { id: "s", userId: "u", userName: "Admin", role: "administrador", expiresAt: "2099-01-01" };
    expect(app.status(admin).capacidades).toMatchObject({ aprovisionar: false, recuperar: true, registrarEvento: false });
    expect(app.status({ ...admin, role: "vendedor" }).capacidades.recuperar).toBe(false);
    await expect(app.bootstrap(admin)).rejects.toThrow("APROVISIONAMIENTO_BLOQUEADO_POR_CONTINGENCIA_PENDIENTE");
    const eventSpy = vi.spyOn(store, "activeEvent").mockReturnValue({ id: "e2", tipoEventoCodigo: "5", cafcId: "cafc", cufdId: cufd.id, cufd, fechaInicio: new Date(now - 30_000).toISOString() });
    expect(app.offlineSaleReady()).toBe(false);
    eventSpy.mockRestore();
    await store.saveBootstrap({ ...bundle, config: { ambiente: "PRUEBAS" }, cufd, numberBlock: null });
    expect(store.hasOfflineNumber()).toBe(false);
    expect(app.offlineSaleReady()).toBe(false);
  });
  it("no comprueba el SIN cuando la contingencia no está autorizada", async () => {
    const { store, config } = await setup();
    const network = vi.fn(() => { throw new Error("No debe acceder a la red"); });
    vi.stubEnv("SIAT_CONTINGENCIA_PILOTO_HABILITADA", "false"); vi.stubGlobal("fetch", network);
    try { await new LocalAgentApp(config, store).checkConnectivity(); expect(network).not.toHaveBeenCalled(); }
    finally { vi.unstubAllGlobals(); }
  });
  it("muestra el heartbeat del gateway sin afirmar una consulta al SIN", async () => {
    const { store, config } = await setup(); vi.stubEnv("SIAT_CONTINGENCIA_PILOTO_HABILITADA", "false");
    const app = new LocalAgentApp(config, store); const admin = { id: "s", userId: "u", userName: "Admin", role: "administrador", expiresAt: "2099-01-01" };
    const action = vi.spyOn(app.remote, "action").mockResolvedValue({ ok: true });
    expect(app.status(admin).evidence).toMatchObject({ backendOnline: null, siatOnline: null });
    await app.reportDisabledAvailability(); expect(app.status(admin).evidence).toMatchObject({ backendOnline: true, siatOnline: null });
    action.mockRejectedValue(new Error("sin gateway")); await expect(app.reportDisabledAvailability()).rejects.toThrow("sin gateway");
    expect(app.status(admin).evidence).toMatchObject({ backendOnline: false, siatOnline: null });
  });
  it("persiste transiciones consecutivas aunque ocurran en el mismo milisegundo", async () => {
    const { store } = await setup();
    const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
    try {
      await store.setState("DEGRADADO", { paso: 1 });
      await store.setState("OFFLINE", { paso: 2 });
      expect(store.getState()).toMatchObject({ state: "OFFLINE", evidence: { paso: 2 } });
    } finally { clock.mockRestore(); }
  });
  it("permite consultar productos sin stock para CAFC y seleccionar el evento cerrado exacto", async () => {
    const { store } = await setup(); await store.saveBootstrap({ ...bundle, stocks: [] });
    expect(store.listProducts("P1")).toHaveLength(0); expect(store.listCafcProducts("P1")).toHaveLength(1);
    await store.startEvent({ id: "evento-1", fechaInicio: "2026-11-01T12:00:00Z" });
    expect(store.closedEvent("evento-1")).toBeNull();
    await store.closeEvent("evento-1", { id: "evento-1", fechaFin: "2026-11-01T13:00:00Z" });
    expect(store.closedEvent("evento-1")?.id).toBe("evento-1"); expect(store.closedEvent("otro")).toBeNull();
  });
  it("serializa dos cajas, no repite número y descuenta el último stock una vez", async () => {
    const { store } = await setup(); await store.saveBootstrap(bundle); await store.startEvent({ id: "e1", fechaInicio: new Date().toISOString() });
    const build = (key: string) => store.createInvoice(async context => ({ invoice: invoice(key, context.number), items: [{ productoId: "p1", almacenId: "a1", cantidad: 1 }] }), { idempotencyKey: key, clienteId: "c1", items: [{ productoId: "p1" }] });
    const [first, repeated] = await Promise.all([build("idem-1234567890123456"), build("idem-1234567890123456")]);
    expect(first.id).toBe(repeated.id); expect(first.numeroFactura).toBe(10);
    const second = await build("idem-abcdefghijklmnop"); expect(second.numeroFactura).toBe(11);
    await expect(build("idem-ultimo-stock-0001")).rejects.toThrow(/Stock local insuficiente/);
  });

  it("no reutiliza el número al reaplicar el mismo bloque, incluso tras reiniciar", async () => {
    const { store, config } = await setup();
    const fixture = { ...bundle, stocks: [{ producto_id: "p1", almacen_id: "a1", cantidad_disponible: 5 }] };
    await store.saveBootstrap(fixture); await store.startEvent({ id: "e1", fechaInicio: new Date().toISOString() });
    const input = (key: string) => ({ idempotencyKey: key, clienteId: "c1", items: [{ productoId: "p1" }] });
    const build = (target: AgentStore, key: string) => target.createInvoice(async context => ({ invoice: invoice(key, context.number), items: [{ productoId: "p1", almacenId: "a1", cantidad: 1 }] }), input(key));
    expect((await build(store, "reintento-bloque-00001")).numeroFactura).toBe(10);
    await store.saveBootstrap(fixture);
    expect((await build(store, "reintento-bloque-00002")).numeroFactura).toBe(11);
    const restarted = new AgentStore(config); await restarted.init();
    await restarted.saveBootstrap({ ...fixture, numberBlock: null });
    await restarted.saveBootstrap(fixture);
    expect((await build(restarted, "reintento-bloque-00003")).numeroFactura).toBe(12);
  });

  it("retira una reserva sin evento antes de solicitar su cierre y no la reabre tras reinicio", async () => {
    const { store, config } = await setup(); await store.saveBootstrap(bundle);
    const retired = await store.retireNumberBlock(null);
    expect(retired).toMatchObject({ desde: 10, hasta: 20, siguiente: 10, eventoId: null });
    expect(store.hasOfflineNumber()).toBe(false);
    const restarted = new AgentStore(config); await restarted.init();
    expect(await restarted.retireNumberBlock(null)).toEqual(retired);
    await expect(restarted.saveBootstrap(bundle)).rejects.toThrow("BLOQUE_RETIRADO_NO_REUTILIZABLE");
    await restarted.confirmRetirement(retired);
    expect(restarted.canReleaseUnusedReservation()).toBe(false);
  });
  it("reintenta el cierre sin uso después de perder la respuesta y reiniciar", async () => {
    vi.stubEnv("SIAT_CONTINGENCIA_PILOTO_HABILITADA", "false"); vi.stubEnv("SIAT_CONTINGENCIA_AMBIENTE", "PRUEBAS");
    const { store, config } = await setup(); await store.saveBootstrap(bundle);
    const admin = { id: "s", userId: "u", userName: "Admin", role: "administrador", expiresAt: "2099-01-01" };
    const first = new LocalAgentApp(config, store);
    await expect(first.releaseUnusedReservation({ ...admin, role: "vendedor" })).rejects.toThrow("administración");
    vi.spyOn(first.remote, "action").mockRejectedValue(new Error("RESPUESTA_PERDIDA"));
    await expect(first.releaseUnusedReservation(admin)).rejects.toThrow("RESPUESTA_PERDIDA");
    expect(store.hasOfflineNumber()).toBe(false); expect(store.canReleaseUnusedReservation()).toBe(true);
    const restarted = new AgentStore(config); await restarted.init(); const second = new LocalAgentApp(config, restarted);
    vi.stubEnv("SIAT_CONTINGENCIA_PILOTO_HABILITADA", "true"); vi.stubEnv("SIAT_AGENT_RESERVA_CANTIDAD", "1");
    const bootstrap = vi.spyOn(second.remote, "bootstrap");
    expect(second.status(admin).capacidades.aprovisionar).toBe(false);
    await expect(second.bootstrap(admin)).rejects.toThrow("APROVISIONAMIENTO_BLOQUEADO_POR_CIERRE_PENDIENTE");
    expect(bootstrap).not.toHaveBeenCalled();
    vi.spyOn(second.remote, "action").mockResolvedValue({ estado: "CONCILIADA", desde: 10, hasta: 20 });
    await expect(second.releaseUnusedReservation(admin)).resolves.toMatchObject({ estado: "CONCILIADA" });
    expect(restarted.canReleaseUnusedReservation()).toBe(false);
  });
  it("permite solo al administrador preparar un número en piloto con contingencia deshabilitada", async () => {
    vi.stubEnv("SIAT_CONTINGENCIA_PILOTO_HABILITADA", "false"); vi.stubEnv("SIAT_CONTINGENCIA_AMBIENTE", "PRUEBAS"); vi.stubEnv("SIAT_AGENT_RESERVA_CANTIDAD", "1");
    const { store, config } = await setup(); const app = new LocalAgentApp(config, store);
    const admin = { id: "s", userId: "u", userName: "Admin", role: "administrador", expiresAt: "2099-01-01" };
    const remote = vi.spyOn(app.remote, "bootstrap").mockResolvedValue(bundle);
    await expect(app.bootstrap({ ...admin, role: "vendedor" })).rejects.toThrow("administración");
    expect(app.status(admin).capacidades.aprovisionar).toBe(true);
    await app.bootstrap(admin); expect(remote).toHaveBeenCalledExactlyOnceWith(1);
    vi.stubEnv("SIAT_AGENT_RESERVA_CANTIDAD", "2");
    await expect(app.bootstrap(admin)).rejects.toThrow("CONFIGURAR_CANTIDAD_RESERVA_OFFLINE");
    expect(remote).toHaveBeenCalledOnce();
  });
  it("no deja comandos inválidos en el diario que impidan reiniciar", async () => {
    const { store, config } = await setup();
    await expect(store.saveBootstrap({ ...bundle, numberBlock: { numero_desde: 20, numero_hasta: 10 } })).rejects.toThrow("BLOQUE_NUMERACION_INVALIDO");
    await expect(store.confirmRetirement({ desde: 1, hasta: 2 })).rejects.toThrow("RESERVA_RETIRADA_NO_ENCONTRADA");
    const restarted = new AgentStore(config); await expect(restarted.init()).resolves.toBeUndefined();
  });
  it("conserva un evento sin facturas hasta confirmar el cierre remoto de su reserva", async () => {
    vi.stubEnv("SIAT_CONTINGENCIA_PILOTO_HABILITADA", "true"); vi.stubEnv("SIAT_CONTINGENCIA_AMBIENTE", "PRUEBAS");
    const { store, config } = await setup(); await store.saveBootstrap(bundle);
    await store.startEvent({ id: "evento-sin-documentos", fechaInicio: new Date().toISOString() });
    await store.closeEvent("evento-sin-documentos", { id: "evento-sin-documentos", fechaFin: new Date().toISOString() });
    const admin = { id: "s", userId: "u", userName: "Admin", role: "administrador", expiresAt: "2099-01-01" };
    const first = new LocalAgentApp(config, store); vi.spyOn(first.remote, "action").mockRejectedValue(new Error("RESPUESTA_PERDIDA"));
    await expect(first.releaseUnusedReservation(admin)).rejects.toThrow("RESPUESTA_PERDIDA");
    expect(store.pendingRecoveryEvent()?.id).toBe("evento-sin-documentos"); expect(store.hasOfflineNumber()).toBe(false);
    await store.setState("REGISTRANDO_EVENTO", { resultado: "CIERRE_PENDIENTE" });
    const restarted = new AgentStore(config); await restarted.init(); const second = new LocalAgentApp(config, restarted);
    const send = vi.spyOn(second.remote, "action").mockResolvedValue({ estado: "CONCILIADA", desde: 10, hasta: 20 });
    await second.checkConnectivity(); expect(send).not.toHaveBeenCalled();
    await second.releaseUnusedReservation(admin);
    expect(restarted.pendingRecoveryEvent()).toBeNull(); expect(restarted.canReleaseUnusedReservation()).toBe(false);
    expect(restarted.getState()).toMatchObject({ state: "DEGRADADO", evidence: { resultado: "RESERVA_SIN_USO_CONCILIADA", comunicacionPendiente: true } });
    expect(second.machine.state).toBe("DEGRADADO");
  });

  it("cifra snapshot y restaura desde disco sin perder outbox", async () => {
    const { store, dataDir, config } = await setup(); await store.saveBootstrap(bundle); await store.startEvent({ id: "e1", fechaInicio: new Date().toISOString() });
    await store.createInvoice(async context => ({ invoice: invoice("idem-restore-123456", context.number), items: [{ productoId: "p1", almacenId: "a1", cantidad: 1 }] }), { idempotencyKey: "idem-restore-123456", clienteId: "c1", items: [{ productoId: "p1" }] });
    expect(readFileSync(join(dataDir, "agent.sqlite.enc"), "utf8")).not.toContain("Cliente secreto");
    const restored = new AgentStore(config); await restored.init();
    expect(restored.listInvoices()).toHaveLength(1); expect(restored.pendingCount()).toBe(1);
  });

  it("rechaza reutilizar una clave con otro contenido después de reiniciar", async () => {
    const { store, config } = await setup(); await store.saveBootstrap(bundle); await store.startEvent({ id: "e1", fechaInicio: new Date().toISOString() });
    const key = "idem-huella-00000001";
    const input = { idempotencyKey: key, requestHash: "hash-original", clienteId: "c1", items: [{ productoId: "p1" }] };
    const created = await store.createInvoice(async context => ({ invoice: { ...invoice(key, context.number), requestHash: input.requestHash }, items: [{ productoId: "p1", almacenId: "a1", cantidad: 1 }] }), input);
    const restored = new AgentStore(config); await restored.init();
    const build = async () => { throw new Error("NO_DEBE_CREAR"); };
    expect((await restored.createInvoice(build, input)).id).toBe(created.id);
    await expect(restored.createInvoice(build, { ...input, requestHash: "hash-distinto" })).rejects.toThrow("datos no coinciden");
    expect(restored.listInvoices()).toHaveLength(1);
  });

  it("persiste atómicamente la confirmación de recuperación y la transición ONLINE", async () => {
    const { store, config } = await setup();
    await store.startEvent({ id: "evento-local-test", fechaInicio: "2026-11-01T12:00:00Z" });
    await store.closeEvent("evento-local-test", { id: "evento-local-test", fechaFin: "2026-11-01T13:00:00Z" });
    await store.setState("REGISTRANDO_EVENTO", { test: true });
    expect(store.pendingRecoveryEvent()?.id).toBe("evento-local-test");
    await store.confirmRecovery("evento-local-test", { confirmado: true });
    const restored = new AgentStore(config); await restored.init();
    expect(restored.getState().state).toBe("ONLINE"); expect(restored.pendingRecoveryEvent()).toBeNull();
    expect(restored.getState().evidence).toMatchObject({ confirmado: true });
  });

  it("mantiene CAFC separado y nunca reutiliza un número manual", async () => {
    const { store } = await setup(); const range = { id: "r1", autorizacion: "CAFC-TEST", rango_desde: 50, rango_hasta: 60, vigente_hasta: new Date(Date.now() + 86_400_000).toISOString(), estado: "VIGENTE" };
    await store.saveBootstrap({ ...bundle, cafc: [range] }); await store.startEvent({ id: "e1", fechaInicio: new Date().toISOString() });
    const build = (key: string) => store.createInvoice(async context => ({ invoice: { ...invoice(key, context.number), manualCafc: { rangeId: "r1", numero: 50, autorizacion: "CAFC-TEST", evidencePath: "evidence" } }, items: [{ productoId: "p1", almacenId: "a1", cantidad: 1 }] }), { idempotencyKey: key, clienteId: "c1", items: [{ productoId: "p1" }], manualCafc: { rangeId: "r1", numero: 50 } });
    expect((await build("idem-cafc-123456789")).numeroFactura).toBe(50);
    await expect(build("idem-cafc-987654321")).rejects.toThrow(/ya fue utilizado/);
  });
});

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentStore } from "../../agent-local/src/store.ts";
import type { AgentConfig } from "../../agent-local/src/config.ts";
import type { BootstrapBundle, LocalInvoice } from "../../agent-local/src/types.ts";

const directories: string[] = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
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
  it("serializa dos cajas, no repite número y descuenta el último stock una vez", async () => {
    const { store } = await setup(); await store.saveBootstrap(bundle); await store.startEvent({ id: "e1", fechaInicio: new Date().toISOString() });
    const build = (key: string) => store.createInvoice(async context => ({ invoice: invoice(key, context.number), items: [{ productoId: "p1", almacenId: "a1", cantidad: 1 }] }), { idempotencyKey: key, clienteId: "c1", items: [{ productoId: "p1" }] });
    const [first, repeated] = await Promise.all([build("idem-1234567890123456"), build("idem-1234567890123456")]);
    expect(first.id).toBe(repeated.id); expect(first.numeroFactura).toBe(10);
    const second = await build("idem-abcdefghijklmnop"); expect(second.numeroFactura).toBe(11);
    await expect(build("idem-ultimo-stock-0001")).rejects.toThrow(/Stock local insuficiente/);
  });

  it("cifra snapshot y restaura desde disco sin perder outbox", async () => {
    const { store, dataDir, config } = await setup(); await store.saveBootstrap(bundle); await store.startEvent({ id: "e1", fechaInicio: new Date().toISOString() });
    await store.createInvoice(async context => ({ invoice: invoice("idem-restore-123456", context.number), items: [{ productoId: "p1", almacenId: "a1", cantidad: 1 }] }), { idempotencyKey: "idem-restore-123456", clienteId: "c1", items: [{ productoId: "p1" }] });
    expect(readFileSync(join(dataDir, "agent.sqlite.enc"), "utf8")).not.toContain("Cliente secreto");
    const restored = new AgentStore(config); await restored.init();
    expect(restored.listInvoices()).toHaveLength(1); expect(restored.pendingCount()).toBe(1);
  });

  it("mantiene CAFC separado y nunca reutiliza un número manual", async () => {
    const { store } = await setup(); const range = { id: "r1", autorizacion: "CAFC-TEST", rango_desde: 50, rango_hasta: 60, vigente_hasta: new Date(Date.now() + 86_400_000).toISOString(), estado: "VIGENTE" };
    await store.saveBootstrap({ ...bundle, cafc: [range] }); await store.startEvent({ id: "e1", fechaInicio: new Date().toISOString() });
    const build = (key: string) => store.createInvoice(async context => ({ invoice: { ...invoice(key, context.number), manualCafc: { rangeId: "r1", numero: 50, autorizacion: "CAFC-TEST", evidencePath: "evidence" } }, items: [{ productoId: "p1", almacenId: "a1", cantidad: 1 }] }), { idempotencyKey: key, clienteId: "c1", items: [{ productoId: "p1" }], manualCafc: { rangeId: "r1", numero: 50 } });
    expect((await build("idem-cafc-123456789")).numeroFactura).toBe(50);
    await expect(build("idem-cafc-987654321")).rejects.toThrow(/ya fue utilizado/);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({
  rows: {} as Record<string, Array<Record<string, unknown>>>, errors: {} as Record<string, string>, calls: [] as Array<{ table: string; start: number; end: number }>,
}));
vi.mock("../../src/lib/supabase", () => ({ supabase: {
  from: (table: string) => {
    const result = (rows: Array<Record<string, unknown>>) => ({ data: rows, error: mock.errors[table] ? { message: mock.errors[table] } : null });
    const builder = {
      select: () => builder, order: () => builder,
      range: async (start: number, end: number) => { mock.calls.push({ table, start, end }); return result((mock.rows[table] ?? []).slice(start, end + 1)); },
      in: async (column: string, ids: string[]) => result((mock.rows[table] ?? []).filter(row => ids.includes(String(row[column])))),
    };
    return builder;
  },
} }));
import { listarVentasGestion } from "../../src/features/ventas/services/ventas.api";
import { listarFacturasSiat } from "../../src/features/facturas/services/siat.service";
beforeEach(() => { mock.rows = {}; mock.errors = {}; mock.calls = []; });

describe("consultas de Gestión de ventas sin escrituras", () => {
  it("recupera todas las páginas fiscales, incluidas facturas sin venta, usando snapshots", async () => {
    mock.rows.facturas_siat = Array.from({ length: 501 }, (_, i) => ({ id: `f${i}`, numero_factura: i + 1, estado_fiscal: "VALIDADA", ambiente: "PRUEBAS", venta_id: null, cliente_snapshot: { nombreRazonSocial: "Nombre histórico", numeroDocumento: "HISTORICO" }, nombre_razon_social: "Nombre actual", monto_total: 5 }));
    const data = await listarFacturasSiat();
    expect(data).toHaveLength(501);
    expect(data[500]).toMatchObject({ cliente: "Nombre histórico", documento: "HISTORICO", ventaId: "", total: 5 });
    expect(mock.calls).toEqual([{ table: "facturas_siat", start: 0, end: 499 }, { table: "facturas_siat", start: 500, end: 999 }]);
  });
  it("mantiene ventas anteriores sin factura y no trunca el historial a 500", async () => {
    mock.rows.ventas = Array.from({ length: 501 }, (_, i) => ({ id: `v${i}`, codigo_venta: `V-${i}`, total: 10, estado: "CONFIRMADA", cliente_id: "c1", usuario_id: "u1" }));
    mock.rows.clientes = [{ id: "c1", nombre_razon_social: "Cliente", numero_documento: "TEST", correo: "buyer@example.invalid" }];
    mock.rows.usuarios = [{ id: "u1", nombre: "Operador", apellidos: "Prueba" }];
    const data = await listarVentasGestion();
    expect(data).toHaveLength(501);
    expect(data[500]).toMatchObject({ facturaId: null, estadoComercial: "CONFIRMADA", razonSocial: "Cliente", monto: 10, usuario: "Operador Prueba" });
    expect(mock.calls.every(call => call.table === "ventas")).toBe(true);
  });
  it("conserva el historial legado cuando no hay filas en ventas", async () => {
    mock.rows.historial_ventas = [{ venta_id: "old", codigo_venta: "LEGADO", total: 12, estado: "CONFIRMADA", fecha_venta: "2025-01-01", numero_factura: null }];
    expect(await listarVentasGestion()).toEqual([expect.objectContaining({ ventaId: "old", numeroFactura: "LEGADO", monto: 12 })]);
  });
  it("un error al leer clientes no se disfraza de consumidor final", async () => {
    mock.rows.ventas = [{ id: "v1", cliente_id: "c1" }]; mock.errors.clientes = "Permission denied";
    await expect(listarVentasGestion()).rejects.toThrow("clientes");
  });
});

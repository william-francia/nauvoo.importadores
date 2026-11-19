import { describe, expect, it } from "vitest";
import { snapshotManualCafc } from "../../agent-local/src/manual-cafc-form.ts";
import type { BootstrapBundle, LocalSession } from "../../agent-local/src/types.ts";

const bundle = {
  config: { nit: "123456789", razon_social: "Emisor test", municipio: "La Paz", modalidad: "ELECTRONICA", documento_sector: 1, tipo_factura: 1 },
  branch: { id: "sucursal", codigo: 0 }, point: null, cafc: [{ id: "rango", autorizacion: "CAFC-TEST" }],
  clients: [{ id: "cliente", nombre_razon_social: "Cliente test", numero_documento: "12345", tipo_documento: "CI", codigo_cliente: "CLI-TEST" }],
  products: [{ id: "producto", codigo_interno: "P1", nombre: "Perno" }], homologations: [{ producto_id: "producto", estado: "HOMOLOGADO", actividad_economica: "4752100", codigo_producto_sin: "1003451", unidad_medida_sin: "47" }],
  payments: [{ metodo_interno: "EFECTIVO", codigo_metodo_pago: 1 }], cufd: {}, cuis: {}, stocks: [], warehouses: [], legends: [], rules: [], numberBlock: null, generatedAt: "2026-11-01"
} satisfies BootstrapBundle;
const event = { id: "evento", cafcId: "rango", cufd: { codigo: "CUFD-ORIGINAL", direccion: "Dirección test" } };
const session = { id: "x", userId: "x", userName: "Admin", role: "administrador", expiresAt: "2099-01-01" } satisfies LocalSession;
const form = { eventoId: "evento", cafcId: "rango", facturaId: "factura", correlationId: "correlacion", numeroFactura: 54, fechaEmision: "2026-11-01T09:00", clienteId: "cliente", metodoPago: "EFECTIVO", descuentoAdicional: 0, totalOriginal: "5", totalSujetoIva: "5", leyenda: "Leyenda original", items: [{ productoId: "producto", codigoOriginal: "P1", descripcionOriginal: "Perno", subtotalOriginal: "5", cantidad: 1, precioUnitario: 5, descuento: 0 }] };

describe("formulario CAFC del agente", () => {
  it("usa CUFD original y datos revisados sin generar venta ni inventario", () => {
    const result = snapshotManualCafc(form, bundle, event, session);
    expect(result).toMatchObject({ cufd: "CUFD-ORIGINAL", fechaEmision: "2026-11-01T09:00-04:00", numeroFactura: "54", totales: { montoTotal: "5.00", cafc: "CAFC-TEST" }, detalle: [{ descripcion: "Perno", precioUnitario: "5.00" }] });
  });
  it("bloquea evento ajeno, total incorrecto y producto sin homologación", () => {
    expect(() => snapshotManualCafc({ ...form, eventoId: "otro" }, bundle, event, session)).toThrow("EVENTO_O_RANGO");
    expect(() => snapshotManualCafc({ ...form, totalOriginal: "6" }, bundle, event, session)).toThrow("TOTAL_ORIGINAL");
    expect(() => snapshotManualCafc({ ...form, items: [{ ...form.items[0], subtotalOriginal: "4" }] }, bundle, event, session)).toThrow("SUBTOTAL_ORIGINAL");
    expect(() => snapshotManualCafc(form, { ...bundle, homologations: [] }, event, session)).toThrow("SIN_HOMOLOGACION");
  });
});

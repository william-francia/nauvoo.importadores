import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { datosSin, integrarFacturasEnVentas, motivoDocumentoNoDisponible } from "../../src/features/ventas/services/gestion-documentos";
import GestionVentasTable from "../../src/features/ventas/components/gestion/GestionVentasTable";
import ResendEmailModal from "../../src/features/ventas/components/gestion/ResendEmailModal";
import type { FacturaSiatDetalle, FacturaSiatResumen } from "../../src/features/facturas/types/siat.types";
import type { GestionVenta } from "../../src/features/ventas/types/gestionVentas.types";

const sale: GestionVenta = {
  id: "venta:s1", ventaId: "s1", origen: "VENTA", estadoComercial: "CONFIRMADA", numeroFactura: "V-1",
  fechaEmision: "2026-11-20T12:00:00-04:00", razonSocial: "Nombre actual", numeroDocumento: "ACTUAL",
  monto: 99, moneda: "BOB", usuario: "Vendedor", estado: "PENDIENTE", correoCliente: "buyer@example.invalid",
};
const invoice = (overrides: Partial<FacturaSiatResumen> = {}): FacturaSiatResumen => ({
  id: "f1", ventaId: "", numeroFactura: "1", fechaEmision: "2026-11-21T12:00:00-04:00",
  cliente: "Cliente histórico", documento: "HISTORICO", codigoVenta: "—", total: 5, moneda: "BOB", cuf: "CUF-SINTETICO",
  estadoFiscal: "VALIDADA", estadoComercial: "—", ambiente: "PRUEBAS", tipoEmision: "ONLINE", eventoId: null,
  codigoRecepcion: "RECEPCION-SINTETICA", mensajesSiat: [], sucursal: "0", puntoVenta: "0", ...overrides,
});

describe("Gestión de ventas: documentos fiscales como proyección de lectura", () => {
  it("incluye los tres estados piloto sin crear ventas ni modificar entradas", () => {
    const invoices = [invoice({ estadoFiscal: "SIN_RESPUESTA" }), invoice({ id: "f2", numeroFactura: "2" }), invoice({ id: "f3", numeroFactura: "3", estadoFiscal: "ANULADA" })];
    const before = JSON.stringify({ sale, invoices });
    const rows = integrarFacturasEnVentas([sale], invoices);
    expect(rows).toHaveLength(4);
    expect(rows.filter(row => row.origen === "FACTURA_SIN_VENTA")).toHaveLength(3);
    expect(rows.filter(row => row.factura).every(row => row.ventaId === null && row.estadoComercial === null)).toBe(true);
    expect(rows.map(row => row.estado)).toEqual(expect.arrayContaining(["SIN_RESPUESTA", "VALIDADA", "ANULADA"]));
    expect(JSON.stringify({ sale, invoices })).toBe(before);
  });
  it("une una factura futura a su venta sin duplicarla y conserva datos fiscales históricos", () => {
    const f = invoice({ ventaId: "s1", codigoVenta: "V-1" });
    const rows = integrarFacturasEnVentas([sale, sale], [f, f]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ monto: 5, razonSocial: "Cliente histórico", numeroDocumento: "HISTORICO", estadoComercial: "CONFIRMADA", usuario: "Vendedor", ventaId: "s1" });
    expect(integrarFacturasEnVentas([sale], [{ ...f, estadoFiscal: "ANULADA" }])[0].estado).toBe("ANULADA");
    expect(sale.monto).toBe(99);
  });
  it("no colapsa documentos distintos por compartir número o venta y diferencia ambientes", () => {
    const rows = integrarFacturasEnVentas([sale], [invoice({ ventaId: "s1" }), invoice({ id: "prod", ventaId: "s1", ambiente: "PRODUCCION" })]);
    expect(rows).toHaveLength(2);
    expect(rows.map(row => row.ambiente).sort()).toEqual(["PRODUCCION", "PRUEBAS"]);
    expect(new Set(rows.map(row => row.id)).size).toBe(2);
  });
  it("expone evidencia persistida sin traducir un estado incierto a validado", () => {
    const f = { ...invoice({ estadoFiscal: "SIN_RESPUESTA", codigoRecepcion: null }), codigoEstado: 902, transaccion: false, mensajesSiat: [{ codigo: 924, descripcion: "No encontrada" }] } as FacturaSiatDetalle;
    expect(datosSin(f)).toMatchObject({ codigoEstado: 902, transaccion: false, codigoRecepcion: null, codigoDescripcion: "SIN_RESPUESTA" });
    expect(datosSin(f).log).toContain("924");
  });
  it("comunica documentos no aplicables y mantiene separados los permisos y ambientes", () => {
    expect(motivoDocumentoNoDisponible(sale, true)).toContain("no tiene");
    const row = integrarFacturasEnVentas([], [invoice()])[0];
    expect(motivoDocumentoNoDisponible(row, true)).toBeNull();
    expect(motivoDocumentoNoDisponible(row, false)).toContain("administración");
    expect(motivoDocumentoNoDisponible({ ...row, estado: "ANULADA" }, true)).toBeNull();
    expect(motivoDocumentoNoDisponible({ ...row, ambiente: "PRODUCCION" }, true)).toContain("no se utilizará la URL de PILOTO");
  });
  it("renderiza estados separados y filtros estables aun cuando la página está vacía", () => {
    const props = { filters: { ambiente: "TODOS" as const, estadoFiscal: "TODOS", numeroFactura: "", razonSocial: "", numeroDocumento: "", usuario: "" }, onFilterChange: () => {}, onAction: () => {} };
    const html = renderToStaticMarkup(<GestionVentasTable {...props} ventas={integrarFacturasEnVentas([sale], [invoice()])} />);
    expect(html).toContain("Estado comercial"); expect(html).toContain("Estado fiscal");
    expect(html).toContain("Documento sin venta comercial"); expect(html).toContain("PILOTO");
    expect(renderToStaticMarkup(<GestionVentasTable {...props} ventas={[]} />)).toContain('value="ANULADA"');
  });
  it("el formulario de correo exige destinatario y confirmación; no simula disponibilidad", () => {
    const html = renderToStaticMarkup(<ResendEmailModal venta={integrarFacturasEnVentas([], [invoice()])[0]} onCerrar={() => {}} disponible={false} motivo="Proveedor no configurado" onEnviar={async () => { throw Error("No enviar en pruebas"); }} />);
    expect(html).toContain("Proveedor no configurado"); expect(html).toContain('type="email"');
    expect(html).toContain("autorizo enviar esta factura"); expect(html).toMatch(/type="submit"[^>]*disabled/);
  });
});

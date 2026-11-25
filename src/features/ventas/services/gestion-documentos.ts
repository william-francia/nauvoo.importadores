import type { FacturaSiatDetalle, FacturaSiatResumen } from "../../facturas/types/siat.types";
import type { GestionVenta, SinFacturaDetalle } from "../types/gestionVentas.types";

// Proyección de lectura: nunca crea ventas, pagos o movimientos de inventario.
export function integrarFacturasEnVentas(ventas: GestionVenta[], facturas: FacturaSiatResumen[]): GestionVenta[] {
  const porVenta = new Map(ventas.map((venta) => [venta.ventaId ?? venta.id, venta]));
  const documentos = new Map(facturas.map((factura) => [factura.id, factura]));
  const vinculadas = new Set([...documentos.values()].map((f) => f.ventaId).filter(Boolean));
  const rows: GestionVenta[] = [...documentos.values()].map((factura) => {
    const venta = porVenta.get(factura.ventaId);
    return {
      id: `factura:${factura.id}`, facturaId: factura.id, ventaId: factura.ventaId || null,
      origen: factura.ventaId ? "VENTA" : "FACTURA_SIN_VENTA", factura,
      numeroFactura: factura.numeroFactura, fechaEmision: factura.fechaEmision,
      razonSocial: factura.cliente, numeroDocumento: factura.documento,
      monto: factura.total, moneda: factura.moneda, usuario: venta?.usuario ?? "—",
      estado: factura.estadoFiscal, estadoComercial: venta?.estadoComercial ?? (factura.ventaId ? factura.estadoComercial : null),
      ambiente: factura.ambiente, correoCliente: venta?.correoCliente ?? null,
    };
  });
  for (const [id, venta] of porVenta) if (!vinculadas.has(id)) rows.push(venta);
  return rows.sort((a, b) => (Date.parse(b.fechaEmision) || 0) - (Date.parse(a.fechaEmision) || 0) || a.id.localeCompare(b.id));
}

export function datosSin(factura: FacturaSiatDetalle): SinFacturaDetalle {
  return {
    cuf: factura.cuf ?? "Sin CUF", numeroFactura: factura.numeroFactura, fechaEmision: factura.fechaEmision,
    codigoSucursal: Number(factura.sucursal), codigoPuntoVenta: Number(factura.puntoVenta),
    codigoEstado: factura.codigoEstado, codigoRecepcion: factura.codigoRecepcion,
    codigoDescripcion: factura.estadoFiscal, transaccion: factura.transaccion, ambiente: factura.ambiente,
    log: factura.mensajesSiat.length ? JSON.stringify(factura.mensajesSiat) : null,
  };
}

export function motivoDocumentoNoDisponible(venta: GestionVenta, admin: boolean): string | null {
  if (!venta.facturaId) return "Esta venta no tiene una factura electrónica asociada.";
  if (!admin) return "La descarga de documentos fiscales requiere administración.";
  if (venta.ambiente !== "PRUEBAS") return "La entrega de documentos de producción sigue pendiente de habilitación; no se utilizará la URL de PILOTO.";
  if (!["VALIDADA", "ANULADA", "REVERTIDA"].includes(venta.estado)) return `La descarga y el correo requieren un documento fiscal confirmado. Estado actual: ${venta.estado.replaceAll("_", " ")}. Puede consultar su detalle y datos del SIN.`;
  return null;
}

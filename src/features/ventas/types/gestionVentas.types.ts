import type { AmbienteSiat, EstadoFiscal, FacturaSiatResumen } from "../../facturas/types/siat.types";
export type EstadoFactura = EstadoFiscal | "PENDIENTE";

export type MonedaVenta = string;

export interface SinFacturaDetalle {
  cuf: string;

  fechaEmision: string;

  numeroFactura: string;

  codigoSucursal: number;

  codigoPuntoVenta: number;

  codigoDescripcion: string;

  codigoEstado: number | null;

  codigoRecepcion: string | null;

  log: string | null;
  transaccion?: boolean | null;
  ambiente?: AmbienteSiat;
}

export interface GestionVenta {
  id: string;
  facturaId?: string | null;
  ventaId?: string | null;
  origen?: "VENTA" | "FACTURA_SIN_VENTA";
  estadoComercial?: string | null;
  ambiente?: AmbienteSiat | null;
  factura?: FacturaSiatResumen;

  numeroFactura: string;

  fechaEmision: string;

  razonSocial: string;

  numeroDocumento: string;

  monto: number;

  moneda: MonedaVenta;

  usuario: string;

  estado: EstadoFactura;

  correoCliente?: string | null;

  sin?: SinFacturaDetalle | null;
}

export interface GestionVentasFilters {
  ambiente: "TODOS" | "SIN_FACTURA" | AmbienteSiat;
  estadoFiscal: string;
  numeroFactura: string;

  razonSocial: string;

  numeroDocumento: string;

  usuario: string;
}

export type FacturaAction =
  | "VER"
  | "SIN"
  | "ANULAR"
  | "REVERTIR"
  | "PDF_MEDIO_OFICIO"
  | "PDF_ROLLO"
  | "XML"
  | "URL_SIN"
  | "REENVIAR_CORREO";

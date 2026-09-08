export type EstadoFactura =
  | "VALIDADA"
  | "PENDIENTE"
  | "ANULADA"
  | "RECHAZADA";

export type MonedaVenta = "BOB" | "USD";

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
}

export interface GestionVenta {
  id: string;

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
  numeroFactura: string;

  razonSocial: string;

  numeroDocumento: string;

  usuario: string;
}

export type FacturaAction =
  | "SIN"
  | "ANULAR"
  | "PDF_MEDIO_OFICIO"
  | "PDF_ROLLO"
  | "XML"
  | "URL_SIN"
  | "REENVIAR_CORREO";
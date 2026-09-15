export type ReporteTipo =
  | "ESTADO_RESULTADOS"
  | "VENTAS_FACTURACION"
  | "FLUJO_CAJA"
  | "VENTAS_PRODUCTO";

export type ReporteFormato =
  | "PDF"
  | "EXCEL";

export type MetodoPago =
  | "EFECTIVO"
  | "QR"
  | "TRANSFERENCIA"
  | "TARJETA"
  | "CREDITO"
  | "OTRO";

export type EstadoFactura =
  | "VALIDA"
  | "ANULADA"
  | "REEMPLAZADA"
  | "CONTINGENCIA"
  | "NOTA_CREDITO"
  | "NOTA_DEBITO";

export type CuentaCaja =
  | "CAJA_FISICA"
  | "BANCO";

export interface PeriodoReporte {
  /**
   * Formato YYYY-MM
   * Ejemplo: 2026-09
   */
  mes: string;
}

export interface EmpresaReporte {
  razonSocial: string;
  nit: string;

  direccion?: string;
  ciudad: string;

  usuarioGenerador: string;
}

export interface VentaDetalleReporte {
  id: string;

  productoId: string;
  codigoProducto: string;
  nombreProducto: string;

  categoria?: string;

  cantidad: number;

  precioUnitario: number;

  descuento: number;

  total: number;

  /**
   * Costo que tenía la unidad en el momento
   * exacto de la venta.
   *
   * NO usar precio actual del producto.
   */
  costoUnitarioInventario: number | null;
}

export interface FacturaReporte {
  id: string;

  numeroFactura: string;

  fecha: string;

  sucursal: string;

  vendedor: string;

  cliente: string;

  nitCi: string;

  complemento?: string;

  metodoPago: MetodoPago;

  estado: EstadoFactura;

  montoAntesDescuento: number;

  descuentoTotal: number;

  totalFacturado: number;

  devolucionTotal: number;

  notaCreditoTotal: number;

  /**
   * Debe salir del dato fiscal real.
   * No calcularlo a ciegas en React.
   */
  ivaDebitoFiscal: number | null;

  cuf?: string | null;

  cufd?: string | null;

  codigoQr?: string | null;

  xml?: string | null;

  respuestaSin?: string | null;

  detalles: VentaDetalleReporte[];
}

export type CategoriaGasto =
  | "ALQUILER"
  | "SUELDOS"
  | "LUZ"
  | "INTERNET"
  | "TRANSPORTE"
  | "MANTENIMIENTO"
  | "PUBLICIDAD"
  | "COMISIONES"
  | "BANCOS"
  | "FINANCIERO"
  | "IMPUESTO"
  | "OTRO";

export interface GastoReporte {
  id: string;

  fecha: string;

  categoria: CategoriaGasto;

  descripcion: string;

  monto: number;

  sucursal?: string;

  comprobante?: string;
}

export interface MovimientoCajaReporte {
  id: string;

  fecha: string;

  tipo:
    | "INGRESO"
    | "EGRESO";

  cuenta: CuentaCaja;

  concepto: string;

  metodoPago: MetodoPago;

  monto: number;

  sucursal?: string;

  comprobante?: string;
}

export type TipoMovimientoInventarioReporte =
  | "INGRESO"
  | "VENTA"
  | "TRASLADO"
  | "AJUSTE_ENTRADA"
  | "AJUSTE_SALIDA"
  | "DEVOLUCION";

export interface MovimientoInventarioReporte {
  id: string;

  productoId: string;

  codigoProducto: string;

  nombreProducto: string;

  descripcion?: string;

  diametro?: string;

  largo?: string;

  fecha: string;

  tipo: TipoMovimientoInventarioReporte;

  referencia?: string;

  factura?: string;

  recibo?: string;

  ubicacion?: string;

  ingresoCantidad: number;

  salidaCantidad: number;

  /**
   * Obligatorio en ingresos.
   * En salidas se puede utilizar costo promedio
   * si no viene informado.
   */
  costoUnitario: number | null;
}

export interface DatosMensualesComplementarios {
  ivaCreditoFiscal: number | null;

  /**
   * Si contabilidad ya calculó el IT,
   * colocar aquí.
   *
   * Si es null, el sistema puede mostrar
   * una estimación usando la configuración.
   */
  itDeclaradoOEstimado: number | null;

  /**
   * NO calcular automáticamente sin criterios
   * contables definidos.
   */
  iueEstimado: number | null;

  otrosIngresos: number;

  otrosGastos: number;

  gastosOperativosAdicionales: number;

  gastosFinancierosAdicionales: number;

  saldoInicialCaja: number | null;

  saldoInicialBancos: number | null;
}

export interface ReportesSnapshot {
  empresa: EmpresaReporte;

  facturas: FacturaReporte[];

  gastos: GastoReporte[];

  movimientosCaja: MovimientoCajaReporte[];

  movimientosInventario: MovimientoInventarioReporte[];

  /**
   * Llave: YYYY-MM
   */
  datosMensuales: Record<
    string,
    DatosMensualesComplementarios
  >;
}

export interface ReporteIssue {
  id: string;

  tipo:
    | "MANUAL"
    | "ORIGEN_DATOS";

  titulo: string;

  descripcion: string;
}

export interface ReporteDescargaResult {
  ok: boolean;

  issues?: ReporteIssue[];
}
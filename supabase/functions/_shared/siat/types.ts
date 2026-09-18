export type SiatVersion = "SIAT_VIGENTE" | "SIAT_LEY_1733_PILOTO";
export type SiatEnvironment = "PRUEBAS" | "PRODUCCION";
export type SiatModality = "COMPUTARIZADA" | "ELECTRONICA";

export interface SiatContext {
  ambiente: SiatEnvironment;
  versionNormativa: SiatVersion;
  codigoSistema: string;
  nit: string;
  modalidad: SiatModality;
  codigoSucursal: number;
  codigoPuntoVenta: number | null;
  cuis: string;
  cufd?: string;
  documentoSector?: number;
  tipoFactura?: number;
}

export interface SiatMessage {
  codigo?: number;
  descripcion: string;
  numeroArchivo?: number;
  numeroDetalle?: number;
}

export interface SiatResponse {
  transaccion: boolean | null;
  codigoEstado: number | null;
  codigoDescripcion: string | null;
  codigoRecepcion: string | null;
  mensajes: SiatMessage[];
  fechaRecepcion?: string | null;
  rawSanitizado: Record<string, unknown>;
}

export interface CuisResult extends SiatResponse {
  codigo: string | null;
  fechaVigencia: string | null;
}

export interface CufdResult extends SiatResponse {
  codigo: string | null;
  codigoControl: string | null;
  direccion: string | null;
  fechaVigencia: string | null;
}

export interface InvoiceSnapshot {
  id: string;
  correlationId: string;
  nit: string;
  razonSocial: string;
  municipio: string;
  telefono: string | null;
  numeroFactura: string;
  cuf: string;
  cufd: string;
  codigoSucursal: number;
  direccion: string;
  codigoPuntoVenta: number | null;
  fechaEmision: string;
  modalidad: SiatModality;
  documentoSector: number;
  tipoFactura: number;
  cliente: {
    nombreRazonSocial: string | null;
    codigoTipoDocumentoIdentidad: number;
    numeroDocumento: string;
    complemento: string | null;
    codigoCliente: string;
  };
  pago: {
    codigoMetodoPago: number;
    numeroTarjeta: string | null;
    codigoMoneda: number;
    tipoCambio: string;
  };
  totales: {
    montoTotal: string;
    montoTotalSujetoIva: string;
    montoTotalMoneda: string;
    montoGiftCard?: string | null;
    descuentoAdicional?: string | null;
    codigoExcepcion?: number | null;
    cafc?: string | null;
  };
  leyenda: string;
  usuario: string;
  detalle: Array<{
    actividadEconomica: string;
    codigoProductoSin: string;
    codigoProducto: string;
    descripcion: string;
    cantidad: string;
    unidadMedidaSin: string;
    precioUnitario: string;
    descuento: string | null;
    subtotal: string;
    numeroSerie?: string | null;
    numeroImei?: string | null;
  }>;
}

export interface InvoiceReceptionInput {
  context: SiatContext;
  cufd: string;
  documentoSector: number;
  tipoFactura: number;
  archivo: Uint8Array;
  hashArchivo: string;
  fechaEnvio: string;
}

export interface SignificantEventInput {
  context: SiatContext;
  codigoEvento: number;
  descripcion: string;
  fechaInicioEvento: string;
  fechaFinEvento: string;
  cufdEvento: string;
}

export interface PackageReceptionInput extends InvoiceReceptionInput {
  cafc?: string | null;
  cantidadFacturas: number;
  codigoEvento: string;
}

export interface SiatAdapter {
  verificarComunicacion(): Promise<SiatResponse>;
  solicitarCuis(context: SiatContext): Promise<CuisResult>;
  solicitarCufd(context: SiatContext): Promise<CufdResult>;
  sincronizarFechaHora(context: SiatContext): Promise<{ fechaHora: string; response: SiatResponse }>;
  sincronizarCatalogo(context: SiatContext, operation: string): Promise<{ items: unknown[]; response: SiatResponse }>;
  recepcionarFactura(input: InvoiceReceptionInput): Promise<SiatResponse>;
  verificarFactura(context: SiatContext, cuf: string): Promise<SiatResponse>;
  anularFactura(context: SiatContext, cuf: string, motivo: number): Promise<SiatResponse>;
  revertirAnulacion(context: SiatContext, cuf: string): Promise<SiatResponse>;
  registrarEvento(input: SignificantEventInput): Promise<SiatResponse>;
  consultarEventos(context: SiatContext, fechaEvento: string): Promise<{ eventos: Array<Record<string, unknown>>; response: SiatResponse }>;
  recepcionarPaquete(input: PackageReceptionInput): Promise<SiatResponse>;
  validarPaquete(context: SiatContext, codigoRecepcion: string): Promise<SiatResponse>;
}

export class PendingOfficialVerificationError extends Error {
  constructor(message = "PENDIENTE_DE_VERIFICACION_OFICIAL") {
    super(message);
    this.name = "PendingOfficialVerificationError";
  }
}

export class AmbiguousSiatError extends Error {
  constructor(message = "No se pudo determinar si el SIN recibió la solicitud.") {
    super(message);
    this.name = "AmbiguousSiatError";
  }
}

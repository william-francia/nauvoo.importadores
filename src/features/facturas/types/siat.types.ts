export const ESTADOS_FISCALES = [
  "BORRADOR",
  "EN_COLA",
  "GENERANDO",
  "VALIDANDO_XSD",
  "ENVIANDO",
  "SIN_RESPUESTA",
  "CONCILIANDO",
  "VALIDADA",
  "OBSERVADA",
  "RECHAZADA",
  "OFFLINE",
  "EMPAQUETADA",
  "PAQUETE_PENDIENTE",
  "ANULACION_PENDIENTE",
  "ANULADA",
  "REVERSION_PENDIENTE",
  "REVERTIDA",
] as const;

export type EstadoFiscal = (typeof ESTADOS_FISCALES)[number];
export type AmbienteSiat = "PRUEBAS" | "PRODUCCION";
export type VersionNormativaSiat = "SIAT_VIGENTE" | "SIAT_LEY_1733_PILOTO";

export interface FacturaSiatResumen {
  id: string;
  ventaId: string;
  numeroFactura: string;
  fechaEmision: string;
  cliente: string;
  documento: string;
  codigoVenta: string;
  total: number;
  moneda: string;
  cuf: string | null;
  estadoFiscal: EstadoFiscal;
  estadoComercial: string;
  ambiente: AmbienteSiat;
  tipoEmision: "ONLINE" | "OFFLINE";
  eventoId: string | null;
  codigoRecepcion: string | null;
  mensajesSiat: unknown[];
  sucursal: string;
  puntoVenta: string;
}

export interface FacturaSiatDetalle extends FacturaSiatResumen {
  clienteSnapshot: Record<string, unknown>;
  detalleSnapshot: unknown[];
  totalesSnapshot: Record<string, unknown>;
  pagoSnapshot: Record<string, unknown>;
  cufdUtilizado: string | null;
  cantidadIntentos: number;
  motivoAnulacion: string | null;
  pdfDisponible: boolean;
  xmlDisponible: boolean;
  auditoria: AuditoriaSiat[];
}

export interface GatewayHealthSiat {
  ambiente: AmbienteSiat;
  version: VersionNormativaSiat;
  habilitado: boolean;
  secretos: { token: boolean; firma: boolean };
  cuis: { id: string; fecha_expiracion: string | null } | null;
  cufd: { id: string; fecha_expiracion: string | null } | null;
  ultimaSincronizacion: string | null;
  pendientes: number;
}

export interface VentaOfflineSiat extends FacturaSiatResumen {
  usuario: string;
  evento: string;
  paquete: string;
}

export interface AuditoriaSiat {
  id: string;
  accion: string;
  resultado: string;
  fecha: string;
  actor: string;
  contexto: Record<string, unknown>;
}

export interface EstadoSiatResumen {
  servicio: "EN_CONFIGURACION" | "GATEWAY_PENDIENTE" | "OPERATIVO";
  ambiente: AmbienteSiat;
  cuis: "VIGENTE" | "VENCIDO" | "NO_CONFIGURADO";
  cufd: "VIGENTE" | "VENCIDO" | "NO_CONFIGURADO";
  ultimaSincronizacion: string | null;
  facturasPendientes: number;
  contingenciaActiva: boolean;
  eventoActual: string | null;
  paquetesPendientes: number;
}

export interface SiatConfiguracion {
  nit: string;
  razonSocial: string;
  nombreComercial: string;
  municipio: string;
  domicilio: string;
  telefono: string;
  codigoSistema: string;
  modalidad: "COMPUTARIZADA" | "ELECTRONICA";
  documentoSector: string;
  tipoFactura: string;
  actividadEconomica: string;
  ambiente: AmbienteSiat;
  versionNormativa: VersionNormativaSiat;
  zonaHoraria: "America/La_Paz";
  siatHabilitado: boolean;
  sucursalPredeterminadaId: string;
  puntoVentaPredeterminadoId: string;
}

export interface SucursalSiat {
  id: string;
  codigo: number;
  nombre: string;
  municipio: string | null;
  direccion: string | null;
  activo: boolean;
  puntosVenta: PuntoVentaSiat[];
}

export interface PuntoVentaSiat {
  id: string;
  codigo: number;
  nombre: string;
  activo: boolean;
}

export interface ProductoHomologacion {
  productoId: string;
  codigoInterno: string;
  nombre: string;
  codigoProductoSin: string;
  actividadEconomica: string;
  unidadMedidaSin: string;
  origen: "NACIONAL" | "IMPORTADO" | "SERVICIO";
  versionCatalogo: string;
  versionNormativa: VersionNormativaSiat;
  estado: "PENDIENTE" | "HOMOLOGADO" | "INVALIDO" | "INACTIVO";
}

export interface CatalogoOpcionSiat {
  codigo: string;
  descripcion: string;
}

export interface CatalogosHomologacion {
  actividades: CatalogoOpcionSiat[];
  productosServicios: CatalogoOpcionSiat[];
  unidadesMedida: CatalogoOpcionSiat[];
}

export interface MetodoPagoMapeoSiat {
  metodoInterno: "EFECTIVO" | "TARJETA" | "TRANSFERENCIA" | "QR" | "OTRO";
  codigoMetodoPago: string;
}

export interface EventoSignificativoSiat {
  id: string;
  sucursal: string;
  puntoVenta: string;
  tipoEventoCodigo: string | null;
  descripcion: string | null;
  observaciones: string | null;
  fechaInicio: string;
  fechaFin: string | null;
  estado: string;
  cufdId: string | null;
  cufdVigente: boolean;
  codigoRecepcion: string | null;
  cantidadFacturas: number;
  cantidadPaquetes: number;
  paquetesRecepcionados: number;
  paquetesValidados: number;
}

export interface PaqueteSiat {
  id: string;
  eventoId: string | null;
  codigoRecepcion: string | null;
  estado: string;
  cantidadFacturas: number;
  intentos: number;
  fechaEnvio: string | null;
  fechaValidacion: string | null;
  ultimoError: string | null;
}

export interface ContingenciaInput {
  sucursalId: string;
  puntoVentaId: string;
  tipoEventoCodigo: string;
  descripcion: string;
  fechaInicio: string;
  cufdId: string;
  observaciones: string;
}

export interface ContingenciaOpciones {
  sucursales: SucursalSiat[];
  tiposEvento: CatalogoOpcionSiat[];
  cufd: Array<{ id: string; etiqueta: string; sucursalId: string; puntoVentaId: string | null }>;
}

export interface FacturaFilters {
  texto: string;
  estado: "TODOS" | EstadoFiscal;
  ambiente: "TODOS" | AmbienteSiat;
}

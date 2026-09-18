import type { SiatConfiguracion } from "../types/siat.types";

export const SIAT_CONFIGURACION_INICIAL: SiatConfiguracion = {
  nit: "",
  razonSocial: "",
  nombreComercial: "",
  municipio: "",
  domicilio: "",
  telefono: "",
  codigoSistema: "",
  modalidad: "COMPUTARIZADA",
  documentoSector: "",
  tipoFactura: "",
  actividadEconomica: "",
  ambiente: "PRUEBAS",
  versionNormativa: "SIAT_VIGENTE",
  zonaHoraria: "America/La_Paz",
  siatHabilitado: false,
  sucursalPredeterminadaId: "",
  puntoVentaPredeterminadoId: "",
};

export const ETIQUETAS_ESTADO_FISCAL: Record<string, string> = {
  BORRADOR: "Borrador",
  EN_COLA: "En cola",
  GENERANDO: "Generando",
  VALIDANDO_XSD: "Validando XML",
  ENVIANDO: "Enviando",
  SIN_RESPUESTA: "Sin respuesta",
  CONCILIANDO: "Conciliando",
  VALIDADA: "Validada",
  OBSERVADA: "Observada",
  RECHAZADA: "Rechazada",
  OFFLINE: "Offline",
  EMPAQUETADA: "Empaquetada",
  PAQUETE_PENDIENTE: "Paquete pendiente",
  ANULACION_PENDIENTE: "Anulación pendiente",
  ANULADA: "Anulada",
  REVERSION_PENDIENTE: "Reversión pendiente",
  REVERTIDA: "Revertida",
};

export const CATALOGOS_HOMOLOGACION = {
  actividades: "ACTIVIDADES",
  productosServicios: "PRODUCTOS_SERVICIOS",
  unidadesMedida: "UNIDADES_MEDIDA",
} as const;

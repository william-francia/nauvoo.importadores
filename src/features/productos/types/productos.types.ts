// src/features/productos/types/productos.types.ts

export type LocalId =
  | "uquisamana"
  | "isac_tamayo"
  | "calacoto"
  | "santa_cruz";

export type StockPorLocal = Record<LocalId, number>;

export type EstadoStock =
  | "ALTO"
  | "BAJO"
  | "SIN_STOCK";

export interface Producto {
  id: string;

  actividadEconomicaCodigo: string;
  actividadEconomicaNombre: string;

  homologadoCodigo: string;
  homologadoNombre: string;

  nombre: string;
  descripcion: string;

  unidadMedida: string;

  precio: number;
  precioComparacion: number;
  costo: number;

  sku: string;
  codigoBarras: string;

  tipoProducto?: string;
  proveedor?: string;

  tieneOpciones: boolean;

  stockPorLocal: StockPorLocal;

  activo: boolean;
}

export interface ProductoFormValues {
  actividadEconomicaCodigo: string;
  homologadoCodigo: string;

  nombre: string;
  descripcion: string;

  unidadMedida: string;

  precio: number;
  precioComparacion: number;
  costo: number;

  sku: string;
  codigoBarras: string;

  tipoProducto: string;
  proveedor: string;

  tieneOpciones: boolean;
}

export interface GestionProductosFilters {
  actividadEconomica: string;
  producto: string;
  inventario: string;
}

export interface LocalProducto {
  id: LocalId;
  nombre: string;
  corto: string;
}
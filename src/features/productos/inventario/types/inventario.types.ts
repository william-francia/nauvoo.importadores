export type InventarioUbicacionId =
  | "almacen_uquisamana"
  | "isac_tamayo"
  | "calacoto"
  | "santa_cruz";

export type TiendaUbicacionId = Exclude<
  InventarioUbicacionId,
  "almacen_uquisamana"
>;

export type TipoMovimientoInventario =
  | "INGRESO"
  | "AJUSTE_AUMENTO"
  | "AJUSTE_DISMINUCION"
  | "TRASLADO";

export interface InventarioUbicacion {
  id: InventarioUbicacionId;
  nombre: string;
  corto: string;

  tipo: "ALMACEN" | "TIENDA";
}

export type StockPorUbicacion = Record<
  InventarioUbicacionId,
  number
>;

export interface InventarioProducto {
  id: string;

  codigo: string;

  nombre: string;

  unidadMedida: string;

  stock: StockPorUbicacion;

  ultimaActualizacion: string;
}

export interface InventarioMovimiento {
  id: string;

  productoId: string;

  tipo: TipoMovimientoInventario;

  cantidad: number;

  fecha: string;

  ubicacionOrigen?: InventarioUbicacionId;

  ubicacionDestino?: InventarioUbicacionId;

  observacion?: string;

  responsable: string;

  anulado?: boolean;

  creadoEn: string;
}

export interface RegistrarMovimientoInput {
  productoId: string;

  tipo:
    | "INGRESO"
    | "AJUSTE_AUMENTO"
    | "AJUSTE_DISMINUCION";

  cantidad: number;

  fecha: string;

  ubicacion: InventarioUbicacionId;

  observacion?: string;
}

export interface RegistrarTrasladoInput {
  productoId: string;

  cantidad: number;

  destino: TiendaUbicacionId;

  fecha: string;

  observacion?: string;
}
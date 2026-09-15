export type MetodoPago =
  | "EFECTIVO"
  | "TARJETA"
  | "TRANSFERENCIA"
  | "QR"
  | "OTRO";

export type TipoDocumento =
  | "CI"
  | "NIT"
  | "PASAPORTE"
  | "CEX"
  | "OTRO";

export interface ClienteVenta {
  id: string;
  codigo_cliente?: string | null;
  nombre_razon_social: string;
  tipo_documento?: string | null;
  numero_documento?: string | null;
  complemento?: string | null;
  correo?: string | null;
  telefono?: string | null;
}

export interface NuevoClienteInput {
  tipo_documento: TipoDocumento;
  nombre_razon_social: string;
  numero_documento: string;
  complemento?: string;
  correo: string;
  telefono?: string;
}

export interface AlmacenVenta {
  id: string;
  codigo?: string | null;
  nombre: string;
}

export interface StockAlmacen {
  almacen: AlmacenVenta;
  cantidad: number;
}

export interface ProductoVenta {
  id: string;

  codigo_interno: string;

  nombre: string;
  descripcion?: string | null;
  medida?: string | null;

  precio_pieza: number;

  stocks: StockAlmacen[];
}

export interface LineaVenta {
  id: string;

  producto: ProductoVenta;

  almacen_id: string;

  cantidad: number;

  precio_unitario: number;

  descuento: number;

  informacion_extra: string;
}

export interface VentaTotales {
  subtotal: number;
  descuentoLineas: number;
  descuentoAdicional: number;
  total: number;
}

export interface RegistrarVentaInput {
  cliente_id: string | null;

  metodo_pago: MetodoPago;

  observacion?: string;

  descuento_venta: number;

  items: Array<{
    producto_id: string;
    almacen_id: string;
    cantidad: number;
    precio_unitario: number;
    descuento: number;
  }>;
}

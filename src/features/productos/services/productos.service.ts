import { supabase } from "../../../lib/supabase";
import { ACTIVIDADES_ECONOMICAS, PRODUCTOS_HOMOLOGADOS } from "../constants/productos.constants";
import type { LocalId, Producto, ProductoFormValues, StockPorLocal } from "../types/productos.types";

interface AlmacenRow {
  id: string;
  codigo: string | null;
  nombre: string;
  activo: boolean;
}

interface StockRow {
  cantidad_disponible: number | string | null;
  almacen: AlmacenRow | null;
}

interface ProductoRow {
  id: string;
  codigo_interno: string;
  codigo_producto_sin: number | null;
  nombre: string;
  descripcion: string | null;
  numero: string | null;
  medida: string | null;
  precio_produccion: number | string | null;
  precio_12: number | string | null;
  precio_pieza: number | string | null;
  activo: boolean;
  stock_por_almacen: StockRow[] | null;
}

export const productosQueryKey = ["productos-reales"] as const;

function normalizar(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function resolverLocal(almacen: AlmacenRow): LocalId | null {
  const value = normalizar(`${almacen.codigo ?? ""} ${almacen.nombre}`);
  if (value.includes("uquisamana")) return "uquisamana";
  if (value.includes("isac_tamayo") || value.includes("isaac_tamayo")) return "isac_tamayo";
  if (value.includes("calacoto")) return "calacoto";
  if (value.includes("santa_cruz")) return "santa_cruz";
  return null;
}

function stockVacio(): StockPorLocal {
  return { uquisamana: 0, isac_tamayo: 0, calacoto: 0, santa_cruz: 0 };
}

function mapearProducto(row: ProductoRow): Producto {
  const stock = stockVacio();
  for (const item of row.stock_por_almacen ?? []) {
    if (!item.almacen) continue;
    const local = resolverLocal(item.almacen);
    if (local) stock[local] += Number(item.cantidad_disponible ?? 0);
  }
  const codigoSin = row.codigo_producto_sin ? String(row.codigo_producto_sin) : "";
  return {
    id: row.id,
    actividadEconomicaCodigo: "",
    actividadEconomicaNombre: ACTIVIDADES_ECONOMICAS[0]?.nombre ?? "",
    homologadoCodigo: codigoSin,
    homologadoNombre: PRODUCTOS_HOMOLOGADOS.find((item) => item.codigo === codigoSin)?.nombre ?? "",
    nombre: row.nombre,
    descripcion: row.descripcion ?? "",
    unidadMedida: row.medida ?? "",
    precio: Number(row.precio_pieza ?? 0),
    precioComparacion: Number(row.precio_12 ?? 0),
    costo: Number(row.precio_produccion ?? 0),
    sku: row.codigo_interno,
    codigoBarras: row.numero ?? "",
    tieneOpciones: false,
    stockPorLocal: stock,
    activo: row.activo,
  };
}

function numeroOpcional(value: string) {
  const parsed = Number(value);
  return value.trim() && Number.isInteger(parsed) ? parsed : null;
}

function productoPayload(values: ProductoFormValues) {
  return {
    codigo_interno: values.sku.trim(),
    codigo_producto_sin: numeroOpcional(values.homologadoCodigo),
    nombre: values.nombre.trim(),
    descripcion: values.descripcion.trim() || null,
    numero: values.codigoBarras.trim() || null,
    medida: values.unidadMedida,
    precio_produccion: values.costo,
    precio_12: values.precioComparacion,
    precio_pieza: values.precio,
    activo: true,
  };
}

export async function listarProductos(): Promise<Producto[]> {
  const { data, error } = await supabase
    .from("productos")
    .select(`id, codigo_interno, codigo_producto_sin, nombre, descripcion, numero, medida, precio_produccion, precio_12, precio_pieza, activo,
      stock_por_almacen (cantidad_disponible, almacen:almacenes (id, codigo, nombre, activo))`)
    .order("nombre");
  if (error) throw new Error(error.message || "No se pudieron cargar los productos.");
  return ((data ?? []) as unknown as ProductoRow[]).map(mapearProducto);
}

export async function crearProducto(values: ProductoFormValues): Promise<string> {
  const payload = productoPayload(values);
  const { data, error } = await supabase.rpc("crear_producto_con_stock", {
    p_codigo_interno: payload.codigo_interno,
    p_codigo_producto_sin: payload.codigo_producto_sin,
    p_nombre: payload.nombre,
    p_descripcion: payload.descripcion,
    p_numero: payload.numero,
    p_medida: payload.medida,
    p_precio_produccion: payload.precio_produccion,
    p_precio_12: payload.precio_12,
    p_precio_pieza: payload.precio_pieza,
  });
  if (error) throw new Error(error.message || "No se pudo crear el producto.");
  if (!data) throw new Error("Supabase no devolvió el producto creado.");
  return String(data);
}

export async function actualizarProducto(id: string, values: ProductoFormValues): Promise<void> {
  const { data, error } = await supabase.from("productos").update(productoPayload(values)).eq("id", id).select("id").single();
  if (error) throw new Error(error.message || "No se pudo actualizar el producto.");
  if (!data) throw new Error("Supabase no confirmó la actualización del producto.");
}

export async function eliminarProductos(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { data, error } = await supabase.rpc("eliminar_productos", { p_ids: ids });
  if (error) throw new Error(error.message || "No se pudieron eliminar los productos.");
  if (Number(data ?? 0) !== ids.length) throw new Error("Supabase no confirmó la eliminación de todos los productos seleccionados.");
}

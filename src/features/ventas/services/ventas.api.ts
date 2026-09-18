import { supabase } from "../../../lib/supabase";
import type {
  ClienteVenta,
  NuevoClienteInput,
  ProductoVenta,
  RegistrarVentaInput,
} from "../types/ventas.types";

interface AlmacenRow {
  id: string;
  codigo: string | null;
  nombre: string;
  activo: boolean;
}

interface StockPorAlmacenRow {
  cantidad_disponible: number | string | null;
  almacen: AlmacenRow | null;
}

interface ProductoVentaRow {
  id: string;
  codigo_interno: string;
  nombre: string;
  descripcion: string | null;
  medida: string | null;
  precio_pieza: number | string | null;
  stock_por_almacen: StockPorAlmacenRow[] | null;
}

function limpiarBusqueda(value: string) {
  return value.trim().replace(/[(),]/g, " ").replace(/\s+/g, " ");
}

export async function buscarClientes(termino: string): Promise<ClienteVenta[]> {
  const q = limpiarBusqueda(termino);
  if (!q) return [];

  const { data, error } = await supabase
    .from("clientes")
    .select("id, codigo_cliente, nombre_razon_social, tipo_documento, numero_documento, complemento, correo, telefono")
    .eq("activo", true)
    .or([`nombre_razon_social.ilike.%${q}%`, `numero_documento.ilike.%${q}%`, `codigo_cliente.ilike.%${q}%`].join(","))
    .limit(10);

  if (error) throw new Error(error.message || "No se pudieron buscar los clientes.");
  return (data ?? []) as ClienteVenta[];
}

export async function crearClienteRapido(input: NuevoClienteInput): Promise<ClienteVenta> {
  const { data, error } = await supabase
    .from("clientes")
    .insert({
      tipo_documento: input.tipo_documento,
      nombre_razon_social: input.nombre_razon_social.trim(),
      numero_documento: input.numero_documento.trim(),
      complemento: input.complemento?.trim() || null,
      correo: input.correo.trim(),
      telefono: input.telefono?.trim() || null,
      activo: true,
    })
    .select("id, codigo_cliente, nombre_razon_social, tipo_documento, numero_documento, complemento, correo, telefono")
    .single();

  if (error) throw new Error(error.message || "No se pudo registrar el cliente.");
  return data as ClienteVenta;
}

export async function buscarProductosVenta(termino: string): Promise<ProductoVenta[]> {
  const q = limpiarBusqueda(termino);
  if (!q) return [];

  const { data, error } = await supabase
    .from("productos")
    .select(`
      id, codigo_interno, nombre, descripcion, medida, precio_pieza,
      stock_por_almacen (
        cantidad_disponible,
        almacen:almacenes (id, codigo, nombre, activo)
      )
    `)
    .eq("activo", true)
    .or([`nombre.ilike.%${q}%`, `codigo_interno.ilike.%${q}%`, `descripcion.ilike.%${q}%`].join(","))
    .limit(15);

  if (error) throw new Error(error.message || "No se pudieron consultar los productos.");

  return ((data ?? []) as unknown as ProductoVentaRow[]).map((row): ProductoVenta => ({
    id: row.id,
    codigo_interno: row.codigo_interno,
    nombre: row.nombre,
    descripcion: row.descripcion,
    medida: row.medida,
    precio_pieza: Number(row.precio_pieza ?? 0),
    stocks: (row.stock_por_almacen ?? [])
      .filter((stock): stock is StockPorAlmacenRow & { almacen: AlmacenRow } =>
        stock.almacen !== null && stock.almacen.activo && Number(stock.cantidad_disponible) > 0
      )
      .map((stock) => ({
        almacen: {
          id: stock.almacen.id,
          codigo: stock.almacen.codigo,
          nombre: stock.almacen.nombre,
        },
        cantidad: Number(stock.cantidad_disponible),
      })),
  }));
}

export async function registrarVenta(venta: RegistrarVentaInput) {
  const { data, error } = await supabase.rpc("registrar_venta_fiscal", {
    p_cliente_id: venta.cliente_id,
    p_metodo_pago: venta.metodo_pago,
    p_tarjeta_ofuscada: venta.tarjeta_ofuscada,
    p_observacion: venta.observacion || null,
    p_descuento_venta: venta.descuento_venta,
    p_items: venta.items,
  });

  if (error) throw new Error(error.message || "No se pudo registrar la venta.");
  return data;
}

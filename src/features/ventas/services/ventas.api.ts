import { supabase } from "../../../lib/supabase";
import type {
  ClienteVenta,
  NuevoClienteInput,
  ProductoVenta,
  RegistrarVentaInput,
} from "../types/ventas.types";
import type { GestionVenta } from "../types/gestionVentas.types";

interface AlmacenRow {
  id: string;
  codigo: string | null;
  nombre: string;
  tipo: string | null;
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

const UBICACIONES_VENTA = [
  "LOC-SANTA-CRUZ",
  "LOC-CALACOTO",
  "LOC-ISAC-TAMAYO",
  "ALM-UQUISAMANA",
] as const;

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
      correo: input.correo.trim() || null,
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
  const filtros = [
    `nombre.ilike.%${q}%`,
    `codigo_interno.ilike.%${q}%`,
    `descripcion.ilike.%${q}%`,
    `numero.ilike.%${q}%`,
  ];
  if (/^\d+$/.test(q)) filtros.push(`codigo_producto_sin.eq.${Number(q)}`);

  const [productosResponse, almacenesResponse] = await Promise.all([
    supabase
      .from("productos")
      .select(`
        id, codigo_interno, nombre, descripcion, medida, precio_pieza,
        stock_por_almacen (
          cantidad_disponible,
          almacen:almacenes (id, codigo, nombre, tipo, activo)
        )
      `)
      .eq("activo", true)
      .or(filtros.join(","))
      .limit(15),
    supabase
      .from("almacenes")
      .select("id, codigo, nombre, tipo, activo")
      .eq("activo", true)
      .in("codigo", [...UBICACIONES_VENTA]),
  ]);

  if (productosResponse.error) throw new Error(productosResponse.error.message || "No se pudieron consultar los productos.");
  if (almacenesResponse.error) throw new Error(almacenesResponse.error.message || "No se pudieron consultar las ubicaciones de venta.");

  const almacenes = ((almacenesResponse.data ?? []) as AlmacenRow[])
    .sort((a, b) => UBICACIONES_VENTA.indexOf(a.codigo as typeof UBICACIONES_VENTA[number]) - UBICACIONES_VENTA.indexOf(b.codigo as typeof UBICACIONES_VENTA[number]));

  return ((productosResponse.data ?? []) as unknown as ProductoVentaRow[]).map((row): ProductoVenta => ({
    id: row.id,
    codigo_interno: row.codigo_interno,
    nombre: row.nombre,
    descripcion: row.descripcion,
    medida: row.medida,
    precio_pieza: Number(row.precio_pieza ?? 0),
    stocks: almacenes.map((almacen) => {
      const stock = (row.stock_por_almacen ?? []).find((item) => item.almacen?.id === almacen.id);
      return {
        almacen: {
          id: almacen.id,
          codigo: almacen.codigo,
          nombre: almacen.nombre,
          tipo: almacen.tipo,
        },
        cantidad: Number(stock?.cantidad_disponible ?? 0),
      };
    }),
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

interface VentaGestionRow {
  id: string;
  codigo_venta: string;
  fecha_venta: string;
  total: number | string | null;
  estado: string | null;
  cliente_id: string | null;
  usuario_id: string | null;
}

interface HistorialVentaRow {
  venta_id: string;
  codigo_venta: string;
  fecha_venta: string;
  total: number | string | null;
  estado: string | null;
  cliente_id: string | null;
  usuario_id: string | null;
  numero_factura: number | string | null;
  fecha_facturacion: string | null;
}


interface ClienteGestionRow {
  id: string;
  nombre_razon_social: string | null;
  numero_documento: string | null;
  correo: string | null;
}

interface UsuarioGestionRow {
  id: string;
  nombre: string | null;
  apellidos: string | null;
  correo: string | null;
}


export async function listarVentasGestion(): Promise<GestionVenta[]> {
  const ventas: VentaGestionRow[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from("ventas")
      .select("id, codigo_venta, fecha_venta, total, estado, cliente_id, usuario_id")
      .order("fecha_venta", { ascending: false }).order("id").range(offset, offset + 499);
    if (error) throw new Error(error.message || "No se pudo cargar el historial de ventas.");
    ventas.push(...(data ?? []) as unknown as VentaGestionRow[]);
    if (!data || data.length < 500) break;
  }

  // El trigger de ventas mantiene este resumen para el historial. Se usa como
  // respaldo para instalaciones que ya tenían ventas registradas previamente.
  if (ventas.length === 0) {
    for (let offset = 0; ; offset += 500) {
      const { data: historial, error: historialError } = await supabase
      .from("historial_ventas")
      .select("venta_id, codigo_venta, fecha_venta, total, estado, cliente_id, usuario_id, numero_factura, fecha_facturacion")
      .order("fecha_venta", { ascending: false }).order("venta_id")
      .range(offset, offset + 499);

      if (historialError) throw new Error(historialError.message || "No se pudo cargar el historial anterior.");
      ventas.push(...((historial ?? []) as HistorialVentaRow[]).map((venta) => ({
        id: venta.venta_id,
        codigo_venta: venta.numero_factura == null ? venta.codigo_venta : String(venta.numero_factura),
        fecha_venta: venta.fecha_facturacion ?? venta.fecha_venta,
        total: venta.total,
        estado: venta.estado,
        cliente_id: venta.cliente_id,
        usuario_id: venta.usuario_id,
      })));
      if (!historial || historial.length < 500) break;
    }
  }
  const clienteIds = [...new Set(ventas.flatMap((venta) => venta.cliente_id ? [venta.cliente_id] : []))];
  const usuarioIds = [...new Set(ventas.flatMap((venta) => venta.usuario_id ? [venta.usuario_id] : []))];
  const clientesPorId = new Map<string, ClienteGestionRow>();
  const usuariosPorId = new Map<string, UsuarioGestionRow>();
  await Promise.all([
    (async () => {
      for (let offset = 0; offset < clienteIds.length; offset += 100) {
        const result = await supabase.from("clientes").select("id, nombre_razon_social, numero_documento, correo").in("id", clienteIds.slice(offset, offset + 100));
        if (result.error) throw new Error("No se pudieron consultar los clientes de las ventas.");
        for (const cliente of (result.data ?? []) as ClienteGestionRow[]) clientesPorId.set(cliente.id, cliente);
      }
    })(),
    (async () => {
      for (let offset = 0; offset < usuarioIds.length; offset += 100) {
        const result = await supabase.from("usuarios").select("id, nombre, apellidos, correo").in("id", usuarioIds.slice(offset, offset + 100));
        if (result.error) throw new Error("No se pudieron consultar los usuarios de las ventas.");
        for (const usuario of (result.data ?? []) as UsuarioGestionRow[]) usuariosPorId.set(usuario.id, usuario);
      }
    })(),
  ]);

  return ventas.map((venta) => {
    const cliente = venta.cliente_id ? clientesPorId.get(venta.cliente_id) : null;
    const usuario = venta.usuario_id ? usuariosPorId.get(venta.usuario_id) : null;
    const nombreUsuario = [usuario?.nombre, usuario?.apellidos].filter(Boolean).join(" ");

    return {
      id: `venta:${venta.id}`,
      ventaId: venta.id,
      origen: "VENTA",
      estadoComercial: venta.estado,
      facturaId: null,
      numeroFactura: venta.codigo_venta,
      fechaEmision: venta.fecha_venta,
      razonSocial: cliente?.nombre_razon_social || (venta.cliente_id ? "Cliente no disponible" : "Consumidor final"),
      numeroDocumento: cliente?.numero_documento || "—",
      monto: Number(venta.total ?? 0),
      moneda: "BOB",
      usuario: nombreUsuario || usuario?.correo || "Sistema",
      estado: "PENDIENTE",
      correoCliente: cliente?.correo ?? null,
    };
  });
}

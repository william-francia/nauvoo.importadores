import { supabase } from "../../../../lib/supabase";
import { UBICACIONES } from "../constants/inventario.constants";
import type { InventarioMovimiento, InventarioProducto, RegistrarMovimientoInput, RegistrarTrasladoInput } from "../types/inventario.types";

type StockRow = { cantidad_disponible: number | string | null; almacen: { codigo: string | null; nombre: string } | null };
type ProductoRow = { id: string; codigo_interno: string; nombre: string; medida: string | null; activo: boolean; stock_por_almacen: StockRow[] | null };
type MovimientoRow = {
  id: string;
  producto_id: string;
  tipo_movimiento: string;
  cantidad: number | string;
  almacen_id: string;
  observacion: string | null;
  motivo?: string | null;
  fecha: string;
  anulado?: boolean;
  almacen?: { codigo: string | null; nombre: string } | Array<{ codigo: string | null; nombre: string }> | null;
};

function normalizar(value: string) { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_"); }
function ubicacionDe(almacen: { codigo: string | null; nombre: string }) {
  const value = normalizar(`${almacen.codigo ?? ""} ${almacen.nombre}`);
  return UBICACIONES.find((item) => value.includes(normalizar(item.id.replace("almacen_", "").replace("_", " "))) || value.includes(normalizar(item.nombre)))?.id;
}
function almacenRelacionado(almacen: MovimientoRow["almacen"]) {
  return Array.isArray(almacen) ? almacen[0] : almacen;
}
async function almacenId(ubicacion: string) {
  const { data, error } = await supabase.from("almacenes").select("id,codigo,nombre").eq("activo", true);
  if (error) throw new Error(error.message || "No se pudieron consultar las ubicaciones.");
  const item = UBICACIONES.find((value) => value.id === ubicacion);
  const found = (data ?? []).find((value) => item && ubicacionDe(value) === item.id);
  if (!found) throw new Error("No se encontró la ubicación seleccionada.");
  return found.id as string;
}

function rpcNoDisponible(message: string) {
  return /could not find the function|schema cache|function .* does not exist/i.test(message);
}

function tipoMovimientoBase(tipo: RegistrarMovimientoInput["tipo"]) {
  if (tipo === "INGRESO") return "entrada";
  return "ajuste";
}

function tipoFormulario(row: Pick<MovimientoRow, "tipo_movimiento" | "motivo"> & { stock_anterior?: number | string | null; stock_resultante?: number | string | null }): InventarioMovimiento["tipo"] {
  if (row.tipo_movimiento === "entrada") return "INGRESO";
  if (row.tipo_movimiento === "salida") return /traslado/i.test(row.motivo ?? "") ? "TRASLADO" : "AJUSTE_DISMINUCION";
  return Number(row.stock_resultante ?? 0) < Number(row.stock_anterior ?? 0) ? "AJUSTE_DISMINUCION" : "AJUSTE_AUMENTO";
}

async function registrarMovimientoDirecto(input: RegistrarMovimientoInput, id: string) {
  const { data: fila, error: consultaError } = await supabase
    .from("stock_por_almacen")
    .select("id,cantidad_disponible")
    .eq("producto_id", input.productoId)
    .eq("almacen_id", id)
    .maybeSingle();
  if (consultaError) throw new Error(consultaError.message);

  const anterior = Number(fila?.cantidad_disponible ?? 0);
  const resultante = anterior + (input.tipo === "AJUSTE_DISMINUCION" ? -input.cantidad : input.cantidad);
  if (resultante < 0) throw new Error("No existe suficiente stock para realizar la disminución.");

  const stockResult = fila
    ? await supabase.from("stock_por_almacen").update({ cantidad_disponible: resultante }).eq("id", fila.id)
    : await supabase.from("stock_por_almacen").insert({ producto_id: input.productoId, almacen_id: id, cantidad_disponible: resultante, cantidad_reservada: 0 });
  if (stockResult.error) throw new Error(stockResult.error.message);

  const movimiento = await supabase.from("movimientos_inventario").insert({
    producto_id: input.productoId,
    almacen_id: id,
    tipo_movimiento: tipoMovimientoBase(input.tipo),
    cantidad: input.cantidad,
    stock_anterior: anterior,
    stock_resultante: resultante,
    motivo: "Movimiento de inventario",
    observacion: input.observacion || null,
    fecha: `${input.fecha}T00:00:00.000Z`,
  });
  if (movimiento.error) throw new Error(movimiento.error.message);
}

async function registrarTrasladoDirecto(input: RegistrarTrasladoInput, origenId: string, destinoId: string) {
  const [origenConsulta, destinoConsulta] = await Promise.all([
    supabase.from("stock_por_almacen").select("id,cantidad_disponible").eq("producto_id", input.productoId).eq("almacen_id", origenId).maybeSingle(),
    supabase.from("stock_por_almacen").select("id,cantidad_disponible").eq("producto_id", input.productoId).eq("almacen_id", destinoId).maybeSingle(),
  ]);
  if (origenConsulta.error || destinoConsulta.error) throw new Error(origenConsulta.error?.message || destinoConsulta.error?.message || "No se pudo consultar el stock.");

  const origen = origenConsulta.data;
  const destino = destinoConsulta.data;
  const stockOrigen = Number(origen?.cantidad_disponible ?? 0);
  const stockDestino = Number(destino?.cantidad_disponible ?? 0);
  if (!origen || stockOrigen < input.cantidad) throw new Error("El almacén Uquisamaña no tiene suficiente stock para realizar el traslado.");

  const salida = await supabase.from("stock_por_almacen").update({ cantidad_disponible: stockOrigen - input.cantidad }).eq("id", origen.id);
  if (salida.error) throw new Error(salida.error.message);

  const entrada = destino
    ? await supabase.from("stock_por_almacen").update({ cantidad_disponible: stockDestino + input.cantidad }).eq("id", destino.id)
    : await supabase.from("stock_por_almacen").insert({ producto_id: input.productoId, almacen_id: destinoId, cantidad_disponible: input.cantidad, cantidad_reservada: 0 });
  if (entrada.error) throw new Error(entrada.error.message);

  const movimientos = await supabase.from("movimientos_inventario").insert([
    {
      producto_id: input.productoId, almacen_id: origenId, tipo_movimiento: "salida", cantidad: input.cantidad,
      stock_anterior: stockOrigen, stock_resultante: stockOrigen - input.cantidad,
      motivo: "Traslado a local", observacion: `Traslado a ${input.destino}${input.observacion ? ` · ${input.observacion}` : ""}`, fecha: `${input.fecha}T00:00:00.000Z`,
    },
    {
      producto_id: input.productoId, almacen_id: destinoId, tipo_movimiento: "entrada", cantidad: input.cantidad,
      stock_anterior: stockDestino, stock_resultante: stockDestino + input.cantidad,
      motivo: "Traslado desde almacén", observacion: input.observacion || null, fecha: `${input.fecha}T00:00:00.000Z`,
    },
  ]);
  if (movimientos.error) throw new Error(movimientos.error.message);
}

export async function listarInventario(): Promise<InventarioProducto[]> {
  // Los productos son la fuente principal. El stock es complementario y puede
  // estar en cero o todavía no tener filas para todas las ubicaciones.
  const [{ data, error }, { data: stocks, error: stockError }] = await Promise.all([
    supabase.from("productos").select("id,codigo_interno,nombre,medida,activo").eq("activo", true).order("nombre"),
    supabase.from("stock_por_almacen").select("producto_id,cantidad_disponible,almacen:almacenes(codigo,nombre)")
  ]);
  if (error) throw new Error(error.message || "No se pudo cargar el inventario.");
  // Si todavía no hay permisos/filas de stock, los productos deben seguir
  // visibles con cantidad cero para poder inicializar su inventario.
  const stocksDisponibles = stockError ? [] : stocks ?? [];
  const stocksPorProducto = new Map<string, StockRow[]>();
  for (const stock of stocksDisponibles as unknown as Array<StockRow & { producto_id: string }>) {
    const actual = stocksPorProducto.get(stock.producto_id) ?? [];
    actual.push(stock);
    stocksPorProducto.set(stock.producto_id, actual);
  }
  return ((data ?? []) as unknown as ProductoRow[]).map((row) => {
    const stock = Object.fromEntries(UBICACIONES.map((item) => [item.id, 0]));
    for (const item of stocksPorProducto.get(row.id) ?? []) { if (item.almacen) { const id = ubicacionDe(item.almacen); if (id) stock[id] = Number(item.cantidad_disponible ?? 0); } }
    return { id: row.id, codigo: row.codigo_interno, nombre: row.nombre, unidadMedida: row.medida ?? "", stock, ultimaActualizacion: new Date().toISOString() } as InventarioProducto;
  });
}

export async function listarMovimientos(): Promise<InventarioMovimiento[]> {
  const consultaConAnulacion = await supabase.from("movimientos_inventario").select("id,producto_id,tipo_movimiento,cantidad,almacen_id,observacion,motivo,fecha,anulado,stock_anterior,stock_resultante,almacen:almacenes(codigo,nombre)").order("fecha", { ascending: false }).limit(500);
  let data: unknown = consultaConAnulacion.data;
  let error = consultaConAnulacion.error;
  // La columna anulado se agrega con una migración posterior. Mientras tanto,
  // se lee el historial existente sin ocultar los movimientos ya registrados.
  if (error && /anulado/i.test(error.message)) {
    const consultaSinAnulacion = await supabase.from("movimientos_inventario").select("id,producto_id,tipo_movimiento,cantidad,almacen_id,observacion,motivo,fecha,stock_anterior,stock_resultante,almacen:almacenes(codigo,nombre)").order("fecha", { ascending: false }).limit(500);
    data = consultaSinAnulacion.data;
    error = consultaSinAnulacion.error;
  }
  if (error) throw new Error(error.message || "No se pudo cargar el historial de inventario.");
  const rows = (data ?? []) as MovimientoRow[];
  return rows.map((row) => {
    const traslado = row.tipo_movimiento === "salida" && /traslado/i.test(row.motivo ?? "");
    const entradaDestino = traslado
      ? rows.find((item) => item.producto_id === row.producto_id && item.fecha === row.fecha && item.tipo_movimiento === "entrada" && /traslado/i.test(item.motivo ?? ""))
      : undefined;
    const ubicacionDestino = traslado
      ? UBICACIONES.find((ubicacion) => row.observacion?.includes(ubicacion.id))?.id ?? (almacenRelacionado(entradaDestino?.almacen) ? ubicacionDe(almacenRelacionado(entradaDestino?.almacen)!) : undefined)
      : undefined;
    return { id: row.id, productoId: row.producto_id, tipo: tipoFormulario(row), cantidad: Number(row.cantidad), fecha: row.fecha.slice(0, 10), ubicacionDestino, observacion: row.observacion ?? undefined, responsable: "Usuario actual", anulado: Boolean(row.anulado), creadoEn: row.fecha };
  });
}

export async function registrarMovimiento(input: RegistrarMovimientoInput) {
  if (input.ubicacion !== "almacen_uquisamana") {
    throw new Error("Los ingresos y ajustes manuales solo pueden registrarse en el almacén Uquisamaña.");
  }
  const id = await almacenId(input.ubicacion);
  const { error } = await supabase.rpc("registrar_movimiento_inventario", { p_producto_id: input.productoId, p_almacen_id: id, p_tipo: input.tipo, p_cantidad: input.cantidad, p_fecha: input.fecha, p_observacion: input.observacion ?? null });
  if (!error) return;
  if (rpcNoDisponible(error.message)) return registrarMovimientoDirecto(input, id);
  throw new Error(error.message);
}
export async function registrarTraslado(input: RegistrarTrasladoInput) {
  const origen = await almacenId("almacen_uquisamana");
  const destino = await almacenId(input.destino);
  const { error } = await supabase.rpc("registrar_traslado_inventario", { p_producto_id: input.productoId, p_origen_id: origen, p_destino_id: destino, p_cantidad: input.cantidad, p_fecha: input.fecha, p_observacion: input.observacion ?? null });
  if (!error) return;
  if (rpcNoDisponible(error.message)) return registrarTrasladoDirecto(input, origen, destino);
  throw new Error(error.message);
}
export async function anularMovimiento(id: string) { const { error } = await supabase.rpc("anular_movimiento_inventario", { p_movimiento_id: id }); if (error) throw new Error(error.message); }

import { useEffect, useMemo, useState } from "react";
import { anularMovimiento as anularMovimientoReal, listarInventario, listarMovimientos, registrarMovimiento as guardarMovimiento, registrarTraslado as guardarTraslado } from "../services/inventario.service";
import type { InventarioMovimiento, InventarioProducto, RegistrarMovimientoInput, RegistrarTrasladoInput } from "../types/inventario.types";

export function totalProducto(producto: InventarioProducto) {
  return Object.values(producto.stock).reduce((total, cantidad) => total + cantidad, 0);
}

export function useInventarioProductos() {
  const [productos, setProductos] = useState<InventarioProducto[]>([]);
  const [movimientos, setMovimientos] = useState<InventarioMovimiento[]>([]);
  const [busqueda, setBusqueda] = useState("");
  const [filasExpandidas, setFilasExpandidas] = useState<Set<string>>(new Set());
  const [notificacion, setNotificacion] = useState<string | null>(null);

  useEffect(() => {
    if (!notificacion) return;
    const temporizador = window.setTimeout(() => setNotificacion(null), 5_000);
    return () => window.clearTimeout(temporizador);
  }, [notificacion]);

  async function recargar() {
    const productosActuales = await listarInventario();
    let movimientosActuales: InventarioMovimiento[] = [];
    try {
      movimientosActuales = await listarMovimientos();
    } catch {
      // La lista de productos no depende de que exista aún el historial.
    }
    setProductos(productosActuales);
    setMovimientos(movimientosActuales);
  }

  useEffect(() => { void recargar(); }, []);

  const productosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return q ? productos.filter((producto) => `${producto.nombre} ${producto.codigo}`.toLowerCase().includes(q)) : productos;
  }, [productos, busqueda]);

  const productosConStock = useMemo(() => productos.filter((producto) => totalProducto(producto) > 0).length, [productos]);
  const movimientosSemana = useMemo(() => {
    const inicio = new Date();
    inicio.setDate(inicio.getDate() - 7);
    return movimientos.filter((movimiento) => !movimiento.anulado && new Date(movimiento.creadoEn) >= inicio).length;
  }, [movimientos]);

  function toggleFila(productoId: string) {
    setFilasExpandidas((actual) => { const siguiente = new Set(actual); if (siguiente.has(productoId)) siguiente.delete(productoId); else siguiente.add(productoId); return siguiente; });
  }

  async function registrarMovimiento(input: RegistrarMovimientoInput) {
    await guardarMovimiento(input);
    const producto = productos.find((item) => item.id === input.productoId);
    setNotificacion(`Inventario actualizado correctamente: ${producto?.nombre ?? "producto"}.`);
    await recargar();
  }

  async function registrarTraslado(input: RegistrarTrasladoInput) {
    await guardarTraslado(input);
    const producto = productos.find((item) => item.id === input.productoId);
    setNotificacion(`Traslado registrado correctamente: ${producto?.nombre ?? "producto"}.`);
    await recargar();
  }

  async function anularMovimiento(id: string) {
    await anularMovimientoReal(id);
    setNotificacion("Movimiento de inventario anulado correctamente.");
    await recargar();
  }

  return { productos, productosFiltrados, movimientos, busqueda, setBusqueda, filasExpandidas, toggleFila, productosConStock, movimientosSemana, registrarMovimiento, registrarTraslado, anularMovimiento, notificacion, cerrarNotificacion: () => setNotificacion(null) };
}

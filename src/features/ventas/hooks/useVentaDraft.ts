import { useMemo, useState } from "react";
import type { ClienteVenta, LineaVenta, ProductoVenta } from "../types/ventas.types";

export function useVentaDraft() {
  const [lineas, setLineas] = useState<LineaVenta[]>([]);
  const [cliente, setCliente] = useState<ClienteVenta | null>(null);
  const [observacion, setObservacion] = useState("");
  const [descuentoAdicional, setDescuentoAdicional] = useState(0);

  const totales = useMemo(() => {
    const subtotal = lineas.reduce((sum, l) => sum + l.precio_unitario * l.cantidad, 0);
    const descuentoLineas = lineas.reduce((sum, l) => sum + l.descuento, 0);
    return { subtotal, descuentoLineas, descuentoAdicional, total: Math.max(0, subtotal - descuentoLineas - descuentoAdicional) };
  }, [lineas, descuentoAdicional]);

  function almacenPredeterminado(producto: ProductoVenta) {
    return producto.stocks.find((stock) => {
      const nombre = `${stock.almacen.codigo ?? ""} ${stock.almacen.nombre}`.toLowerCase();
      return nombre.includes("isac") && nombre.includes("tamayo");
    }) ?? producto.stocks[0];
  }

  function agregarProducto(producto: ProductoVenta) {
    const stock = almacenPredeterminado(producto);
    if (!stock) throw new Error("El producto no tiene stock disponible.");
    setLineas(current => [...current, { id: crypto.randomUUID(), producto, almacen_id: stock.almacen.id, cantidad: 1, precio_unitario: producto.precio_pieza, descuento: 0, informacion_extra: "" }]);
  }
  const update = (id: string, changes: Partial<LineaVenta>) => setLineas(current => current.map(l => l.id === id ? { ...l, ...changes } : l));
  return { lineas, cliente, observacion, descuentoAdicional, totales, setCliente, setObservacion, setDescuentoAdicional, agregarProducto,
    actualizarCantidad: (id: string, cantidad: number) => update(id, { cantidad: Math.max(1, cantidad) }),
    actualizarAlmacen: (id: string, almacen_id: string) => update(id, { almacen_id }),
    actualizarPrecio: (id: string, precio_unitario: number) => update(id, { precio_unitario: Math.max(0, precio_unitario) }),
    actualizarDescuento: (id: string, descuento: number) => update(id, { descuento: Math.max(0, descuento) }),
    actualizarInformacionExtra: (id: string, informacion_extra: string) => update(id, { informacion_extra }),
    eliminarLinea: (id: string) => setLineas(current => current.filter(l => l.id !== id)),
    limpiarVenta: () => { setLineas([]); setCliente(null); setObservacion(""); setDescuentoAdicional(0); },
  };
}

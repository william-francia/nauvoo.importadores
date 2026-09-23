import { useEffect, useMemo, useState } from "react";
import type { ClienteVenta, LineaVenta, ProductoVenta } from "../types/ventas.types";
import { supabase } from "../../../lib/supabase";

const DRAFT_PREFIX = "nauvoo:venta-draft:";

interface VentaDraftSnapshot {
  lineas: LineaVenta[];
  cliente: ClienteVenta | null;
  observacion: string;
  descuentoAdicional: number;
}

function readDraft(key: string): VentaDraftSnapshot | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<VentaDraftSnapshot>;
    if (!Array.isArray(draft.lineas)) return null;
    return {
      lineas: draft.lineas,
      cliente: draft.cliente ?? null,
      observacion: typeof draft.observacion === "string" ? draft.observacion : "",
      descuentoAdicional: Number(draft.descuentoAdicional) || 0,
    };
  } catch {
    return null;
  }
}

export function useVentaDraft() {
  const [lineas, setLineas] = useState<LineaVenta[]>([]);
  const [cliente, setCliente] = useState<ClienteVenta | null>(null);
  const [observacion, setObservacion] = useState("");
  const [descuentoAdicional, setDescuentoAdicional] = useState(0);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [draftLoaded, setDraftLoaded] = useState(false);

  // El borrador queda aislado por usuario y sobrevive al cambio de pantalla o a un refresh.
  useEffect(() => {
    let activo = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!activo) return;
      const key = `${DRAFT_PREFIX}${data.session?.user.id ?? "anonimo"}`;
      const draft = readDraft(key);
      if (draft) {
        setLineas(draft.lineas);
        setCliente(draft.cliente);
        setObservacion(draft.observacion);
        setDescuentoAdicional(draft.descuentoAdicional);
      }
      setDraftKey(key);
      setDraftLoaded(true);
    });

    return () => {
      activo = false;
    };
  }, []);

  useEffect(() => {
    if (!draftLoaded || !draftKey) return;
    try {
      if (lineas.length === 0 && !cliente && !observacion && descuentoAdicional === 0) {
        localStorage.removeItem(draftKey);
        return;
      }
      const snapshot: VentaDraftSnapshot = {
        lineas,
        cliente,
        observacion,
        descuentoAdicional,
      };
      localStorage.setItem(draftKey, JSON.stringify(snapshot));
    } catch {
      // La venta continúa funcionando aunque el navegador no permita almacenamiento local.
    }
  }, [cliente, descuentoAdicional, draftKey, draftLoaded, lineas, observacion]);

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
    limpiarVenta: () => {
      setLineas([]);
      setCliente(null);
      setObservacion("");
      setDescuentoAdicional(0);
      if (draftKey) {
        try {
          localStorage.removeItem(draftKey);
        } catch {
          // La limpieza del borrador es opcional si el almacenamiento está bloqueado.
        }
      }
    },
  };
}

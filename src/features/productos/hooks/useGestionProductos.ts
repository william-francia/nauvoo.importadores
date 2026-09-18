// src/features/productos/hooks/useGestionProductos.ts

import {
  useMemo,
  useState,
} from "react";

import type {
  GestionProductosFilters,
  Producto,
} from "../types/productos.types";

import {
  calcularInventarioTotal,
  normalizarBusqueda,
} from "../utils/productos.utils";

const FILTROS_INICIALES: GestionProductosFilters = {
  producto: "",
  inventario: "",
  siat: "TODOS",
};

export function useGestionProductos(
  initialProducts: Producto[],
  homologados: Set<string> = new Set()
) {
  const [productos, setProductos] =
    useState<Producto[]>(
      initialProducts
    );

  const [filters, setFilters] =
    useState<GestionProductosFilters>(
      FILTROS_INICIALES
    );

  const [seleccionados, setSeleccionados] =
    useState<Set<string>>(
      new Set()
    );

  const [pagina, setPagina] =
    useState(1);

  const [porPagina, setPorPagina] =
    useState(10);

  function actualizarFiltro<
    K extends keyof GestionProductosFilters
  >(
    key: K,
    value: GestionProductosFilters[K]
  ) {
    setFilters((current) => ({
      ...current,
      [key]: value,
    }));

    setPagina(1);
  }

  function limpiarFiltros() {
    setFilters(FILTROS_INICIALES);
    setPagina(1);
  }

  const productosFiltrados =
    useMemo(() => {
      const producto =
        normalizarBusqueda(
          filters.producto
        );

      const inventario =
        normalizarBusqueda(
          filters.inventario
        );

      return productos.filter(
        (item) => {
          if (
            producto &&
            !normalizarBusqueda(
              `${item.nombre} ${item.descripcion} ${item.sku}`
            ).includes(producto)
          ) {
            return false;
          }

          if (inventario) {
            const total =
              calcularInventarioTotal(
                item.stockPorLocal
              );

            if (
              !String(total).includes(
                inventario
              )
            ) {
              return false;
            }
          }

          const homologado = homologados.has(item.id) || homologados.has(item.sku.toUpperCase());
          if (filters.siat === "HOMOLOGADO" && !homologado) return false;
          if (filters.siat === "PENDIENTE" && homologado) return false;

          return true;
        }
      );
    }, [
      productos,
      filters,
      homologados,
    ]);

  const totalPaginas = Math.max(
    1,
    Math.ceil(
      productosFiltrados.length /
        porPagina
    )
  );

  const paginaActual = Math.min(
    pagina,
    totalPaginas
  );

  const productosPagina =
    useMemo(() => {
      const inicio =
        (paginaActual - 1) *
        porPagina;

      return productosFiltrados.slice(
        inicio,
        inicio + porPagina
      );
    }, [
      productosFiltrados,
      paginaActual,
      porPagina,
    ]);

  function toggleProducto(
    id: string
  ) {
    setSeleccionados(
      (current) => {
        const next =
          new Set(current);

        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }

        return next;
      }
    );
  }

  function togglePagina() {
    const ids =
      productosPagina.map(
        (item) => item.id
      );

    const todos =
      ids.every((id) =>
        seleccionados.has(id)
      );

    setSeleccionados(
      (current) => {
        const next =
          new Set(current);

        ids.forEach((id) => {
          if (todos) {
            next.delete(id);
          } else {
            next.add(id);
          }
        });

        return next;
      }
    );
  }

  function limpiarSeleccion() {
    setSeleccionados(
      new Set()
    );
  }

  function eliminarSeleccionados() {
    if (
      seleccionados.size === 0
    ) {
      return;
    }

    setProductos((current) =>
      current.filter(
        (item) =>
          !seleccionados.has(
            item.id
          )
      )
    );

    limpiarSeleccion();
  }

  return {
    productos,

    filters,
    actualizarFiltro,
    limpiarFiltros,

    productosFiltrados,
    productosPagina,

    seleccionados,

    toggleProducto,
    togglePagina,

    limpiarSeleccion,

    eliminarSeleccionados,

    pagina: paginaActual,
    setPagina,

    porPagina,
    setPorPagina,

    totalPaginas,
  };
}

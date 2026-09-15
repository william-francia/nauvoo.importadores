import {
  useMemo,
  useState,
} from "react";

import type {
  GestionVenta,
  GestionVentasFilters,
} from "../types/gestionVentas.types";

const FILTROS_INICIALES: GestionVentasFilters = {
  numeroFactura: "",
  razonSocial: "",
  numeroDocumento: "",
  usuario: "",
};

function normalizarTexto(value: string) {
  return value
    .trim()
    .toLocaleLowerCase("es");
}

export function useGestionVentas(
  ventas: GestionVenta[]
) {
  const [filters, setFilters] =
    useState<GestionVentasFilters>(
      FILTROS_INICIALES
    );

  const [pagina, setPagina] =
    useState(1);

  const [porPagina, setPorPagina] =
    useState(10);

  function actualizarFiltro<
    K extends keyof GestionVentasFilters
  >(
    campo: K,
    valor: GestionVentasFilters[K]
  ) {
    setFilters((actual) => ({
      ...actual,
      [campo]: valor,
    }));

    setPagina(1);
  }

  function limpiarFiltros() {
    setFilters(FILTROS_INICIALES);

    setPagina(1);
  }

  const ventasFiltradas = useMemo(() => {
    const numeroFactura =
      normalizarTexto(
        filters.numeroFactura
      );

    const razonSocial =
      normalizarTexto(
        filters.razonSocial
      );

    const numeroDocumento =
      normalizarTexto(
        filters.numeroDocumento
      );

    const usuario =
      normalizarTexto(
        filters.usuario
      );

    return ventas.filter((venta) => {
      if (
        numeroFactura &&
        !normalizarTexto(
          venta.numeroFactura
        ).includes(numeroFactura)
      ) {
        return false;
      }

      if (
        razonSocial &&
        !normalizarTexto(
          venta.razonSocial
        ).includes(razonSocial)
      ) {
        return false;
      }

      if (
        numeroDocumento &&
        !normalizarTexto(
          venta.numeroDocumento
        ).includes(numeroDocumento)
      ) {
        return false;
      }

      if (
        usuario &&
        !normalizarTexto(
          venta.usuario
        ).includes(usuario)
      ) {
        return false;
      }

      return true;
    });
  }, [ventas, filters]);

  const totalPaginas = Math.max(
    1,
    Math.ceil(
      ventasFiltradas.length /
        porPagina
    )
  );

  const paginaActual = Math.min(
    pagina,
    totalPaginas
  );

  const ventasPagina = useMemo(() => {
    const inicio =
      (paginaActual - 1) *
      porPagina;

    return ventasFiltradas.slice(
      inicio,
      inicio + porPagina
    );
  }, [
    ventasFiltradas,
    paginaActual,
    porPagina,
  ]);

  const desde =
    ventasFiltradas.length === 0
      ? 0
      : (paginaActual - 1) *
          porPagina +
        1;

  const hasta = Math.min(
    paginaActual * porPagina,
    ventasFiltradas.length
  );

  return {
    filters,

    actualizarFiltro,

    limpiarFiltros,

    ventasFiltradas,

    ventasPagina,

    pagina: paginaActual,

    setPagina,

    porPagina,

    setPorPagina,

    totalPaginas,

    desde,

    hasta,
  };
}
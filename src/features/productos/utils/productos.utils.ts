// src/features/productos/utils/productos.utils.ts

import {
  LOCALES,
  STOCK_ALTO_MINIMO,
} from "../constants/productos.constants";

import type {
  EstadoStock,
  Producto,
  StockPorLocal,
} from "../types/productos.types";

export function calcularInventarioTotal(
  stock: StockPorLocal
): number {
  return LOCALES.reduce(
    (total, local) =>
      total + Number(stock[local.id] ?? 0),
    0
  );
}

export function obtenerEstadoStock(
  total: number
): EstadoStock {
  if (total <= 0) {
    return "SIN_STOCK";
  }

  if (total < STOCK_ALTO_MINIMO) {
    return "BAJO";
  }

  return "ALTO";
}

export function obtenerEstadoStockProducto(
  producto: Producto
): EstadoStock {
  return obtenerEstadoStock(
    calcularInventarioTotal(
      producto.stockPorLocal
    )
  );
}

export function obtenerTextoEstado(
  estado: EstadoStock
) {
  switch (estado) {
    case "ALTO":
      return "DISPONIBLE";

    case "BAJO":
      return "STOCK BAJO";

    case "SIN_STOCK":
      return "SIN STOCK";
  }
}

export function normalizarBusqueda(
  value: string
) {
  return value
    .trim()
    .toLocaleLowerCase("es");
}
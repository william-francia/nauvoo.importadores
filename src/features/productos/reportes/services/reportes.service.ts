import {
  exportarEstadoResultadosExcel,
  exportarFlujoCajaExcel,
  exportarKardexExcel,
  exportarVentasExcel,
} from "./reportes.excel";

import {
  exportarEstadoResultadosPdf,
  exportarFlujoCajaPdf,
  exportarKardexPdf,
  exportarVentasPdf,
} from "./reportes.pdf";

import {
  validarReporte,
} from "./reportes.validation";

import type {
  PeriodoReporte,
  ReporteDescargaResult,
  ReporteFormato,
  ReporteTipo,
  ReportesSnapshot,
} from "../types/reportes.types";

export async function descargarReporte({
  tipo,
  formato,
  periodo,
  snapshot,
}: {
  tipo: ReporteTipo;

  formato: ReporteFormato;

  periodo: PeriodoReporte;

  snapshot: ReportesSnapshot;
}): Promise<ReporteDescargaResult> {
  const issues =
    validarReporte(
      tipo,
      snapshot,
      periodo
    );

  if (
    issues.length > 0
  ) {
    return {
      ok: false,
      issues,
    };
  }

  if (
    formato === "EXCEL"
  ) {
    switch (tipo) {
      case "ESTADO_RESULTADOS":
        await exportarEstadoResultadosExcel(
          snapshot,
          periodo
        );
        break;

      case "VENTAS_FACTURACION":
        await exportarVentasExcel(
          snapshot,
          periodo
        );
        break;

      case "FLUJO_CAJA":
        await exportarFlujoCajaExcel(
          snapshot,
          periodo
        );
        break;

      case "VENTAS_PRODUCTO":
        await exportarKardexExcel(
          snapshot,
          periodo
        );
        break;
    }

    return {
      ok: true,
    };
  }

  switch (tipo) {
    case "ESTADO_RESULTADOS":
      exportarEstadoResultadosPdf(
        snapshot,
        periodo
      );
      break;

    case "VENTAS_FACTURACION":
      exportarVentasPdf(
        snapshot,
        periodo
      );
      break;

    case "FLUJO_CAJA":
      exportarFlujoCajaPdf(
        snapshot,
        periodo
      );
      break;

    case "VENTAS_PRODUCTO":
      exportarKardexPdf(
        snapshot,
        periodo
      );
      break;
  }

  return {
    ok: true,
  };
}
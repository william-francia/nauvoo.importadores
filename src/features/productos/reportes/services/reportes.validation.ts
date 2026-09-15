import {
  filtrarSnapshotPeriodo,
} from "./reportes.calculations";

import type {
  PeriodoReporte,
  ReporteIssue,
  ReporteTipo,
  ReportesSnapshot,
} from "../types/reportes.types";

export function validarReporte(
  tipo: ReporteTipo,

  snapshot: ReportesSnapshot,

  periodo: PeriodoReporte
): ReporteIssue[] {
  const issues: ReporteIssue[] =
    [];

  const data =
    filtrarSnapshotPeriodo(
      snapshot,
      periodo
    );

  if (
    !snapshot.empresa.razonSocial
  ) {
    issues.push({
      id: "empresa-razon",

      tipo: "MANUAL",

      titulo:
        "Falta la razón social",

      descripcion:
        "La empresa necesita razón social para generar reportes auditables.",
    });
  }

  if (!snapshot.empresa.nit) {
    issues.push({
      id: "empresa-nit",

      tipo: "MANUAL",

      titulo: "Falta el NIT",

      descripcion:
        "Debe configurarse el NIT de la empresa.",
    });
  }

  if (
    tipo ===
    "ESTADO_RESULTADOS"
  ) {
    const complementarios =
      snapshot.datosMensuales[
        periodo.mes
      ];

    const detalles =
      data.facturas.flatMap(
        (f) => f.detalles
      );

    if (
      detalles.some(
        (detalle) =>
          detalle.costoUnitarioInventario ==
          null
      )
    ) {
      issues.push({
        id: "costo-productos",

        tipo:
          "ORIGEN_DATOS",

        titulo:
          "Existen ventas sin costo de inventario",

        descripcion:
          "El Estado de Resultados necesita conocer el costo que tenía cada producto al momento de la venta.",
      });
    }

    if (
      data.facturas.some(
        (factura) =>
          factura.estado !==
            "ANULADA" &&
          factura.ivaDebitoFiscal ==
            null
      )
    ) {
      issues.push({
        id: "iva-debito",

        tipo:
          "ORIGEN_DATOS",

        titulo:
          "Hay facturas sin débito fiscal IVA",

        descripcion:
          "Completa o sincroniza la información fiscal antes de generar el reporte.",
      });
    }

    if (
      complementarios
        ?.ivaCreditoFiscal ==
      null
    ) {
      issues.push({
        id: "iva-credito",

        tipo: "MANUAL",

        titulo:
          "Falta IVA crédito fiscal",

        descripcion:
          "Ingresa el crédito fiscal correspondiente a compras del período.",
      });
    }

    if (
      complementarios
        ?.iueEstimado ==
      null
    ) {
      issues.push({
        id: "iue",

        tipo: "MANUAL",

        titulo:
          "Falta estimación de IUE",

        descripcion:
          "El sistema no calculará automáticamente el IUE definitivo. Ingresa una estimación revisada por contabilidad.",
      });
    }
  }

  if (
    tipo ===
    "VENTAS_FACTURACION"
  ) {
    if (
      data.facturas.length === 0
    ) {
      issues.push({
        id: "sin-ventas",

        tipo:
          "ORIGEN_DATOS",

        titulo:
          "No existen ventas en el período",

        descripcion:
          "No hay ventas registradas para el mes seleccionado.",
      });
    }

    const fiscalesIncompletas =
      data.facturas.filter(
        (factura) =>
          factura.estado ===
            "VALIDA" &&
          (!factura.cuf ||
            !factura.numeroFactura)
      );

    if (
      fiscalesIncompletas.length >
      0
    ) {
      issues.push({
        id: "fiscal-incompleto",

        tipo:
          "ORIGEN_DATOS",

        titulo:
          "Existen facturas con información fiscal incompleta",

        descripcion:
          `${fiscalesIncompletas.length} factura(s) no tienen todos los datos fiscales requeridos.`,
      });
    }
  }

  if (
    tipo === "FLUJO_CAJA"
  ) {
    const complementarios =
      snapshot.datosMensuales[
        periodo.mes
      ];

    if (
      complementarios
        ?.saldoInicialCaja ==
      null
    ) {
      issues.push({
        id: "saldo-caja",

        tipo: "MANUAL",

        titulo:
          "Falta saldo inicial de caja",

        descripcion:
          "Ingresa el efectivo existente al inicio del período.",
      });
    }

    if (
      complementarios
        ?.saldoInicialBancos ==
      null
    ) {
      issues.push({
        id: "saldo-banco",

        tipo: "MANUAL",

        titulo:
          "Falta saldo inicial de bancos",

        descripcion:
          "Ingresa el saldo bancario al inicio del período.",
      });
    }
  }

  if (
    tipo === "VENTAS_PRODUCTO"
  ) {
    if (
      data.movimientosInventario
        .length === 0
    ) {
      issues.push({
        id: "sin-kardex",

        tipo:
          "ORIGEN_DATOS",

        titulo:
          "No hay movimientos de inventario",

        descripcion:
          "No existen movimientos para generar el Kárdex de este período.",
      });
    }

    const entradasSinCosto =
      data.movimientosInventario.filter(
        (movimiento) =>
          movimiento.ingresoCantidad >
            0 &&
          (!movimiento.costoUnitario ||
            movimiento.costoUnitario <=
              0)
      );

    if (
      entradasSinCosto.length >
      0
    ) {
      issues.push({
        id: "entradas-sin-costo",

        tipo:
          "ORIGEN_DATOS",

        titulo:
          "Hay ingresos sin precio unitario",

        descripcion:
          `${entradasSinCosto.length} movimiento(s) de ingreso no tienen costo unitario. El saldo monetario del Kárdex sería incorrecto.`,
      });
    }

    const movimientosInvalidos =
      data.movimientosInventario.filter(
        (movimiento) =>
          movimiento.ingresoCantidad >
            0 &&
          movimiento.salidaCantidad >
            0
      );

    if (
      movimientosInvalidos.length >
      0
    ) {
      issues.push({
        id: "movimiento-doble",

        tipo:
          "ORIGEN_DATOS",

        titulo:
          "Hay movimientos con ingreso y salida simultáneos",

        descripcion:
          "Un movimiento de Kárdex no debe tener ingreso y salida al mismo tiempo.",
      });
    }
  }

  return issues;
}
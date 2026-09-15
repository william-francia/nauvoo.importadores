import {
  REPORTES_CONFIG,
} from "../constants/reportes.constants";

import type {
  FacturaReporte,
  MovimientoInventarioReporte,
  PeriodoReporte,
  ReportesSnapshot,
} from "../types/reportes.types";

/* ======================================================
   HELPERS
====================================================== */

export function money(
  value: number
) {
  return `${REPORTES_CONFIG.simboloMoneda} ${new Intl.NumberFormat(
    "es-BO",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  ).format(value)}`;
}

export function periodoToRange(
  periodo: PeriodoReporte
) {
  const [year, month] =
    periodo.mes
      .split("-")
      .map(Number);

  const inicio = new Date(
    year,
    month - 1,
    1,
    0,
    0,
    0
  );

  const fin = new Date(
    year,
    month,
    0,
    23,
    59,
    59,
    999
  );

  return {
    inicio,
    fin,
  };
}

export function fechaEnPeriodo(
  fecha: string,
  periodo: PeriodoReporte
) {
  const { inicio, fin } =
    periodoToRange(periodo);

  const date = new Date(fecha);

  return (
    date >= inicio &&
    date <= fin
  );
}

export function porcentaje(
  value: number,
  base: number
) {
  if (!base) {
    return 0;
  }

  return (
    (value / base) *
    100
  );
}

/* ======================================================
   SNAPSHOT DEL MES
====================================================== */

export function filtrarSnapshotPeriodo(
  snapshot: ReportesSnapshot,
  periodo: PeriodoReporte
): ReportesSnapshot {
  return {
    ...snapshot,

    facturas:
      snapshot.facturas.filter(
        (item) =>
          fechaEnPeriodo(
            item.fecha,
            periodo
          )
      ),

    gastos:
      snapshot.gastos.filter(
        (item) =>
          fechaEnPeriodo(
            item.fecha,
            periodo
          )
      ),

    movimientosCaja:
      snapshot.movimientosCaja.filter(
        (item) =>
          fechaEnPeriodo(
            item.fecha,
            periodo
          )
      ),

    movimientosInventario:
      snapshot.movimientosInventario.filter(
        (item) =>
          fechaEnPeriodo(
            item.fecha,
            periodo
          )
      ),
  };
}

/* ======================================================
   ESTADO DE RESULTADOS
====================================================== */

function facturaAfectaResultados(
  factura: FacturaReporte
) {
  return (
    factura.estado !==
    "ANULADA"
  );
}

export function calcularEstadoResultados(
  snapshot: ReportesSnapshot,
  periodo: PeriodoReporte
) {
  const data =
    filtrarSnapshotPeriodo(
      snapshot,
      periodo
    );

  const complementarios =
    snapshot.datosMensuales[
      periodo.mes
    ];

  const facturasValidas =
    data.facturas.filter(
      facturaAfectaResultados
    );

  const ventasFacturadas =
    facturasValidas.reduce(
      (sum, factura) =>
        sum +
        factura.totalFacturado,
      0
    );

  const descuentos =
    facturasValidas.reduce(
      (sum, factura) =>
        sum +
        factura.descuentoTotal,
      0
    );

  const devoluciones =
    facturasValidas.reduce(
      (sum, factura) =>
        sum +
        factura.devolucionTotal,
      0
    );

  const notasCredito =
    facturasValidas.reduce(
      (sum, factura) =>
        sum +
        factura.notaCreditoTotal,
      0
    );

  const ivaDebitoFiscal =
    facturasValidas.reduce(
      (sum, factura) =>
        sum +
        Number(
          factura.ivaDebitoFiscal ??
            0
        ),
      0
    );

  /*
   * No dejamos que el IVA infle
   * las ventas contables.
   */
  const ventasNetas =
    ventasFacturadas -
    devoluciones -
    notasCredito -
    ivaDebitoFiscal;

  const costoVentas =
    facturasValidas.reduce(
      (sumFactura, factura) =>
        sumFactura +
        factura.detalles.reduce(
          (
            sumDetalle,
            detalle
          ) =>
            sumDetalle +
            detalle.cantidad *
              Number(
                detalle.costoUnitarioInventario ??
                  0
              ),
          0
        ),
      0
    );

  const gastosOperativosRegistrados =
    data.gastos
      .filter(
        (item) =>
          item.categoria !==
            "FINANCIERO" &&
          item.categoria !==
            "IMPUESTO"
      )
      .reduce(
        (sum, item) =>
          sum + item.monto,
        0
      );

  const gastosFinancierosRegistrados =
    data.gastos
      .filter(
        (item) =>
          item.categoria ===
          "FINANCIERO"
      )
      .reduce(
        (sum, item) =>
          sum + item.monto,
        0
      );

  const gastosOperativos =
    gastosOperativosRegistrados +
    Number(
      complementarios
        ?.gastosOperativosAdicionales ??
        0
    );

  const gastosFinancieros =
    gastosFinancierosRegistrados +
    Number(
      complementarios
        ?.gastosFinancierosAdicionales ??
        0
    );

  const otrosIngresos =
    Number(
      complementarios
        ?.otrosIngresos ??
        0
    );

  const otrosGastos =
    Number(
      complementarios
        ?.otrosGastos ??
        0
    );

  const utilidadBruta =
    ventasNetas -
    costoVentas;

  const utilidadOperativa =
    utilidadBruta -
    gastosOperativos +
    otrosIngresos -
    otrosGastos;

  /*
   * IT:
   * si contabilidad ya registró un importe,
   * usamos ese.
   *
   * Si no existe, generamos solamente una
   * estimación administrativa al 3%.
   */
  const itEstimado =
    complementarios
      ?.itDeclaradoOEstimado ??
    ventasFacturadas *
      REPORTES_CONFIG.impuestos
        .itReferencia;

  const iueEstimado =
    complementarios
      ?.iueEstimado ??
    0;

  /*
   * IVA NO se vuelve a restar aquí.
   * Ya fue separado de ventas netas.
   */
  const gastosFinancierosEImpuestos =
    gastosFinancieros +
    itEstimado +
    iueEstimado;

  const utilidadNeta =
    utilidadOperativa -
    gastosFinancierosEImpuestos;

  return {
    ventasFacturadas,

    descuentos,

    devoluciones,

    notasCredito,

    ivaDebitoFiscal,

    ivaCreditoFiscal:
      complementarios
        ?.ivaCreditoFiscal ??
      null,

    ventasNetas,

    costoVentas,

    utilidadBruta,

    gastosOperativos,

    otrosIngresos,

    otrosGastos,

    utilidadOperativa,

    gastosFinancieros,

    itEstimado,

    iueEstimado,

    utilidadNeta,

    margenBruto:
      porcentaje(
        utilidadBruta,
        ventasNetas
      ),

    gastosSobreVentas:
      porcentaje(
        gastosOperativos,
        ventasNetas
      ),

    margenNeto:
      porcentaje(
        utilidadNeta,
        ventasNetas
      ),
  };
}

/* ======================================================
   VENTAS Y FACTURACIÓN
====================================================== */

export function calcularVentasFacturacion(
  snapshot: ReportesSnapshot,
  periodo: PeriodoReporte
) {
  const data =
    filtrarSnapshotPeriodo(
      snapshot,
      periodo
    );

  const totalFacturado =
    data.facturas
      .filter(
        (f) =>
          f.estado !==
          "ANULADA"
      )
      .reduce(
        (sum, f) =>
          sum +
          f.totalFacturado,
        0
      );

  const ivaDebitoFiscal =
    data.facturas
      .filter(
        (f) =>
          f.estado !==
          "ANULADA"
      )
      .reduce(
        (sum, f) =>
          sum +
          Number(
            f.ivaDebitoFiscal ??
              0
          ),
        0
      );

  const totalAnulado =
    data.facturas
      .filter(
        (f) =>
          f.estado ===
          "ANULADA"
      )
      .reduce(
        (sum, f) =>
          sum +
          f.totalFacturado,
        0
      );

  const porMetodoPago =
    new Map<
      string,
      number
    >();

  const porProducto =
    new Map<
      string,
      {
        codigo: string;
        nombre: string;
        cantidad: number;
        monto: number;
      }
    >();

  for (const factura of data.facturas) {
    if (
      factura.estado ===
      "ANULADA"
    ) {
      continue;
    }

    porMetodoPago.set(
      factura.metodoPago,

      (porMetodoPago.get(
        factura.metodoPago
      ) ?? 0) +
        factura.totalFacturado
    );

    for (const detalle of factura.detalles) {
      const actual =
        porProducto.get(
          detalle.productoId
        );

      porProducto.set(
        detalle.productoId,
        {
          codigo:
            detalle.codigoProducto,

          nombre:
            detalle.nombreProducto,

          cantidad:
            (actual?.cantidad ??
              0) +
            detalle.cantidad,

          monto:
            (actual?.monto ??
              0) +
            detalle.total,
        }
      );
    }
  }

  const rankingProductos = [
    ...porProducto.values(),
  ].sort(
    (a, b) =>
      b.cantidad -
      a.cantidad
  );

  return {
    facturas:
      data.facturas,

    totalFacturado,

    ivaDebitoFiscal,

    totalAnulado,

    porMetodoPago: [
      ...porMetodoPago.entries(),
    ].map(
      ([metodo, monto]) => ({
        metodo,
        monto,
      })
    ),

    rankingProductos,
  };
}

/* ======================================================
   FLUJO DE CAJA
====================================================== */

export function calcularFlujoCaja(
  snapshot: ReportesSnapshot,
  periodo: PeriodoReporte
) {
  const data =
    filtrarSnapshotPeriodo(
      snapshot,
      periodo
    );

  const complementarios =
    snapshot.datosMensuales[
      periodo.mes
    ];

  const saldoInicialCaja =
    Number(
      complementarios
        ?.saldoInicialCaja ??
        0
    );

  const saldoInicialBancos =
    Number(
      complementarios
        ?.saldoInicialBancos ??
        0
    );

  const ingresosCaja =
    data.movimientosCaja
      .filter(
        (item) =>
          item.tipo ===
            "INGRESO" &&
          item.cuenta ===
            "CAJA_FISICA"
      )
      .reduce(
        (sum, item) =>
          sum + item.monto,
        0
      );

  const egresosCaja =
    data.movimientosCaja
      .filter(
        (item) =>
          item.tipo ===
            "EGRESO" &&
          item.cuenta ===
            "CAJA_FISICA"
      )
      .reduce(
        (sum, item) =>
          sum + item.monto,
        0
      );

  const ingresosBanco =
    data.movimientosCaja
      .filter(
        (item) =>
          item.tipo ===
            "INGRESO" &&
          item.cuenta ===
            "BANCO"
      )
      .reduce(
        (sum, item) =>
          sum + item.monto,
        0
      );

  const egresosBanco =
    data.movimientosCaja
      .filter(
        (item) =>
          item.tipo ===
            "EGRESO" &&
          item.cuenta ===
            "BANCO"
      )
      .reduce(
        (sum, item) =>
          sum + item.monto,
        0
      );

  const saldoFinalCaja =
    saldoInicialCaja +
    ingresosCaja -
    egresosCaja;

  const saldoFinalBanco =
    saldoInicialBancos +
    ingresosBanco -
    egresosBanco;

  return {
    movimientos:
      data.movimientosCaja,

    saldoInicialCaja,

    saldoInicialBancos,

    ingresosCaja,

    egresosCaja,

    ingresosBanco,

    egresosBanco,

    saldoFinalCaja,

    saldoFinalBanco,

    saldoInicialTotal:
      saldoInicialCaja +
      saldoInicialBancos,

    ingresosTotales:
      ingresosCaja +
      ingresosBanco,

    egresosTotales:
      egresosCaja +
      egresosBanco,

    saldoFinalTotal:
      saldoFinalCaja +
      saldoFinalBanco,
  };
}

/* ======================================================
   KÁRDEX / VENTAS POR PRODUCTO
====================================================== */

export interface KardexFilaCalculada {
  movimiento:
    MovimientoInventarioReporte;

  ingresoCantidad: number;

  salidaCantidad: number;

  saldoCantidad: number;

  precioUnitario: number;

  ingresoValor: number;

  egresoValor: number;

  saldoValor: number;
}

export interface KardexProductoCalculado {
  productoId: string;

  codigo: string;

  nombre: string;

  descripcion?: string;

  diametro?: string;

  largo?: string;

  filas: KardexFilaCalculada[];

  saldoCantidad: number;

  saldoValor: number;
}

export function calcularKardexProductos(
  snapshot: ReportesSnapshot,
  periodo: PeriodoReporte
): KardexProductoCalculado[] {
  const data =
    filtrarSnapshotPeriodo(
      snapshot,
      periodo
    );

  const porProducto =
    new Map<
      string,
      MovimientoInventarioReporte[]
    >();

  for (const movimiento of data.movimientosInventario) {
    const actual =
      porProducto.get(
        movimiento.productoId
      ) ?? [];

    actual.push(movimiento);

    porProducto.set(
      movimiento.productoId,
      actual
    );
  }

  return [
    ...porProducto.entries(),
  ].map(
    ([
      productoId,
      movimientos,
    ]) => {
      movimientos.sort(
        (a, b) =>
          new Date(
            a.fecha
          ).getTime() -
          new Date(
            b.fecha
          ).getTime()
      );

      let saldoCantidad = 0;
      let saldoValor = 0;
      let costoPromedio = 0;

      const filas =
        movimientos.map(
          (
            movimiento
          ): KardexFilaCalculada => {
            const ingreso =
              Number(
                movimiento.ingresoCantidad ??
                  0
              );

            const salida =
              Number(
                movimiento.salidaCantidad ??
                  0
              );

            /*
             * ENTRADA:
             * necesita costo unitario real.
             */
            let precioUnitario =
              Number(
                movimiento.costoUnitario ??
                  0
              );

            let ingresoValor = 0;
            let egresoValor = 0;

            if (
              ingreso > 0
            ) {
              ingresoValor =
                ingreso *
                precioUnitario;

              saldoCantidad +=
                ingreso;

              saldoValor +=
                ingresoValor;

              costoPromedio =
                saldoCantidad > 0
                  ? saldoValor /
                    saldoCantidad
                  : 0;
            }

            if (
              salida > 0
            ) {
              /*
               * Si la salida no trae costo,
               * utilizamos costo promedio
               * acumulado.
               */
              if (
                !precioUnitario
              ) {
                precioUnitario =
                  costoPromedio;
              }

              egresoValor =
                salida *
                precioUnitario;

              saldoCantidad -=
                salida;

              saldoValor -=
                egresoValor;

              if (
                saldoCantidad === 0
              ) {
                saldoValor = 0;
              }
            }

            return {
              movimiento,

              ingresoCantidad:
                ingreso,

              salidaCantidad:
                salida,

              saldoCantidad,

              precioUnitario,

              ingresoValor,

              egresoValor,

              saldoValor:
                Math.max(
                  saldoValor,
                  0
                ),
            };
          }
        );

      const primero =
        movimientos[0];

      return {
        productoId,

        codigo:
          primero.codigoProducto,

        nombre:
          primero.nombreProducto,

        descripcion:
          primero.descripcion,

        diametro:
          primero.diametro,

        largo:
          primero.largo,

        filas,

        saldoCantidad,

        saldoValor:
          Math.max(
            saldoValor,
            0
          ),
      };
    }
  );
}
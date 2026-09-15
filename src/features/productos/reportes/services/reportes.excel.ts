import ExcelJS from "exceljs";

import {
  saveAs,
} from "file-saver";

import {
  calcularEstadoResultados,
  calcularFlujoCaja,
  calcularKardexProductos,
  calcularVentasFacturacion,
} from "./reportes.calculations";

import type {
  PeriodoReporte,
  ReportesSnapshot,
} from "../types/reportes.types";

const BLUE = "0877D8";
const DARK = "17233E";
const GREEN = "21A647";

function aplicarTitulo(
  sheet: ExcelJS.Worksheet,

  titulo: string,

  periodo: PeriodoReporte,

  snapshot: ReportesSnapshot
) {
  sheet.mergeCells(
    "A1:H1"
  );

  const title =
    sheet.getCell("A1");

  title.value = titulo;

  title.font = {
    size: 18,
    bold: true,
    color: {
      argb: DARK,
    },
  };

  sheet.getCell("A2").value =
    "Empresa";

  sheet.getCell("B2").value =
    snapshot.empresa.razonSocial;

  sheet.getCell("A3").value =
    "NIT";

  sheet.getCell("B3").value =
    snapshot.empresa.nit;

  sheet.getCell("D2").value =
    "Período";

  sheet.getCell("E2").value =
    periodo.mes;

  sheet.getCell("D3").value =
    "Generado por";

  sheet.getCell("E3").value =
    snapshot.empresa.usuarioGenerador;

  sheet.getCell("G2").value =
    "Fecha generación";

  sheet.getCell("H2").value =
    new Date();

  sheet.getCell("H2").numFmt =
    "dd/mm/yyyy hh:mm";
}

function headerStyle(
  row: ExcelJS.Row
) {
  row.font = {
    bold: true,
    color: {
      argb: "FFFFFF",
    },
  };

  row.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: {
      argb: BLUE,
    },
  };

  row.alignment = {
    vertical: "middle",
  };
}

async function guardarWorkbook(
  workbook: ExcelJS.Workbook,
  filename: string
) {
  const buffer =
    await workbook.xlsx.writeBuffer();

  saveAs(
    new Blob([buffer], {
      type:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),

    filename
  );
}

/* =====================================================
   ESTADO RESULTADOS
===================================================== */

export async function exportarEstadoResultadosExcel(
  snapshot: ReportesSnapshot,
  periodo: PeriodoReporte
) {
  const calculo =
    calcularEstadoResultados(
      snapshot,
      periodo
    );

  const workbook =
    new ExcelJS.Workbook();

  workbook.creator =
    "ISI.INVOICE";

  const sheet =
    workbook.addWorksheet(
      "Estado de Resultados"
    );

  aplicarTitulo(
    sheet,
    "Estado de Resultados - Pérdidas y Ganancias",
    periodo,
    snapshot
  );

  sheet.columns = [
    {
      width: 38,
    },
    {
      width: 20,
    },
    {
      width: 18,
    },
  ];

  const header =
    sheet.getRow(5);

  header.values = [
    "Concepto",
    "Monto Bs.",
    "%",
  ];

  headerStyle(header);

  const rows = [
    [
      "Ventas netas",
      calculo.ventasNetas,
      100,
    ],

    [
      "- Costo de ventas",
      -calculo.costoVentas,
      0,
    ],

    [
      "= Utilidad bruta",
      calculo.utilidadBruta,
      calculo.margenBruto,
    ],

    [
      "- Gastos operativos",
      -calculo.gastosOperativos,
      calculo.gastosSobreVentas,
    ],

    [
      "= Utilidad operativa",
      calculo.utilidadOperativa,
      0,
    ],

    [
      "- Gastos financieros",
      -calculo.gastosFinancieros,
      0,
    ],

    [
      "- IT estimado",
      -calculo.itEstimado,
      0,
    ],

    [
      "- IUE estimado",
      -calculo.iueEstimado,
      0,
    ],

    [
      "= Utilidad neta",
      calculo.utilidadNeta,
      calculo.margenNeto,
    ],
  ];

  rows.forEach((row) => {
    sheet.addRow(row);
  });

  for (
    let row = 6;
    row <= 14;
    row++
  ) {
    sheet.getCell(
      row,
      2
    ).numFmt =
      '#,##0.00 "Bs."';

    sheet.getCell(
      row,
      3
    ).numFmt =
      "0.00%";

    const actual =
      Number(
        sheet.getCell(
          row,
          3
        ).value ?? 0
      );

    sheet.getCell(
      row,
      3
    ).value =
      actual / 100;
  }

  sheet.getRow(8).font = {
    bold: true,
  };

  sheet.getRow(10).font = {
    bold: true,
  };

  sheet.getRow(14).font = {
    bold: true,
    color: {
      argb:
        calculo.utilidadNeta >=
        0
          ? GREEN
          : "D63B47",
    },
  };

  sheet.addRow([]);

  const fiscal =
    sheet.addRow([
      "CONTROL TRIBUTARIO",
    ]);

  fiscal.font = {
    bold: true,
    color: {
      argb: BLUE,
    },
  };

  sheet.addRow([
    "IVA débito fiscal",
    calculo.ivaDebitoFiscal,
  ]);

  sheet.addRow([
    "IVA crédito fiscal",
    calculo.ivaCreditoFiscal ??
      0,
  ]);

  sheet.addRow([
    "IT estimado/declarado",
    calculo.itEstimado,
  ]);

  sheet.addRow([
    "IUE estimado",
    calculo.iueEstimado,
  ]);

  for (
    let row = 17;
    row <= 20;
    row++
  ) {
    sheet.getCell(
      row,
      2
    ).numFmt =
      '#,##0.00 "Bs."';
  }

  await guardarWorkbook(
    workbook,

    `estado-resultados-${periodo.mes}.xlsx`
  );
}

/* =====================================================
   VENTAS
===================================================== */

export async function exportarVentasExcel(
  snapshot: ReportesSnapshot,
  periodo: PeriodoReporte
) {
  const calculo =
    calcularVentasFacturacion(
      snapshot,
      periodo
    );

  const workbook =
    new ExcelJS.Workbook();

  const resumen =
    workbook.addWorksheet(
      "Resumen"
    );

  aplicarTitulo(
    resumen,
    "Reporte de Ventas y Facturación",
    periodo,
    snapshot
  );

  resumen.columns = [
    {
      width: 32,
    },
    {
      width: 22,
    },
  ];

  resumen.addRow([]);

  resumen.addRow([
    "Total facturado",
    calculo.totalFacturado,
  ]);

  resumen.addRow([
    "IVA débito fiscal",
    calculo.ivaDebitoFiscal,
  ]);

  resumen.addRow([
    "Facturación anulada",
    calculo.totalAnulado,
  ]);

  for (
    let row = 5;
    row <= 8;
    row++
  ) {
    resumen.getCell(
      row,
      2
    ).numFmt =
      '#,##0.00 "Bs."';
  }

  resumen.addRow([]);

  const paymentHeader =
    resumen.addRow([
      "Método de pago",
      "Monto",
    ]);

  headerStyle(
    paymentHeader
  );

  calculo.porMetodoPago.forEach(
    (item) => {
      const row =
        resumen.addRow([
          item.metodo,
          item.monto,
        ]);

      row.getCell(2).numFmt =
        '#,##0.00 "Bs."';
    }
  );

  const detalle =
    workbook.addWorksheet(
      "Facturas"
    );

  detalle.columns = [
    {
      header: "Factura",
      width: 13,
    },
    {
      header: "Fecha",
      width: 20,
    },
    {
      header: "Sucursal",
      width: 18,
    },
    {
      header: "Cliente",
      width: 28,
    },
    {
      header: "NIT/CI",
      width: 18,
    },
    {
      header: "Vendedor",
      width: 18,
    },
    {
      header: "Pago",
      width: 18,
    },
    {
      header: "Estado",
      width: 18,
    },
    {
      header: "Total",
      width: 18,
    },
    {
      header: "IVA",
      width: 18,
    },
    {
      header: "CUF",
      width: 42,
    },
  ];

  headerStyle(
    detalle.getRow(1)
  );

  calculo.facturas.forEach(
    (factura) => {
      detalle.addRow([
        factura.numeroFactura,

        new Date(
          factura.fecha
        ),

        factura.sucursal,

        factura.cliente,

        factura.nitCi,

        factura.vendedor,

        factura.metodoPago,

        factura.estado,

        factura.totalFacturado,

        factura.ivaDebitoFiscal ??
          0,

        factura.cuf ?? "",
      ]);
    }
  );

  detalle.getColumn(2).numFmt =
    "dd/mm/yyyy hh:mm";

  detalle.getColumn(9).numFmt =
    '#,##0.00 "Bs."';

  detalle.getColumn(10).numFmt =
    '#,##0.00 "Bs."';

  const productos =
    workbook.addWorksheet(
      "Productos vendidos"
    );

  productos.columns = [
    {
      header: "Código",
      width: 18,
    },
    {
      header: "Producto",
      width: 42,
    },
    {
      header: "Cantidad",
      width: 15,
    },
    {
      header: "Monto",
      width: 20,
    },
  ];

  headerStyle(
    productos.getRow(1)
  );

  calculo.rankingProductos.forEach(
    (item) => {
      productos.addRow([
        item.codigo,
        item.nombre,
        item.cantidad,
        item.monto,
      ]);
    }
  );

  productos.getColumn(4).numFmt =
    '#,##0.00 "Bs."';

  await guardarWorkbook(
    workbook,

    `ventas-facturacion-${periodo.mes}.xlsx`
  );
}

/* =====================================================
   CAJA
===================================================== */

export async function exportarFlujoCajaExcel(
  snapshot: ReportesSnapshot,
  periodo: PeriodoReporte
) {
  const calculo =
    calcularFlujoCaja(
      snapshot,
      periodo
    );

  const workbook =
    new ExcelJS.Workbook();

  const resumen =
    workbook.addWorksheet(
      "Resumen"
    );

  aplicarTitulo(
    resumen,
    "Flujo de Caja",
    periodo,
    snapshot
  );

  resumen.columns = [
    {
      width: 34,
    },
    {
      width: 20,
    },
  ];

  const rows = [
    [
      "Saldo inicial caja",
      calculo.saldoInicialCaja,
    ],

    [
      "Saldo inicial bancos",
      calculo.saldoInicialBancos,
    ],

    [
      "+ Cobros recibidos",
      calculo.ingresosTotales,
    ],

    [
      "- Pagos realizados",
      -calculo.egresosTotales,
    ],

    [
      "= Saldo final",
      calculo.saldoFinalTotal,
    ],
  ];

  rows.forEach(
    (row) => {
      const added =
        resumen.addRow(row);

      added.getCell(2).numFmt =
        '#,##0.00 "Bs."';
    }
  );

  const movimientos =
    workbook.addWorksheet(
      "Movimientos"
    );

  movimientos.columns = [
    {
      header: "Fecha",
      width: 18,
    },
    {
      header: "Tipo",
      width: 14,
    },
    {
      header: "Cuenta",
      width: 18,
    },
    {
      header: "Concepto",
      width: 40,
    },
    {
      header: "Método",
      width: 18,
    },
    {
      header: "Sucursal",
      width: 20,
    },
    {
      header: "Comprobante",
      width: 20,
    },
    {
      header: "Monto",
      width: 20,
    },
  ];

  headerStyle(
    movimientos.getRow(1)
  );

  calculo.movimientos.forEach(
    (item) => {
      movimientos.addRow([
        new Date(item.fecha),

        item.tipo,

        item.cuenta,

        item.concepto,

        item.metodoPago,

        item.sucursal ?? "",

        item.comprobante ?? "",

        item.monto,
      ]);
    }
  );

  movimientos.getColumn(1).numFmt =
    "dd/mm/yyyy";

  movimientos.getColumn(8).numFmt =
    '#,##0.00 "Bs."';

  await guardarWorkbook(
    workbook,

    `flujo-caja-${periodo.mes}.xlsx`
  );
}

/* =====================================================
   KARDEX
===================================================== */

export async function exportarKardexExcel(
  snapshot: ReportesSnapshot,
  periodo: PeriodoReporte
) {
  const productos =
    calcularKardexProductos(
      snapshot,
      periodo
    );

  const workbook =
    new ExcelJS.Workbook();

  const sheet =
    workbook.addWorksheet(
      "Kardex"
    );

  aplicarTitulo(
    sheet,
    "Kárdex de Inventario",
    periodo,
    snapshot
  );

  sheet.columns = [
    {
      width: 14,
    },
    {
      width: 28,
    },
    {
      width: 14,
    },
    {
      width: 14,
    },
    {
      width: 14,
    },
    {
      width: 14,
    },
    {
      width: 14,
    },
    {
      width: 16,
    },
    {
      width: 16,
    },
    {
      width: 16,
    },
  ];

  let rowIndex = 5;

  for (
    const producto of productos
  ) {
    sheet.mergeCells(
      rowIndex,
      1,
      rowIndex,
      10
    );

    const title =
      sheet.getCell(
        rowIndex,
        1
      );

    title.value =
      `${producto.codigo} - ${producto.nombre}`;

    title.font = {
      bold: true,
      size: 14,
      color: {
        argb: DARK,
      },
    };

    rowIndex++;

    sheet.getCell(
      rowIndex,
      1
    ).value =
      "Descripción";

    sheet.getCell(
      rowIndex,
      2
    ).value =
      producto.descripcion ??
      "";

    sheet.getCell(
      rowIndex,
      7
    ).value =
      "Existencia";

    sheet.getCell(
      rowIndex,
      8
    ).value =
      producto.saldoCantidad;

    rowIndex += 2;

    const header =
      sheet.getRow(
        rowIndex
      );

    header.values = [
      "Fecha",
      "Nota / Lugar",
      "Factura / Recibo",
      "Ingreso",
      "Salida",
      "Saldo",
      "Precio/U",
      "Ingreso Bs.",
      "Egreso Bs.",
      "Saldo Bs.",
    ];

    headerStyle(header);

    rowIndex++;

    producto.filas.forEach(
      (fila) => {
        const row =
          sheet.getRow(
            rowIndex
          );

        row.values = [
          new Date(
            fila.movimiento
              .fecha
          ),

          fila.movimiento
            .referencia ??
            fila.movimiento
              .ubicacion ??
            "",

          fila.movimiento
            .factura ??
            fila.movimiento
              .recibo ??
            "",

          fila.ingresoCantidad ||
            "",

          fila.salidaCantidad ||
            "",

          fila.saldoCantidad,

          fila.precioUnitario,

          fila.ingresoValor,

          fila.egresoValor,

          fila.saldoValor,
        ];

        row.getCell(1).numFmt =
          "dd/mm/yyyy";

        for (
          let col = 7;
          col <= 10;
          col++
        ) {
          row.getCell(
            col
          ).numFmt =
            '#,##0.0000 "Bs."';
        }

        rowIndex++;
      }
    );

    rowIndex += 3;
  }

  await guardarWorkbook(
    workbook,

    `kardex-productos-${periodo.mes}.xlsx`
  );
}

import {
  jsPDF,
} from "jspdf";

import {
  autoTable,
} from "jspdf-autotable";

import {
  calcularEstadoResultados,
  calcularFlujoCaja,
  calcularKardexProductos,
  calcularVentasFacturacion,
  money,
} from "./reportes.calculations";

import type {
  PeriodoReporte,
  ReportesSnapshot,
} from "../types/reportes.types";

function autoTableFinalY(
  doc: jsPDF
) {
  return (
    doc as unknown as {
      lastAutoTable: {
        finalY: number;
      };
    }
  ).lastAutoTable.finalY;
}

function encabezado(
  doc: jsPDF,

  titulo: string,

  snapshot: ReportesSnapshot,

  periodo: PeriodoReporte
) {
  doc.setFont(
    "helvetica",
    "bold"
  );

  doc.setFontSize(16);

  doc.text(
    titulo,
    14,
    16
  );

  doc.setFont(
    "helvetica",
    "normal"
  );

  doc.setFontSize(8);

  doc.text(
    `${snapshot.empresa.razonSocial} · NIT ${snapshot.empresa.nit}`,
    14,
    22
  );

  doc.text(
    `Período: ${periodo.mes}`,
    14,
    27
  );

  doc.text(
    `Generado: ${new Date().toLocaleString(
      "es-BO"
    )}`,
    14,
    32
  );

  doc.text(
    `Usuario: ${snapshot.empresa.usuarioGenerador}`,
    14,
    37
  );
}

export function exportarEstadoResultadosPdf(
  snapshot: ReportesSnapshot,
  periodo: PeriodoReporte
) {
  const data =
    calcularEstadoResultados(
      snapshot,
      periodo
    );

  const doc =
    new jsPDF();

  encabezado(
    doc,
    "Estado de Resultados",
    snapshot,
    periodo
  );

  autoTable(doc, {
    startY: 44,

    head: [
      [
        "Concepto",
        "Monto",
      ],
    ],

    body: [
      [
        "Ventas netas",
        money(
          data.ventasNetas
        ),
      ],

      [
        "- Costo de ventas",
        money(
          data.costoVentas
        ),
      ],

      [
        "= Utilidad bruta",
        money(
          data.utilidadBruta
        ),
      ],

      [
        "- Gastos operativos",
        money(
          data.gastosOperativos
        ),
      ],

      [
        "= Utilidad operativa",
        money(
          data.utilidadOperativa
        ),
      ],

      [
        "- Gastos financieros",
        money(
          data.gastosFinancieros
        ),
      ],

      [
        "- IT estimado",
        money(
          data.itEstimado
        ),
      ],

      [
        "- IUE estimado",
        money(
          data.iueEstimado
        ),
      ],

      [
        "= UTILIDAD NETA",
        money(
          data.utilidadNeta
        ),
      ],
    ],

    styles: {
      fontSize: 9,
    },

    headStyles: {
      fillColor: [
        8,
        119,
        216,
      ],
    },
  });

  const y =
    autoTableFinalY(doc) + 10;

  doc.setFontSize(9);

  doc.text(
    `Margen bruto: ${data.margenBruto.toFixed(
      2
    )}%`,
    14,
    y
  );

  doc.text(
    `Gastos sobre ventas: ${data.gastosSobreVentas.toFixed(
      2
    )}%`,
    14,
    y + 6
  );

  doc.text(
    `Margen neto: ${data.margenNeto.toFixed(
      2
    )}%`,
    14,
    y + 12
  );

  doc.text(
    `IVA débito fiscal: ${money(
      data.ivaDebitoFiscal
    )}`,
    110,
    y
  );

  doc.text(
    `IVA crédito fiscal: ${money(
      data.ivaCreditoFiscal ??
        0
    )}`,
    110,
    y + 6
  );

  doc.text(
    `IT estimado/declarado: ${money(
      data.itEstimado
    )}`,
    110,
    y + 12
  );

  doc.text(
    `IUE estimado: ${money(
      data.iueEstimado
    )}`,
    110,
    y + 18
  );

  doc.save(
    `estado-resultados-${periodo.mes}.pdf`
  );
}

export function exportarVentasPdf(
  snapshot: ReportesSnapshot,
  periodo: PeriodoReporte
) {
  const data =
    calcularVentasFacturacion(
      snapshot,
      periodo
    );

  const doc =
    new jsPDF({
      orientation:
        "landscape",
    });

  encabezado(
    doc,
    "Reporte de Ventas y Facturación",
    snapshot,
    periodo
  );

  doc.setFontSize(9);

  doc.text(
    `Total facturado: ${money(
      data.totalFacturado
    )}`,
    14,
    45
  );

  doc.text(
    `IVA débito fiscal: ${money(
      data.ivaDebitoFiscal
    )}`,
    100,
    45
  );

  doc.text(
    `Anulado: ${money(
      data.totalAnulado
    )}`,
    190,
    45
  );

  autoTable(doc, {
    startY: 52,

    head: [
      [
        "Factura",
        "Fecha",
        "Cliente",
        "NIT/CI",
        "Sucursal",
        "Vendedor",
        "Pago",
        "Estado",
        "Total",
        "IVA",
        "CUF",
      ],
    ],

    body:
      data.facturas.map(
        (factura) => [
          factura.numeroFactura,

          new Date(
            factura.fecha
          ).toLocaleString(
            "es-BO"
          ),

          factura.cliente,

          factura.nitCi,

          factura.sucursal,

          factura.vendedor,

          factura.metodoPago,

          factura.estado,

          money(
            factura.totalFacturado
          ),

          money(
            factura.ivaDebitoFiscal ??
              0
          ),

          factura.cuf ?? "",
        ]
      ),

    styles: {
      fontSize: 7,
    },

    headStyles: {
      fillColor: [
        8,
        119,
        216,
      ],
    },
  });

  const facturasFinalY =
    autoTableFinalY(doc);

  autoTable(doc, {
    startY: facturasFinalY + 10,

    head: [
      [
        "Ventas por método de pago",
        "Monto",
      ],
    ],

    body: data.porMetodoPago.map(
      (item) => [
        item.metodo,
        money(item.monto),
      ]
    ),

    styles: {
      fontSize: 7,
    },

    headStyles: {
      fillColor: [
        8,
        119,
        216,
      ],
    },
  });

  const pagosFinalY =
    autoTableFinalY(doc);

  autoTable(doc, {
    startY: pagosFinalY + 10,

    head: [
      [
        "Ranking de productos",
        "Cantidad",
        "Monto",
      ],
    ],

    body: data.rankingProductos.map(
      (item) => [
        `${item.codigo} - ${item.nombre}`,
        item.cantidad,
        money(item.monto),
      ]
    ),

    styles: {
      fontSize: 7,
    },

    headStyles: {
      fillColor: [
        8,
        119,
        216,
      ],
    },
  });

  doc.save(
    `ventas-facturacion-${periodo.mes}.pdf`
  );
}

export function exportarFlujoCajaPdf(
  snapshot: ReportesSnapshot,
  periodo: PeriodoReporte
) {
  const data =
    calcularFlujoCaja(
      snapshot,
      periodo
    );

  const doc =
    new jsPDF({
      orientation:
        "landscape",
    });

  encabezado(
    doc,
    "Flujo de Caja",
    snapshot,
    periodo
  );

  autoTable(doc, {
    startY: 44,

    head: [
      [
        "Concepto",
        "Monto",
      ],
    ],

    body: [
      [
        "Saldo inicial caja y bancos",
        money(
          data.saldoInicialTotal
        ),
      ],

      [
        "+ Cobros recibidos",
        money(
          data.ingresosTotales
        ),
      ],

      [
        "- Pagos realizados",
        money(
          data.egresosTotales
        ),
      ],

      [
        "= Saldo final",
        money(
          data.saldoFinalTotal
        ),
      ],
    ],
  });

  const start =
    autoTableFinalY(doc) + 10;

  autoTable(doc, {
    startY: start,

    head: [
      [
        "Fecha",
        "Tipo",
        "Cuenta",
        "Concepto",
        "Método",
        "Sucursal",
        "Monto",
      ],
    ],

    body:
      data.movimientos.map(
        (item) => [
          new Date(
            item.fecha
          ).toLocaleDateString(
            "es-BO"
          ),

          item.tipo,

          item.cuenta,

          item.concepto,

          item.metodoPago,

          item.sucursal ?? "",

          money(
            item.monto
          ),
        ]
      ),

    styles: {
      fontSize: 7,
    },

    headStyles: {
      fillColor: [
        8,
        119,
        216,
      ],
    },
  });

  doc.save(
    `flujo-caja-${periodo.mes}.pdf`
  );
}

export function exportarKardexPdf(
  snapshot: ReportesSnapshot,
  periodo: PeriodoReporte
) {
  const productos =
    calcularKardexProductos(
      snapshot,
      periodo
    );

  const doc =
    new jsPDF({
      orientation:
        "landscape",

      format: "a4",
    });

  productos.forEach(
    (
      producto,
      index
    ) => {
      if (index > 0) {
        doc.addPage();
      }

      encabezado(
        doc,
        "Kárdex de Inventario",
        snapshot,
        periodo
      );

      doc.setFontSize(10);

      doc.setFont(
        "helvetica",
        "bold"
      );

      doc.text(
        `Código: ${producto.codigo}`,
        14,
        47
      );

      doc.text(
        `Producto: ${producto.nombre}`,
        14,
        53
      );

      doc.setFont(
        "helvetica",
        "normal"
      );

      doc.text(
        `Descripción: ${producto.descripcion ?? "-"}`,
        14,
        59
      );

      doc.text(
        `Existencia: ${producto.saldoCantidad}`,
        220,
        47
      );

      doc.text(
        `Valor: ${money(
          producto.saldoValor
        )}`,
        220,
        53
      );

      autoTable(doc, {
        startY: 66,

        head: [
          [
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
          ],
        ],

        body:
          producto.filas.map(
            (fila) => [
              new Date(
                fila.movimiento
                  .fecha
              ).toLocaleDateString(
                "es-BO"
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

              fila.precioUnitario.toFixed(
                4
              ),

              fila.ingresoValor.toFixed(
                2
              ),

              fila.egresoValor.toFixed(
                2
              ),

              fila.saldoValor.toFixed(
                2
              ),
            ]
          ),

        styles: {
          fontSize: 6.8,
          cellPadding: 2,
        },

        headStyles: {
          fillColor: [
            8,
            119,
            216,
          ],
        },
      });
    }
  );

  doc.save(
    `kardex-productos-${periodo.mes}.pdf`
  );
}

export const REPORTES_CONFIG = {
  moneda: "BOB",

  simboloMoneda: "Bs.",

  pais: "Bolivia",

  ciudad: "La Paz",

  impuestos: {
    /**
     * Se usa solamente cuando hacemos una
     * ESTIMACIÓN y no existe un importe fiscal
     * almacenado.
     */
    ivaReferencia: 0.13,

    itReferencia: 0.03,
  },
} as const;

export const REPORTES_META = {
  ESTADO_RESULTADOS: {
    titulo: "Estado de Resultados",

    subtitulo:
      "Pérdidas y Ganancias",

    descripcion:
      "Conoce si la empresa está generando ganancias netas al final del período.",
  },

  VENTAS_FACTURACION: {
    titulo:
      "Reporte de Ventas y Facturación",

    subtitulo:
      "Ventas, facturas e impuestos",

    descripcion:
      "Revisa todo lo vendido, la facturación y los datos necesarios para control fiscal.",
  },

  FLUJO_CAJA: {
    titulo: "Flujo de Caja",

    subtitulo:
      "Efectivo Diario",

    descripcion:
      "Controla cuánto dinero realmente entra y sale de caja y bancos.",
  },

  VENTAS_PRODUCTO: {
    titulo: "Ventas por Producto",

    subtitulo:
      "Kárdex por producto",

    descripcion:
      "Analiza entradas, salidas, saldo físico y valor monetario del inventario.",
  },
} as const;
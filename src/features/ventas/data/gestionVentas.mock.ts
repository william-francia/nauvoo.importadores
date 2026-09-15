import type {
  GestionVenta,
} from "../types/gestionVentas.types";

export const GESTION_VENTAS_MOCK: GestionVenta[] = [
  {
    id: "venta-11443",

    numeroFactura: "11443",

    fechaEmision: "2026-09-08T12:31:33",

    razonSocial: "Roman",

    numeroDocumento: "4317635",

    monto: 41,

    moneda: "BOB",

    usuario: "ahuanca",

    estado: "VALIDADA",

    correoCliente: "roman@ejemplo.com",

    sin: {
      cuf:
        "4F12E17A86906E052342C03C368BEFACA352D121E16F078A50403BF74",

      fechaEmision:
        "08/09/2026 12:31:33",

      numeroFactura: "11443",

      codigoSucursal: 0,

      codigoPuntoVenta: 0,

      codigoDescripcion: "VALIDA",

      codigoEstado: 690,

      codigoRecepcion:
        "c21cb9de-aba2-11f1-891d-0f2f417a3458",

      log:
        "codigoDescripcion: VALIDA, codigoEstado: 690, transaccion: true",
    },
  },

  {
    id: "venta-11442",

    numeroFactura: "11442",

    fechaEmision: "2026-09-08T10:48:21",

    razonSocial: "Franz Orosco",

    numeroDocumento: "6123488010",

    monto: 96,

    moneda: "BOB",

    usuario: "ahuanca",

    estado: "VALIDADA",

    correoCliente: null,
  },

  {
    id: "venta-11441",

    numeroFactura: "11441",

    fechaEmision: "2026-09-08T10:02:40",

    razonSocial: "Lucero",

    numeroDocumento: "12709612",

    monto: 78,

    moneda: "BOB",

    usuario: "ahuanca",

    estado: "VALIDADA",

    correoCliente: "lucero@ejemplo.com",
  },

  {
    id: "venta-11440",

    numeroFactura: "11440",

    fechaEmision: "2026-09-08T09:44:33",

    razonSocial: "Mike Aranda",

    numeroDocumento: "9873827",

    monto: 144,

    moneda: "BOB",

    usuario: "ahuanca",

    estado: "VALIDADA",
  },

  {
    id: "venta-11439",

    numeroFactura: "11439",

    fechaEmision: "2026-09-07T19:03:57",

    razonSocial: "Julio Bobarin",

    numeroDocumento: "3858348015",

    monto: 19,

    moneda: "BOB",

    usuario: "ahuanca",

    estado: "VALIDADA",
  },

  {
    id: "venta-11438",

    numeroFactura: "11438",

    fechaEmision: "2026-09-07T18:55:20",

    razonSocial: "S/N",

    numeroDocumento: "00000",

    monto: 37,

    moneda: "BOB",

    usuario: "ahuanca",

    estado: "VALIDADA",
  },

  {
    id: "venta-11437",

    numeroFactura: "11437",

    fechaEmision: "2026-09-07T18:22:05",

    razonSocial: "Quispe",

    numeroDocumento: "6975756",

    monto: 60,

    moneda: "BOB",

    usuario: "ahuanca",

    estado: "VALIDADA",
  },

  {
    id: "venta-11436",

    numeroFactura: "11436",

    fechaEmision: "2026-09-07T16:51:26",

    razonSocial: "FEPPA",

    numeroDocumento: "1016299023",

    monto: 52,

    moneda: "BOB",

    usuario: "ahuanca",

    estado: "VALIDADA",
  },

  {
    id: "venta-11435",

    numeroFactura: "11435",

    fechaEmision: "2026-09-07T16:43:31",

    razonSocial: "Apaza",

    numeroDocumento: "3491341",

    monto: 11,

    moneda: "BOB",

    usuario: "ahuanca",

    estado: "VALIDADA",
  },

  {
    id: "venta-11434",

    numeroFactura: "11434",

    fechaEmision: "2026-09-07T16:35:51",

    razonSocial: "Gregorio Mamani",

    numeroDocumento: "3311167",

    monto: 66,

    moneda: "BOB",

    usuario: "ahuanca",

    estado: "VALIDADA",
  },
];
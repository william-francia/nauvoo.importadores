import type {
  InventarioMovimiento,
  InventarioProducto,
} from "../types/inventario.types";

export const PRODUCTOS_INVENTARIO_MOCK: InventarioProducto[] =
  [
    {
      id: "p-001",

      codigo: "475200",

      nombre:
        "Tornillo NAUVOO, CUTTER 3,5x25",

      unidadMedida: "PIEZA",

      stock: {
        almacen_uquisamana: 200,
        isac_tamayo: 50,
        calacoto: 40,
        santa_cruz: 30,
      },

      ultimaActualizacion:
        "2026-09-08T14:32:00",
    },

    {
      id: "p-002",

      codigo: "475201",

      nombre:
        'Autoperforante NAUVOO, cabeza lenteja #8x1,1/2"',

      unidadMedida: "PIEZA",

      stock: {
        almacen_uquisamana: 60,
        isac_tamayo: 40,
        calacoto: 30,
        santa_cruz: 20,
      },

      ultimaActualizacion:
        "2026-09-08T12:10:00",
    },

    {
      id: "p-003",

      codigo: "475202",

      nombre:
        "Ganchos en forma de jota para techar J-60 mm",

      unidadMedida: "PIEZA",

      stock: {
        almacen_uquisamana: 100,
        isac_tamayo: 20,
        calacoto: 10,
        santa_cruz: 6,
      },

      ultimaActualizacion:
        "2026-09-07T16:20:00",
    },

    {
      id: "p-004",

      codigo: "475203",

      nombre:
        'Perno Hexagonal UNC G2, 5/16"x3.1/2"',

      unidadMedida: "PIEZA",

      stock: {
        almacen_uquisamana: 50,
        isac_tamayo: 10,
        calacoto: 20,
        santa_cruz: 0,
      },

      ultimaActualizacion:
        "2026-09-07T11:05:00",
    },

    {
      id: "p-005",

      codigo: "475204",

      nombre:
        'Clavo de ACERO FIERO 1,1/2"',

      unidadMedida: "CAJA",

      stock: {
        almacen_uquisamana: 280,
        isac_tamayo: 50,
        calacoto: 40,
        santa_cruz: 50,
      },

      ultimaActualizacion:
        "2026-09-06T09:18:00",
    },

    {
      id: "p-006",

      codigo: "475205",

      nombre:
        "Tornillo DORADO para madera",

      unidadMedida: "PIEZA",

      stock: {
        almacen_uquisamana: 30,
        isac_tamayo: 0,
        calacoto: 0,
        santa_cruz: 0,
      },

      ultimaActualizacion:
        "2026-09-05T17:40:00",
    },

    {
      id: "p-007",

      codigo: "475206",

      nombre:
        "Tornillo NAUVOO para metales NEGRO",

      unidadMedida: "PIEZA",

      stock: {
        almacen_uquisamana: 0,
        isac_tamayo: 30,
        calacoto: 30,
        santa_cruz: 30,
      },

      ultimaActualizacion:
        "2026-09-05T12:22:00",
    },
  ];

export const MOVIMIENTOS_INVENTARIO_MOCK: InventarioMovimiento[] =
  [
    {
      id: "mov-001",

      productoId: "p-001",

      tipo: "INGRESO",

      cantidad: 500,

      fecha: "2026-09-08",

      ubicacionDestino:
        "almacen_uquisamana",

      observacion:
        "Compra a proveedor",

      responsable:
        "Daniel Bernabe",

      creadoEn:
        "2026-09-08T14:22:00",
    },

    {
      id: "mov-002",

      productoId: "p-001",

      tipo: "TRASLADO",

      cantidad: 50,

      fecha: "2026-09-05",

      ubicacionOrigen:
        "almacen_uquisamana",

      ubicacionDestino:
        "isac_tamayo",

      observacion:
        "Reposición del local",

      responsable:
        "Daniel Bernabe",

      creadoEn:
        "2026-09-05T10:15:00",
    },

    {
      id: "mov-003",

      productoId: "p-003",

      tipo: "TRASLADO",

      cantidad: 20,

      fecha: "2026-09-07",

      ubicacionOrigen:
        "almacen_uquisamana",

      ubicacionDestino:
        "calacoto",

      observacion:
        "Reposición",

      responsable:
        "Daniel Bernabe",

      creadoEn:
        "2026-09-07T16:30:00",
    },
  ];
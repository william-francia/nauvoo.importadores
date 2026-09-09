// src/features/productos/data/productos.mock.ts

import type {
  Producto,
} from "../types/productos.types";

export const PRODUCTOS_MOCK: Producto[] = [
  {
    id: "p-001",

    actividadEconomicaCodigo: "475200",

    actividadEconomicaNombre:
      "VENTA AL POR MENOR DE ARTÍCULOS DE FERRETERÍA",

    homologadoCodigo: "62161",

    homologadoNombre:
      "SERVICIOS DE COMERCIO AL POR MENOR DE MATERIALES DE CONSTRUCCIÓN",

    nombre:
      "Tornillo NAUVOO, CUTTER 3,5x25",

    descripcion:
      "Tornillo NAUVOO para madera aglomerada, cabeza avellanada.",

    unidadMedida: "PIEZA",

    precio: 0.26,

    precioComparacion: 0,

    costo: 0,

    sku: "NS32525",

    codigoBarras: "",

    tipoProducto: "Fijación",

    proveedor: "Proveedor Importación",

    tieneOpciones: false,

    stockPorLocal: {
      uquisamana: 12,
      isac_tamayo: 20,
      calacoto: 35,
      santa_cruz: 15,
    },

    activo: true,
  },

  {
    id: "p-002",

    actividadEconomicaCodigo: "475200",

    actividadEconomicaNombre:
      "VENTA AL POR MENOR DE ARTÍCULOS DE FERRETERÍA",

    homologadoCodigo: "62161",

    homologadoNombre:
      "PRODUCTOS DE FERRETERÍA",

    nombre:
      'Autoperforante NAUVOO, cabeza lenteja, #8x1,1/2"',

    descripcion:
      "Autoperforante para trabajo en metal.",

    unidadMedida: "PIEZA",

    precio: 0.35,

    precioComparacion: 0,

    costo: 0,

    sku: "AUT-812",

    codigoBarras: "",

    tipoProducto: "Fijación",

    proveedor: "Proveedor Importación",

    tieneOpciones: false,

    stockPorLocal: {
      uquisamana: 0,
      isac_tamayo: 3,
      calacoto: 0,
      santa_cruz: 2,
    },

    activo: true,
  },

  {
    id: "p-003",

    actividadEconomicaCodigo: "475200",

    actividadEconomicaNombre:
      "VENTA AL POR MENOR DE ARTÍCULOS DE FERRETERÍA",

    homologadoCodigo: "62161",

    homologadoNombre:
      "PRODUCTOS DE FERRETERÍA",

    nombre:
      "Ganchos en forma de jota para techar J-60 mm",

    descripcion:
      "Gancho metálico para techado.",

    unidadMedida: "PIEZA",

    precio: 1.5,

    precioComparacion: 0,

    costo: 0,

    sku: "GAN-J60",

    codigoBarras: "",

    tipoProducto: "Construcción",

    proveedor: "Proveedor Nacional",

    tieneOpciones: false,

    stockPorLocal: {
      uquisamana: 25,
      isac_tamayo: 30,
      calacoto: 100,
      santa_cruz: 45,
    },

    activo: true,
  },

  {
    id: "p-004",

    actividadEconomicaCodigo: "475200",

    actividadEconomicaNombre:
      "VENTA AL POR MENOR DE ARTÍCULOS DE FERRETERÍA",

    homologadoCodigo: "62161",

    homologadoNombre:
      "PRODUCTOS DE FERRETERÍA",

    nombre:
      'Perno Hexagonal UNC G2, 5/16"x3.1/2"',

    descripcion:
      "Perno hexagonal galvanizado.",

    unidadMedida: "PIEZA",

    precio: 2.3,

    precioComparacion: 0,

    costo: 0,

    sku: "PER-516",

    codigoBarras: "",

    tipoProducto: "Fijación",

    proveedor: "Proveedor Nacional",

    tieneOpciones: false,

    stockPorLocal: {
      uquisamana: 10,
      isac_tamayo: 5,
      calacoto: 40,
      santa_cruz: 15,
    },

    activo: true,
  },

  {
    id: "p-005",

    actividadEconomicaCodigo: "475200",

    actividadEconomicaNombre:
      "VENTA AL POR MENOR DE ARTÍCULOS DE FERRETERÍA",

    homologadoCodigo: "62161",

    homologadoNombre:
      "PRODUCTOS DE FERRETERÍA",

    nombre:
      'Clavo de ACERO FIERO 1,1/2"',

    descripcion:
      "Clavo de acero para múltiples aplicaciones.",

    unidadMedida: "CAJA",

    precio: 12,

    precioComparacion: 0,

    costo: 0,

    sku: "CLA-112",

    codigoBarras: "",

    tipoProducto: "Fijación",

    proveedor: "Proveedor Nacional",

    tieneOpciones: false,

    stockPorLocal: {
      uquisamana: 0,
      isac_tamayo: 0,
      calacoto: 0,
      santa_cruz: 0,
    },

    activo: true,
  },
];

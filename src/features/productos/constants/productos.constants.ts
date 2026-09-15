// src/features/productos/constants/productos.constants.ts

import type {
  LocalProducto,
} from "../types/productos.types";

export const LOCALES: LocalProducto[] = [
  {
    id: "uquisamana",
    nombre: "Local Uquisamaña",
    corto: "L. Uquisamaña",
  },
  {
    id: "isac_tamayo",
    nombre: "Tienda Isac Tamayo",
    corto: "T. Isac Tamayo",
  },
  {
    id: "calacoto",
    nombre: "Local Calacoto",
    corto: "L. Calacoto",
  },
  {
    id: "santa_cruz",
    nombre: "Local Santa Cruz",
    corto: "L. Santa Cruz",
  },
];

export const STOCK_ALTO_MINIMO = 20;

export const UNIDADES_MEDIDA = [
  "PIEZA",
  "UNIDAD",
  "CAJA",
  "BOLSA",
  "BALDE",
  "PAQUETE",
  "DOCENA",
  "PAR",
  "JUEGO",
  "ROLLO",
  "BOBINA",
  "BARRA",
  "PLANCHA",
  "TUBO",
  "SACO",
  "FRASCO",
  "BOTELLA",
  "LATA",
  "CARTÓN",
  "METRO",
  "METRO CUADRADO",
  "METRO CÚBICO",
  "CENTÍMETRO",
  "KILOGRAMO",
  "GRAMO",
  "LITRO",
  "MILILITRO",
  "GALÓN",
] as const;

export const ACTIVIDADES_ECONOMICAS = [
  {
    codigo: "475200",
    nombre:
      "VENTA AL POR MENOR DE ARTÍCULOS DE FERRETERÍA, PINTURAS Y PRODUCTOS DE VIDRIO",
  },
  {
    codigo: "466300",
    nombre:
      "VENTA AL POR MAYOR DE MATERIALES DE CONSTRUCCIÓN",
  },
];

export const PRODUCTOS_HOMOLOGADOS = [
  {
    codigo: "62161",
    nombre:
      "SERVICIOS DE COMERCIO AL POR MENOR DE MATERIALES DE CONSTRUCCIÓN Y VIDRIO",
  },
  {
    codigo: "62162",
    nombre:
      "PRODUCTOS Y ARTÍCULOS DE FERRETERÍA",
  },
];

export const TIPOS_PRODUCTO = [
  "Ferretería",
  "Construcción",
  "Herramienta",
  "Fijación",
  "Electricidad",
  "Plomería",
  "Pintura",
  "Otro",
];

export const PROVEEDORES = [
  "Sin proveedor",
  "Proveedor Nacional",
  "Proveedor Importación",
  "Proveedor Local",
];

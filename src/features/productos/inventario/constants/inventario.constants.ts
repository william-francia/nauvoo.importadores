import type {
  InventarioUbicacion,
  InventarioUbicacionId,
  TiendaUbicacionId,
} from "../types/inventario.types";

export const ALMACEN_ID: InventarioUbicacionId =
  "almacen_uquisamana";

export const UBICACIONES: InventarioUbicacion[] = [
  {
    id: "almacen_uquisamana",
    nombre: "Almacén Uquisamaña",
    corto: "Uquisamaña",
    tipo: "ALMACEN",
  },

  {
    id: "isac_tamayo",
    nombre: "Local Isac Tamayo",
    corto: "L. Isac Tamayo",
    tipo: "TIENDA",
  },

  {
    id: "calacoto",
    nombre: "Local Calacoto",
    corto: "L. Calacoto",
    tipo: "TIENDA",
  },

  {
    id: "santa_cruz",
    nombre: "Local Santa Cruz",
    corto: "L. Santa Cruz",
    tipo: "TIENDA",
  },
];

export const TIENDAS = UBICACIONES.filter(
  (
    item
  ): item is InventarioUbicacion & {
    id: TiendaUbicacionId;
  } => item.tipo === "TIENDA"
);

export function obtenerUbicacion(
  id: InventarioUbicacionId
) {
  return UBICACIONES.find(
    (ubicacion) => ubicacion.id === id
  );
}
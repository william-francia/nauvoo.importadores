import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { actualizarProducto, crearProducto, eliminarProductos, listarProductos, productosQueryKey } from "../services/productos.service";
import type { ProductoFormValues } from "../types/productos.types";

export function useProductos() {
  return useQuery({ queryKey: productosQueryKey, queryFn: listarProductos });
}

function useInvalidarProductos() {
  const client = useQueryClient();
  return () => Promise.all([
    client.invalidateQueries({ queryKey: productosQueryKey }),
    client.invalidateQueries({ queryKey: ["dashboard-summary"] }),
  ]);
}

export function useCrearProducto() {
  const invalidar = useInvalidarProductos();
  return useMutation({ mutationFn: crearProducto, onSuccess: invalidar });
}

export function useActualizarProducto() {
  const invalidar = useInvalidarProductos();
  return useMutation({ mutationFn: ({ id, values }: { id: string; values: ProductoFormValues }) => actualizarProducto(id, values), onSuccess: invalidar });
}

export function useEliminarProductos() {
  const invalidar = useInvalidarProductos();
  return useMutation({ mutationFn: eliminarProductos, onSuccess: invalidar });
}

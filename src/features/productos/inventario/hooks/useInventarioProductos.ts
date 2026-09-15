import {
  useMemo,
  useState,
} from "react";

import {
  ALMACEN_ID,
} from "../constants/inventario.constants";

import {
  MOVIMIENTOS_INVENTARIO_MOCK,
  PRODUCTOS_INVENTARIO_MOCK,
} from "../data/inventario.mock";

import type {
  InventarioMovimiento,
  InventarioProducto,
  RegistrarMovimientoInput,
  RegistrarTrasladoInput,
} from "../types/inventario.types";

function generarId() {
  return `mov-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
}

function totalProducto(
  producto: InventarioProducto
) {
  return Object.values(
    producto.stock
  ).reduce(
    (total, cantidad) =>
      total + cantidad,
    0
  );
}

export function useInventarioProductos() {
  const [
    productos,
    setProductos,
  ] = useState<
    InventarioProducto[]
  >(
    PRODUCTOS_INVENTARIO_MOCK
  );

  const [
    movimientos,
    setMovimientos,
  ] = useState<
    InventarioMovimiento[]
  >(
    MOVIMIENTOS_INVENTARIO_MOCK
  );

  const [
    busqueda,
    setBusqueda,
  ] = useState("");

  const [
    filasExpandidas,
    setFilasExpandidas,
  ] = useState<Set<string>>(
    new Set()
  );

  /* ==============================
     BÚSQUEDA
  ============================== */

  const productosFiltrados =
    useMemo(() => {
      const q =
        busqueda
          .trim()
          .toLowerCase();

      if (!q) {
        return productos;
      }

      return productos.filter(
        (producto) =>
          producto.nombre
            .toLowerCase()
            .includes(q) ||
          producto.codigo
            .toLowerCase()
            .includes(q)
      );
    }, [
      productos,
      busqueda,
    ]);

  /* ==============================
     RESUMEN
  ============================== */

  const productosConStock =
    useMemo(
      () =>
        productos.filter(
          (producto) =>
            totalProducto(
              producto
            ) > 0
        ).length,
      [productos]
    );

  const movimientosSemana =
    useMemo(() => {
      const ahora =
        new Date();

      const inicio =
        new Date(ahora);

      inicio.setDate(
        ahora.getDate() - 7
      );

      return movimientos.filter(
        (movimiento) =>
          !movimiento.anulado &&
          new Date(
            movimiento.creadoEn
          ) >= inicio
      ).length;
    }, [movimientos]);

  /* ==============================
     FILAS
  ============================== */

  function toggleFila(
    productoId: string
  ) {
    setFilasExpandidas(
      (actual) => {
        const siguiente =
          new Set(actual);

        if (
          siguiente.has(
            productoId
          )
        ) {
          siguiente.delete(
            productoId
          );
        } else {
          siguiente.add(
            productoId
          );
        }

        return siguiente;
      }
    );
  }

  /* ==============================
     MOVIMIENTO
  ============================== */

  function registrarMovimiento(
    input: RegistrarMovimientoInput
  ) {
    if (
      !Number.isFinite(
        input.cantidad
      ) ||
      input.cantidad <= 0
    ) {
      throw new Error(
        "La cantidad debe ser mayor a cero."
      );
    }

    setProductos(
      (actuales) =>
        actuales.map(
          (producto) => {
            if (
              producto.id !==
              input.productoId
            ) {
              return producto;
            }

            const stockActual =
              producto.stock[
                input.ubicacion
              ];

            let nuevoStock =
              stockActual;

            if (
              input.tipo ===
                "INGRESO" ||
              input.tipo ===
                "AJUSTE_AUMENTO"
            ) {
              nuevoStock +=
                input.cantidad;
            }

            if (
              input.tipo ===
              "AJUSTE_DISMINUCION"
            ) {
              if (
                stockActual <
                input.cantidad
              ) {
                throw new Error(
                  "No existe suficiente stock para realizar la disminución."
                );
              }

              nuevoStock -=
                input.cantidad;
            }

            return {
              ...producto,

              stock: {
                ...producto.stock,

                [input.ubicacion]:
                  nuevoStock,
              },

              ultimaActualizacion:
                new Date().toISOString(),
            };
          }
        )
    );

    const movimiento:
      InventarioMovimiento = {
      id: generarId(),

      productoId:
        input.productoId,

      tipo: input.tipo,

      cantidad:
        input.cantidad,

      fecha:
        input.fecha,

      ubicacionDestino:
        input.ubicacion,

      observacion:
        input.observacion,

      responsable:
        "Usuario actual",

      creadoEn:
        new Date().toISOString(),
    };

    setMovimientos(
      (actuales) => [
        movimiento,
        ...actuales,
      ]
    );
  }

  /* ==============================
     TRASLADO
  ============================== */

  function registrarTraslado(
    input: RegistrarTrasladoInput
  ) {
    if (
      !Number.isFinite(
        input.cantidad
      ) ||
      input.cantidad <= 0
    ) {
      throw new Error(
        "La cantidad debe ser mayor a cero."
      );
    }

    const producto =
      productos.find(
        (item) =>
          item.id ===
          input.productoId
      );

    if (!producto) {
      throw new Error(
        "Producto no encontrado."
      );
    }

    const stockAlmacen =
      producto.stock[
        ALMACEN_ID
      ];

    if (
      stockAlmacen <
      input.cantidad
    ) {
      throw new Error(
        "El almacén Uquisamaña no tiene suficiente stock para realizar el traslado."
      );
    }

    setProductos(
      (actuales) =>
        actuales.map(
          (item) => {
            if (
              item.id !==
              input.productoId
            ) {
              return item;
            }

            return {
              ...item,

              stock: {
                ...item.stock,

                [ALMACEN_ID]:
                  item.stock[
                    ALMACEN_ID
                  ] -
                  input.cantidad,

                [input.destino]:
                  item.stock[
                    input.destino
                  ] +
                  input.cantidad,
              },

              ultimaActualizacion:
                new Date().toISOString(),
            };
          }
        )
    );

    const movimiento:
      InventarioMovimiento = {
      id: generarId(),

      productoId:
        input.productoId,

      tipo: "TRASLADO",

      cantidad:
        input.cantidad,

      fecha:
        input.fecha,

      ubicacionOrigen:
        ALMACEN_ID,

      ubicacionDestino:
        input.destino,

      observacion:
        input.observacion,

      responsable:
        "Usuario actual",

      creadoEn:
        new Date().toISOString(),
    };

    setMovimientos(
      (actuales) => [
        movimiento,
        ...actuales,
      ]
    );
  }

  /* ==============================
     ANULAR REGISTRO
  ============================== */

  function anularMovimiento(
    movimientoId: string
  ) {
    const movimiento =
      movimientos.find(
        (item) =>
          item.id ===
          movimientoId
      );

    if (
      !movimiento ||
      movimiento.anulado
    ) {
      return;
    }

    const producto =
      productos.find(
        (item) =>
          item.id ===
          movimiento.productoId
      );

    if (!producto) {
      throw new Error(
        "Producto no encontrado."
      );
    }

    const nuevoStock = {
      ...producto.stock,
    };

    if (
      movimiento.tipo ===
        "INGRESO" ||
      movimiento.tipo ===
        "AJUSTE_AUMENTO"
    ) {
      const ubicacion =
        movimiento.ubicacionDestino;

      if (!ubicacion) {
        return;
      }

      if (
        nuevoStock[
          ubicacion
        ] <
        movimiento.cantidad
      ) {
        throw new Error(
          "Este registro no puede anularse porque parte de ese stock ya fue utilizado o trasladado."
        );
      }

      nuevoStock[
        ubicacion
      ] -= movimiento.cantidad;
    }

    if (
      movimiento.tipo ===
      "AJUSTE_DISMINUCION"
    ) {
      const ubicacion =
        movimiento.ubicacionDestino;

      if (!ubicacion) {
        return;
      }

      nuevoStock[
        ubicacion
      ] += movimiento.cantidad;
    }

    if (
      movimiento.tipo ===
      "TRASLADO"
    ) {
      const origen =
        movimiento.ubicacionOrigen;

      const destino =
        movimiento.ubicacionDestino;

      if (
        !origen ||
        !destino
      ) {
        return;
      }

      if (
        nuevoStock[
          destino
        ] <
        movimiento.cantidad
      ) {
        throw new Error(
          "El traslado no puede anularse porque el local ya no posee toda la cantidad trasladada."
        );
      }

      nuevoStock[
        destino
      ] -= movimiento.cantidad;

      nuevoStock[
        origen
      ] += movimiento.cantidad;
    }

    setProductos(
      (actuales) =>
        actuales.map(
          (item) =>
            item.id ===
            producto.id
              ? {
                  ...item,

                  stock:
                    nuevoStock,

                  ultimaActualizacion:
                    new Date().toISOString(),
                }
              : item
        )
    );

    setMovimientos(
      (actuales) =>
        actuales.map(
          (item) =>
            item.id ===
            movimientoId
              ? {
                  ...item,
                  anulado:
                    true,
                }
              : item
        )
    );
  }

  return {
    productos,

    productosFiltrados,

    movimientos,

    busqueda,

    setBusqueda,

    filasExpandidas,

    toggleFila,

    productosConStock,

    movimientosSemana,

    registrarMovimiento,

    registrarTraslado,

    anularMovimiento,
  };
}

export {
  totalProducto,
};
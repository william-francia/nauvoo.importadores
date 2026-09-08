import {
  useEffect,
  useRef,
  useState,
} from "react";

import {
  buscarProductosVenta,
} from "../services/ventas.api";

import type {
  ProductoVenta,
} from "../types/ventas.types";

interface Props {
  onAgregar: (
    producto: ProductoVenta
  ) => void;
}

function moneda(valor: number) {
  return new Intl.NumberFormat(
    "es-BO",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  ).format(valor);
}

export default function ProductoSelector({
  onAgregar,
}: Props) {
  const [texto, setTexto] =
    useState("");

  const [productos, setProductos] =
    useState<ProductoVenta[]>([]);

  const [cargando, setCargando] =
    useState(false);

  const [abierto, setAbierto] =
    useState(false);

  const ref =
    useRef<HTMLDivElement>(null);

  useEffect(() => {
    function clickFuera(
      event: MouseEvent
    ) {
      if (
        ref.current &&
        !ref.current.contains(
          event.target as Node
        )
      ) {
        setAbierto(false);
      }
    }

    document.addEventListener(
      "mousedown",
      clickFuera
    );

    return () =>
      document.removeEventListener(
        "mousedown",
        clickFuera
      );
  }, []);

  useEffect(() => {
    if (
      !abierto ||
      texto.trim().length < 1
    ) {
      return;
    }

    const timer = window.setTimeout(
      async () => {
        try {
          setCargando(true);

          const resultado =
            await buscarProductosVenta(
              texto
            );

          setProductos(resultado);
        } catch {
          setProductos([]);
        } finally {
          setCargando(false);
        }
      },
      250
    );

    return () =>
      window.clearTimeout(timer);
  }, [texto, abierto]);

  function agregar(
    producto: ProductoVenta
  ) {
    onAgregar(producto);

    setTexto("");
    setProductos([]);
    setAbierto(false);
  }

  return (
    <div
      className="producto-selector"
      ref={ref}
    >
      <div className="producto-selector__label">
        Producto / Servicio
      </div>

      <div className="producto-search">
        <span>⌕</span>

        <input
          value={texto}
          onFocus={() =>
            setAbierto(true)
          }
          onChange={(e) => {
            setTexto(e.target.value);
            setAbierto(true);
          }}
          placeholder="Buscar por nombre, código o descripción..."
        />

        <button
          type="button"
          className="producto-search__explorar"
          onClick={() =>
            setAbierto(true)
          }
        >
          Explorar
        </button>
      </div>

      <small className="producto-search__hint">
        Escribe mínimo 1 carácter
      </small>

      {abierto &&
        texto.trim().length >= 1 && (
          <div className="producto-resultados">
            {cargando && (
              <div className="venta-dropdown__message">
                Buscando productos...
              </div>
            )}

            {!cargando &&
              productos.map(
                (producto) => {
                  const stockTotal =
                    producto.stocks.reduce(
                      (acc, item) =>
                        acc +
                        item.cantidad,
                      0
                    );

                  return (
                    <button
                      type="button"
                      key={producto.id}
                      className="producto-resultado"
                      disabled={
                        stockTotal <= 0
                      }
                      onClick={() =>
                        agregar(producto)
                      }
                    >
                      <div className="producto-resultado__principal">
                        <strong>
                          {
                            producto.codigo_interno
                          }
                          {producto.codigo_interno
                            ? " - "
                            : ""}
                          {producto.nombre}
                        </strong>

                        <span>
                          {producto.descripcion}
                        </span>
                      </div>

                      <div className="producto-resultado__stock">
                        <strong>
                          {moneda(
                            producto.precio_pieza
                          )}{" "}
                          BOB
                        </strong>

                        <span>
                          Stock:{" "}
                          {stockTotal}
                        </span>
                      </div>

                      <div className="producto-resultado__tiendas">
                        {producto.stocks.map(
                          (stock) => (
                            <span
                              key={
                                stock.almacen
                                  .id
                              }
                            >
                              {
                                stock.almacen
                                  .nombre
                              }
                              :{" "}
                              {
                                stock.cantidad
                              }
                            </span>
                          )
                        )}
                      </div>
                    </button>
                  );
                }
              )}

            {!cargando &&
              productos.length === 0 && (
                <div className="venta-dropdown__message">
                  No encontramos productos
                  disponibles.
                </div>
              )}
          </div>
        )}
    </div>
  );
}

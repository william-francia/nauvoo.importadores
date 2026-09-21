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
  buscar?: (termino: string) => Promise<ProductoVenta[]>;
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
  buscar = buscarProductosVenta,
}: Props) {
  const [texto, setTexto] =
    useState("");

  const [productos, setProductos] =
    useState<ProductoVenta[]>([]);

  const [cargando, setCargando] =
    useState(false);

  const [abierto, setAbierto] =
    useState(false);

  const [error, setError] = useState<string | null>(null);

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
          setError(null);

          const resultado =
            await buscar(
              texto
            );

          setProductos(resultado);
        } catch (cause) {
          setProductos([]);
          setError(cause instanceof Error ? cause.message : "No se pudieron buscar los productos.");
        } finally {
          setCargando(false);
        }
      },
      250
    );

    return () =>
      window.clearTimeout(timer);
  }, [texto, abierto, buscar]);

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

            {!cargando && error && (
              <div className="venta-dropdown__message venta-alert--error">{error}</div>
            )}

            {!cargando && !error &&
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

            {!cargando && !error &&
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

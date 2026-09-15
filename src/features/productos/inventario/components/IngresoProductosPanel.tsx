import {
  useState,
} from "react";
import type { FormEvent } from "react";

import type {
  InventarioMovimiento,
  InventarioProducto,
  RegistrarMovimientoInput,
} from "../types/inventario.types";

interface Props {
  productos: InventarioProducto[];

  movimientos: InventarioMovimiento[];

  onRegistrar: (
    input: RegistrarMovimientoInput
  ) => void;

  onAnular: (
    movimientoId: string
  ) => void;
}

function fechaHoy() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}

export default function IngresoProductosPanel({
  productos,

  movimientos,

  onRegistrar,

  onAnular,
}: Props) {
  const [
    productoId,
    setProductoId,
  ] = useState("");

  const [
    cantidad,
    setCantidad,
  ] = useState(1);

  const [fecha, setFecha] =
    useState(fechaHoy());

  const [nota, setNota] =
    useState("");

  const [error, setError] =
    useState("");

  function submit(
    event: FormEvent
  ) {
    event.preventDefault();

    if (!productoId) {
      setError(
        "Selecciona un producto."
      );

      return;
    }

    try {
      onRegistrar({
        productoId,

        tipo: "INGRESO",

        cantidad,

        fecha,

        ubicacion:
          "almacen_uquisamana",

        observacion: nota,
      });

      setCantidad(1);
      setNota("");
      setError("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo registrar el ingreso."
      );
    }
  }

  const ingresos =
    movimientos.filter(
      (item) =>
        item.tipo ===
        "INGRESO"
    );

  return (
    <div className="inv-income-layout">
      <section className="inv-income-form-card">
        <h2>
          ＋ Ingreso de productos
        </h2>

        <p>
          Toda mercadería nueva ingresa
          inicialmente al Almacén
          Uquisamaña.
        </p>

        <form onSubmit={submit}>
          <label className="inv-field">
            <span>
              Producto *
            </span>

            <select
              value={
                productoId
              }
              onChange={(event) =>
                setProductoId(
                  event.target
                    .value
                )
              }
            >
              <option value="">
                Seleccionar producto...
              </option>

              {productos.map(
                (producto) => (
                  <option
                    key={
                      producto.id
                    }
                    value={
                      producto.id
                    }
                  >
                    {
                      producto.codigo
                    }{" "}
                    -{" "}
                    {
                      producto.nombre
                    }
                  </option>
                )
              )}
            </select>
          </label>

          <div className="inv-grid-2">
            <label className="inv-field">
              <span>
                Cantidad ingresada *
              </span>

              <input
                type="number"
                min="1"
                value={
                  cantidad
                }
                onChange={(event) =>
                  setCantidad(
                    Number(
                      event.target
                        .value
                    )
                  )
                }
              />
            </label>

            <label className="inv-field">
              <span>
                Fecha de ingreso *
              </span>

              <input
                type="date"
                value={fecha}
                onChange={(event) =>
                  setFecha(
                    event.target
                      .value
                  )
                }
              />
            </label>
          </div>

          <label className="inv-field">
            <span>
              Observación
            </span>

            <textarea
              value={nota}
              onChange={(event) =>
                setNota(
                  event.target.value
                )
              }
              placeholder="Proveedor, lote, factura de compra, observación..."
            />
          </label>

          {error && (
            <div className="inv-error">
              {error}
            </div>
          )}

          <button
            className="inv-transfer-button"
            type="submit"
          >
            ＋ Registrar ingreso
          </button>
        </form>
      </section>

      <section className="inv-income-history">
        <h2>
          Historial de ingresos
        </h2>

        <table>
          <thead>
            <tr>
              <th>Fecha</th>

              <th>Producto</th>

              <th>Cantidad</th>

              <th>Estado</th>

              <th>Acción</th>
            </tr>
          </thead>

          <tbody>
            {ingresos.map(
              (movimiento) => {
                const producto =
                  productos.find(
                    (item) =>
                      item.id ===
                      movimiento.productoId
                  );

                return (
                  <tr
                    key={
                      movimiento.id
                    }
                  >
                    <td>
                      {
                        movimiento.fecha
                      }
                    </td>

                    <td>
                      {producto?.nombre}
                    </td>

                    <td>
                      +
                      {
                        movimiento.cantidad
                      }
                    </td>

                    <td>
                      {movimiento.anulado
                        ? "Anulado"
                        : "Registrado"}
                    </td>

                    <td>
                      {!movimiento.anulado && (
                        <button
                          type="button"
                          className="inv-delete-record"
                          onClick={() => {
                            try {
                              onAnular(
                                movimiento.id
                              );
                            } catch (
                              error
                            ) {
                              window.alert(
                                error instanceof
                                  Error
                                  ? error.message
                                  : "No se pudo anular."
                              );
                            }
                          }}
                        >
                          🗑 Anular
                        </button>
                      )}
                    </td>
                  </tr>
                );
              }
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}

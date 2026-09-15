import {
  useMemo,
  useState,
} from "react";
import type { FormEvent } from "react";

import {
  UBICACIONES,
} from "../constants/inventario.constants";

import type {
  InventarioMovimiento,
  InventarioProducto,
  InventarioUbicacionId,
  RegistrarMovimientoInput,
} from "../types/inventario.types";

interface Props {
  producto:
    | InventarioProducto
    | null;

  movimientos:
    InventarioMovimiento[];

  onCerrar: () => void;

  onGuardar: (
    input: RegistrarMovimientoInput
  ) => void;

  onAnularMovimiento: (
    movimientoId: string
  ) => void;
}

function fechaHoy() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}

export default function EditarInventarioModal({
  producto,

  movimientos,

  onCerrar,

  onGuardar,

  onAnularMovimiento,
}: Props) {
  const [tipo, setTipo] =
    useState<
      RegistrarMovimientoInput["tipo"]
    >("INGRESO");

  const [
    cantidad,
    setCantidad,
  ] = useState(1);

  const [fecha, setFecha] =
    useState(fechaHoy());

  const [
    ubicacion,
    setUbicacion,
  ] =
    useState<InventarioUbicacionId>(
      "almacen_uquisamana"
    );

  const [
    observacion,
    setObservacion,
  ] = useState("");

  const [error, setError] =
    useState("");

  const movimientosProducto =
    useMemo(
      () =>
        producto
          ? movimientos.filter(
              (movimiento) =>
                movimiento.productoId ===
                producto.id
            )
          : [],
      [
        producto,
        movimientos,
      ]
    );

  if (!producto) {
    return null;
  }

  const productoId = producto.id;

  function handleSubmit(
    event: FormEvent
  ) {
    event.preventDefault();

    try {
      setError("");

      onGuardar({
        productoId:
          productoId,

        tipo,

        cantidad,

        fecha,

        ubicacion,

        observacion,
      });

      setCantidad(1);
      setObservacion("");
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo actualizar el inventario."
      );
    }
  }

  return (
    <div
      className="inv-modal-backdrop"
      onMouseDown={onCerrar}
    >
      <div
        className="inv-modal"
        onMouseDown={(event) =>
          event.stopPropagation()
        }
      >
        <header className="inv-modal-header">
          <div>
            <h2>
              ✎ Editar inventario
            </h2>
          </div>

          <button
            type="button"
            onClick={onCerrar}
          >
            ×
          </button>
        </header>

        <div className="inv-modal-info">
          <strong>
            ⓘ Solo se está manipulando el
            inventario.
          </strong>

          <span>
            El producto ya existe en el sistema.
          </span>
        </div>

        <form
          onSubmit={handleSubmit}
        >
          <div className="inv-modal-body">
            <label className="inv-field">
              <span>Producto</span>

              <input
                disabled
                value={`${producto.codigo} - ${producto.nombre}`}
              />
            </label>

            <div className="inv-grid-2">
              <label className="inv-field">
                <span>
                  Tipo de operación *
                </span>

                <select
                  value={tipo}
                  onChange={(event) =>
                    setTipo(
                      event.target
                        .value as RegistrarMovimientoInput["tipo"]
                    )
                  }
                >
                  <option value="INGRESO">
                    Registrar ingreso
                  </option>

                  <option value="AJUSTE_AUMENTO">
                    Aumentar inventario
                  </option>

                  <option value="AJUSTE_DISMINUCION">
                    Disminuir inventario
                  </option>
                </select>
              </label>

              <label className="inv-field">
                <span>
                  Cantidad *
                </span>

                <input
                  type="number"
                  min="1"
                  step="1"
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
            </div>

            <div className="inv-grid-2">
              <label className="inv-field">
                <span>
                  Fecha de ingreso /
                  actualización *
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

              <label className="inv-field">
                <span>
                  Ubicación *
                </span>

                <select
                  value={
                    ubicacion
                  }
                  onChange={(event) =>
                    setUbicacion(
                      event.target
                        .value as InventarioUbicacionId
                    )
                  }
                >
                  {UBICACIONES.map(
                    (item) => (
                      <option
                        value={
                          item.id
                        }
                        key={
                          item.id
                        }
                      >
                        {
                          item.nombre
                        }
                      </option>
                    )
                  )}
                </select>
              </label>
            </div>

            <label className="inv-field">
              <span>
                Notas
              </span>

              <textarea
                maxLength={200}
                value={
                  observacion
                }
                onChange={(event) =>
                  setObservacion(
                    event.target
                      .value
                  )
                }
                placeholder="Ej. compra a proveedor, ajuste físico, corrección..."
              />

              <small>
                {
                  observacion.length
                }
                /200
              </small>
            </label>

            {error && (
              <div className="inv-error">
                {error}
              </div>
            )}

            <div className="inv-history">
              <h3>
                Registros anteriores
              </h3>

              {movimientosProducto.length ===
              0 ? (
                <p>
                  Este producto todavía
                  no tiene movimientos
                  registrados.
                </p>
              ) : (
                <div className="inv-history-table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>
                          Fecha
                        </th>

                        <th>
                          Movimiento
                        </th>

                        <th>
                          Cantidad
                        </th>

                        <th>
                          Acciones
                        </th>
                      </tr>
                    </thead>

                    <tbody>
                      {movimientosProducto
                        .slice(0, 6)
                        .map(
                          (
                            movimiento
                          ) => (
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
                                {
                                  movimiento.tipo
                                }
                              </td>

                              <td>
                                {
                                  movimiento.cantidad
                                }
                              </td>

                              <td>
                                {movimiento.anulado ? (
                                  <span className="inv-cancelled">
                                    Anulado
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    className="inv-delete-record"
                                    onClick={() => {
                                      try {
                                        onAnularMovimiento(
                                          movimiento.id
                                        );
                                      } catch (
                                        err
                                      ) {
                                        setError(
                                          err instanceof
                                            Error
                                            ? err.message
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
                          )
                        )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <footer className="inv-modal-footer">
            <button
              type="button"
              className="inv-button inv-button--ghost"
              onClick={onCerrar}
            >
              Cancelar
            </button>

            <button
              type="submit"
              className="inv-button inv-button--primary"
            >
              ▣ Guardar movimiento
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

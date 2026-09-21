import {
  Fragment,
  useState,
} from "react";

import type {
  LineaVenta,
} from "../types/ventas.types";

interface Props {
  lineas: LineaVenta[];

  onCantidad: (
    id: string,
    cantidad: number
  ) => void;

  onAlmacen: (
    id: string,
    almacenId: string
  ) => void;

  onPrecio: (
    id: string,
    precio: number
  ) => void;

  onDescuento: (
    id: string,
    descuento: number
  ) => void;

  onInformacionExtra: (
    id: string,
    informacion: string
  ) => void;

  onEliminar: (id: string) => void;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat(
    "es-BO",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  ).format(value);
}

export default function VentaItemsTable({
  lineas,
  onCantidad,
  onAlmacen,
  onPrecio,
  onDescuento,
  onInformacionExtra,
  onEliminar,
}: Props) {
  const [
    detallesAbiertos,
    setDetallesAbiertos,
  ] = useState<Set<string>>(
    new Set()
  );

  function toggleDetalle(id: string) {
    setDetallesAbiertos(
      (actual) => {
        const siguiente =
          new Set(actual);

        if (siguiente.has(id)) {
          siguiente.delete(id);
        } else {
          siguiente.add(id);
        }

        return siguiente;
      }
    );
  }

  if (lineas.length === 0) {
    return (
      <div className="venta-carrito-vacio">
        <div className="venta-carrito-vacio__icon">
          🛒
        </div>

        <strong>
          El carrito está vacío
        </strong>

        <span>
          Busca un producto para comenzar
          la venta.
        </span>
      </div>
    );
  }

  return (
    <div className="venta-table-wrapper">
      <table className="venta-table">
        <thead>
          <tr>
            <th>
              Producto / Servicio
            </th>

            <th>Cantidad</th>

            <th>Tienda</th>

            <th>Precio</th>

            <th>Desc.</th>

            <th>OP.</th>
          </tr>
        </thead>

        <tbody>
          {lineas.map((linea) => {
            const stockActual =
              linea.producto.stocks.find(
                (stock) =>
                  stock.almacen.id ===
                  linea.almacen_id
              );

            const bruto =
              linea.cantidad *
              linea.precio_unitario;

            const totalLinea =
              bruto - linea.descuento;

            const detalleAbierto =
              detallesAbiertos.has(
                linea.id
              );

            return (
              <Fragment key={linea.id}>
                <tr>
                  <td>
                    <div className="venta-product-cell">
                      <strong>
                        {`${linea.producto.codigo_interno} - `}

                        {
                          linea.producto
                            .nombre
                        }
                      </strong>

                      <span>
                        {linea.producto
                          .medida ||
                          "PIEZAS"}
                      </span>

                      <small>
                        Total línea:{" "}
                        <b>
                          {formatMoney(
                            totalLinea
                          )}{" "}
                          BOB
                        </b>
                      </small>
                    </div>
                  </td>

                  <td>
                    <div className="cantidad-control">
                      <button
                        type="button"
                        onClick={() =>
                          onCantidad(
                            linea.id,
                            linea.cantidad -
                              1
                          )
                        }
                      >
                        −
                      </button>

                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={
                          linea.cantidad
                        }
                        onChange={(e) =>
                          onCantidad(
                            linea.id,
                            Number(
                              e.target
                                .value
                            )
                          )
                        }
                      />

                      <button
                        type="button"
                        onClick={() =>
                          onCantidad(
                            linea.id,
                            linea.cantidad +
                              1
                          )
                        }
                      >
                        +
                      </button>
                    </div>

                    <small className="stock-info">
                      Disponible:{" "}
                      {stockActual?.cantidad ??
                        0}
                    </small>
                  </td>

                  <td>
                    <select
                      className="venta-table-select"
                      value={
                        linea.almacen_id
                      }
                      onChange={(e) => {
                        const almacen = linea.producto.stocks.find(
                          (stock) => stock.almacen.id === e.target.value
                        )?.almacen;
                        const esAlmacen = almacen?.tipo === "almacen" ||
                          /almac[eé]n/i.test(almacen?.nombre ?? "");

                        if (esAlmacen && !window.confirm("¿En serio quieres vender directamente del almacén?")) {
                          e.currentTarget.value = linea.almacen_id;
                          return;
                        }

                        onAlmacen(linea.id, e.target.value);
                      }}
                    >
                      {linea.producto.stocks.map(
                        (stock) => (
                          <option
                            key={
                              stock.almacen.id
                            }
                            value={
                              stock.almacen.id
                            }
                          >
                            {
                              stock.almacen
                                .nombre
                            }{" "}
                            ({stock.cantidad})
                          </option>
                        )
                      )}
                    </select>
                  </td>

                  <td>
                    <div className="money-input">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={
                          linea.precio_unitario
                        }
                        onChange={(e) =>
                          onPrecio(
                            linea.id,
                            Number(
                              e.target
                                .value
                            )
                          )
                        }
                      />

                      <span>BOB</span>
                    </div>
                  </td>

                  <td>
                    <div className="money-input">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={
                          linea.descuento
                        }
                        onChange={(e) =>
                          onDescuento(
                            linea.id,
                            Number(
                              e.target
                                .value
                            )
                          )
                        }
                      />

                      <span>BOB</span>
                    </div>
                  </td>

                  <td>
                    <div className="venta-operaciones">
                      <button
                        type="button"
                        className="venta-op-button venta-op-button--danger"
                        title="Eliminar producto"
                        onClick={() =>
                          onEliminar(
                            linea.id
                          )
                        }
                      >
                        🗑
                      </button>

                      <button
                        type="button"
                        className="venta-op-button"
                        title="Información extra"
                        onClick={() =>
                          toggleDetalle(
                            linea.id
                          )
                        }
                      >
                        A+
                      </button>
                    </div>
                  </td>
                </tr>

                {detalleAbierto && (
                  <tr className="venta-extra-row">
                    <td colSpan={6}>
                      <div className="venta-extra-producto">
                        <label>
                          Información extra
                          del producto
                        </label>

                        <textarea
                          value={
                            linea.informacion_extra
                          }
                          onChange={(e) =>
                            onInformacionExtra(
                              linea.id,
                              e.target
                                .value
                            )
                          }
                          placeholder="Ej.: observaciones, acabado, tamaño especial, instrucciones..."
                        />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

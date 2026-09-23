import {
  useState,
} from "react";
import type { FormEvent } from "react";

import ConfirmarAccionInventarioModal from "./ConfirmarAccionInventarioModal";

import {
  TIENDAS,
} from "../constants/inventario.constants";

import type {
  InventarioMovimiento,
  InventarioProducto,
  RegistrarTrasladoInput,
  TiendaUbicacionId,
} from "../types/inventario.types";

interface Props {
  productos: InventarioProducto[];

  movimientos: InventarioMovimiento[];

  onTrasladar: (
    input: RegistrarTrasladoInput
  ) => void | Promise<void>;
}

function fechaHoy() {
  return new Date()
    .toISOString()
    .slice(0, 10);
}

export default function TrasladoProductosPanel({
  productos,

  movimientos,

  onTrasladar,
}: Props) {
  const [
    productoId,
    setProductoId,
  ] = useState("");

  const [
    cantidad,
    setCantidad,
  ] = useState(1);

  const [
    destino,
    setDestino,
  ] =
    useState<TiendaUbicacionId>(
      "isac_tamayo"
    );

  const [fecha, setFecha] =
    useState(fechaHoy());

  const [error, setError] =
    useState("");

  const [trasladoPendiente, setTrasladoPendiente] =
    useState<RegistrarTrasladoInput | null>(null);

  const [confirmando, setConfirmando] =
    useState(false);

  function handleSubmit(
    event: FormEvent
  ) {
    event.preventDefault();

    if (!productoId) {
      setError(
        "Selecciona un producto."
      );

      return;
    }

    setError("");
    setTrasladoPendiente({
      productoId,
      cantidad,
      destino,
      fecha,
      observacion: "Traslado desde Almacén Uquisamaña",
    });
  }

  async function confirmarTraslado() {
    if (!trasladoPendiente) return;

    try {
      setConfirmando(true);
      await onTrasladar(trasladoPendiente);
      setTrasladoPendiente(null);
      setCantidad(1);
    } catch (err) {
      setTrasladoPendiente(null);
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo realizar el traslado."
      );
    } finally {
      setConfirmando(false);
    }
  }

  const traslados =
    movimientos.filter(
      (item) =>
        item.tipo ===
          "TRASLADO" &&
        !item.anulado
    );

  return (
    <section className="inv-right-card">
      <div className="inv-card-title">
        <div>
          <h2>
            ⇄ Movimiento de productos
          </h2>

          <p>
            Traslada productos desde el
            almacén a los locales.
          </p>
        </div>
      </div>

      <form
        className="inv-transfer-form"
        onSubmit={
          handleSubmit
        }
      >
        <div className="inv-grid-2">
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
                Buscar y seleccionar producto...
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

          <label className="inv-field">
            <span>
              Cantidad a trasladar *
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
        </div>

        <div className="inv-grid-2">
          <label className="inv-field">
            <span>
              Destino *
            </span>

            <select
              value={
                destino
              }
              onChange={(event) =>
                setDestino(
                  event.target
                    .value as TiendaUbicacionId
                )
              }
            >
              {TIENDAS.map(
                (tienda) => (
                  <option
                    value={
                      tienda.id
                    }
                    key={
                      tienda.id
                    }
                  >
                    {
                      tienda.nombre
                    }
                  </option>
                )
              )}
            </select>
          </label>

          <label className="inv-field">
            <span>
              Fecha de traslado *
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

        {error && (
          <div className="inv-error">
            {error}
          </div>
        )}

        <button
          type="submit"
          className="inv-transfer-button"
        >
          ⇄ Registrar traslado
        </button>
      </form>

      <div className="inv-movement-history">
        <div className="inv-history-title">
          <h3>
            ◷ Historial de movimientos
          </h3>

          <button type="button">
            Ver todos
          </button>
        </div>

        <table>
          <thead>
            <tr>
              <th>Producto</th>

              <th>Detalle</th>

              <th>Fecha</th>
            </tr>
          </thead>

          <tbody>
            {traslados
              .slice(0, 6)
              .map(
                (movimiento) => {
                  const producto =
                    productos.find(
                      (item) =>
                        item.id ===
                        movimiento.productoId
                    );

                  const tienda =
                    TIENDAS.find(
                      (item) =>
                        item.id ===
                        movimiento.ubicacionDestino
                    );

                  return (
                    <tr
                      key={
                        movimiento.id
                      }
                    >
                      <td>
                        ⇄{" "}
                        {producto?.nombre ??
                          "-"}
                      </td>

                      <td>
                        🟢{" "}
                        {
                          movimiento.cantidad
                        }{" "}
                        unid. · Uquisamaña
                        →{" "}
                        {tienda?.corto ??
                          "-"}
                      </td>

                      <td>
                        {
                          movimiento.fecha
                        }
                      </td>
                    </tr>
                  );
                }
              )}
          </tbody>
        </table>
      </div>

      <ConfirmarAccionInventarioModal
        abierto={Boolean(trasladoPendiente)}
        titulo="¿Confirmar traslado de productos?"
        descripcion="El stock se descontará del almacén Uquisamaña y se sumará al local seleccionado."
        detalles={[
          { etiqueta: "Producto", valor: productos.find((item) => item.id === trasladoPendiente?.productoId)?.nombre ?? "-" },
          { etiqueta: "Cantidad", valor: `${trasladoPendiente?.cantidad ?? 0} unidades` },
          { etiqueta: "Origen", valor: "Almacén Uquisamaña" },
          { etiqueta: "Destino", valor: TIENDAS.find((item) => item.id === trasladoPendiente?.destino)?.nombre ?? "-" },
          { etiqueta: "Fecha", valor: trasladoPendiente?.fecha ?? "-" },
        ]}
        procesando={confirmando}
        etiquetaConfirmar="Confirmar traslado"
        onCancelar={() => setTrasladoPendiente(null)}
        onConfirmar={confirmarTraslado}
      />
    </section>
  );
}

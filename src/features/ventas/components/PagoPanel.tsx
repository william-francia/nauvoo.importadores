import {
  useMemo,
  useState,
} from "react";

import type {
  MetodoPago,
} from "../types/ventas.types";

interface Props {
  total: number;
  bloqueado?: boolean;

  procesando?: boolean;

  onPagar: (data: {
    metodo: MetodoPago;
    montoRecibido: number;
  }) => void;
}

function money(value: number) {
  return new Intl.NumberFormat(
    "es-BO",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  ).format(value);
}

export default function PagoPanel({
  total,
  bloqueado = false,
  procesando = false,
  onPagar,
}: Props) {
  const [metodo, setMetodo] =
    useState<MetodoPago>("EFECTIVO");

  const [
    montoRecibido,
    setMontoRecibido,
  ] = useState(0);

  const [
    ultimosDigitos,
    setUltimosDigitos,
  ] = useState("");

  const montoParaPago =
    metodo === "EFECTIVO"
      ? montoRecibido
      : total;

  const cambio = useMemo(
    () =>
      Math.max(
        0,
        montoParaPago - total
      ),
    [montoParaPago, total]
  );

  const faltante = Math.max(
    0,
    total - montoParaPago
  );

  const puedePagar =
    !bloqueado &&
    !procesando &&
    total > 0 &&
    montoParaPago >= total;

  return (
    <>
      <div className="venta-panel">
        <div className="venta-section-title">
          <span>
            Datos de transacción
          </span>
        </div>

        <div className="venta-field">
          <label>
            Moneda de venta
          </label>

          <select value="BOB" disabled>
            <option value="BOB">
              BOB - Boliviano
            </option>
          </select>
        </div>

        <div className="venta-grid-2">
          <div className="venta-field">
            <label>
              Método de pago
            </label>

            <select
              value={metodo}
              onChange={(e) =>
                setMetodo(
                  e.target
                    .value as MetodoPago
                )
              }
            >
              <option value="EFECTIVO">
                Efectivo
              </option>

              <option value="QR">
                QR
              </option>

              <option value="TARJETA">
                Tarjeta
              </option>

              <option value="TRANSFERENCIA">
                Transferencia
              </option>

              <option value="OTRO">
                Otro
              </option>
            </select>
          </div>

          <div className="venta-field">
            <label>
              Número de tarjeta
            </label>

            <input
              disabled={
                metodo !== "TARJETA"
              }
              maxLength={4}
              value={ultimosDigitos}
              onChange={(e) =>
                setUltimosDigitos(
                  e.target.value
                    .replace(/\D/g, "")
                    .slice(0, 4)
                )
              }
              placeholder="Últimos 4"
            />
          </div>
        </div>
      </div>

      <div className="venta-panel venta-payment">
        <div className="venta-payment__title">
          <span>Monto Pagar</span>

          <strong>
            {money(total)} BOB
          </strong>
        </div>

        <div className="venta-grid-2">
          <div className="venta-field">
            <label>
              Ingrese Monto
            </label>

            <input
              type="number"
              min="0"
              step="0.01"
              value={montoParaPago}
              disabled={metodo !== "EFECTIVO"}
              onChange={(e) =>
                setMontoRecibido(
                  Number(
                    e.target.value
                  )
                )
              }
            />
          </div>

          <div className="venta-field">
            <label>
              Vuelto / Saldo
            </label>

            <div
              className={
                faltante > 0
                  ? "venta-saldo venta-saldo--negative"
                  : "venta-saldo"
              }
            >
              {faltante > 0
                ? `Faltan ${money(
                    faltante
                  )}`
                : money(cambio)}
            </div>
          </div>
        </div>

        <button
          type="button"
          className="venta-pay-button"
          disabled={!puedePagar}
          onClick={() =>
            onPagar({
              metodo,
              montoRecibido: montoParaPago,
            })
          }
        >
          <span>●</span>

          {procesando
            ? "PROCESANDO..."
            : "REALIZAR PAGO"}
        </button>
      </div>
    </>
  );
}

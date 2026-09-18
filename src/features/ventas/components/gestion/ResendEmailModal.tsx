import { useState } from "react";
import type { FormEvent } from "react";

import type {
  GestionVenta,
} from "../../types/gestionVentas.types";

interface Props {
  venta: GestionVenta | null;

  onCerrar: () => void;

  onEnviar: (
    venta: GestionVenta,
    correos: string[]
  ) => void;
}

function correoValido(
  correo: string
) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    correo
  );
}

export default function ResendEmailModal(props: Props) {
  if (!props.venta) return null;
  return <ResendEmailModalContent key={props.venta.id} venta={props.venta} onCerrar={props.onCerrar} onEnviar={props.onEnviar} />;
}

function ResendEmailModalContent({
  venta,
  onCerrar,
  onEnviar,
}: Omit<Props, "venta"> & { venta: GestionVenta }) {
  const [correo, setCorreo] =
    useState("");

  const [correos, setCorreos] =
    useState<string[]>(venta.correoCliente ? [venta.correoCliente] : []);

  const [error, setError] =
    useState("");

  const ventaActual = venta;

  function agregarCorreo() {
    const email =
      correo
        .trim()
        .toLowerCase();

    if (!email) {
      return;
    }

    if (!correoValido(email)) {
      setError(
        "Ingresa un correo electrónico válido."
      );

      return;
    }

    if (correos.includes(email)) {
      setError(
        "Ese correo ya fue agregado."
      );

      return;
    }

    setCorreos((actuales) => [
      ...actuales,
      email,
    ]);

    setCorreo("");

    setError("");
  }

  function eliminarCorreo(
    email: string
  ) {
    setCorreos((actuales) =>
      actuales.filter(
        (item) => item !== email
      )
    );
  }

  function handleSubmit(
    event: FormEvent
  ) {
    event.preventDefault();

    if (correo.trim()) {
      const email =
        correo
          .trim()
          .toLowerCase();

      if (!correoValido(email)) {
        setError(
          "El correo pendiente no es válido."
        );

        return;
      }

      const nuevosCorreos =
        correos.includes(email)
          ? correos
          : [...correos, email];

      onEnviar(
        ventaActual,
        nuevosCorreos
      );

      return;
    }

    if (correos.length === 0) {
      setError(
        "Debes agregar al menos un correo."
      );

      return;
    }

    onEnviar(ventaActual, correos);
  }

  return (
    <div
      className="gestion-modal-backdrop"
      onMouseDown={onCerrar}
    >
      <div
        className="gestion-modal gestion-modal--email"
        onMouseDown={(event) =>
          event.stopPropagation()
        }
      >
        <header className="gestion-modal__header">
          <div>
            <h2>
              Reenviar factura
            </h2>

            <p>
              Factura #
              {venta.numeroFactura} ·{" "}
              {venta.razonSocial}
            </p>
          </div>

          <button
            type="button"
            className="gestion-modal__close"
            onClick={onCerrar}
          >
            ×
          </button>
        </header>

        <form
          onSubmit={handleSubmit}
        >
          <div className="gestion-modal__body">
            <div className="gestion-email-info">
              Podrás enviar la misma
              factura a uno o varios
              destinatarios.
            </div>

            <label className="gestion-field">
              <span>
                Agregar correo
              </span>

              <div className="gestion-email-add">
                <input
                  type="email"
                  value={correo}
                  onChange={(event) => {
                    setCorreo(
                      event.target.value
                    );

                    setError("");
                  }}
                  placeholder="cliente@correo.com"
                />

                <button
                  type="button"
                  onClick={
                    agregarCorreo
                  }
                >
                  + Agregar
                </button>
              </div>
            </label>

            <div className="gestion-email-list">
              <div className="gestion-email-list__title">
                Destinatarios
              </div>

              {correos.length === 0 ? (
                <div className="gestion-email-empty">
                  Aún no agregaste
                  destinatarios.
                </div>
              ) : (
                correos.map((email) => (
                  <div
                    className="gestion-email-chip"
                    key={email}
                  >
                    <span>✉</span>

                    <span>{email}</span>

                    <button
                      type="button"
                      aria-label={`Eliminar ${email}`}
                      onClick={() =>
                        eliminarCorreo(
                          email
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </div>

            {error && (
              <div className="gestion-form-error">
                {error}
              </div>
            )}
          </div>

          <footer className="gestion-modal__footer">
            <button
              type="button"
              className="gestion-button gestion-button--ghost"
              onClick={onCerrar}
            >
              Cancelar
            </button>

            <button
              type="submit"
              className="gestion-button gestion-button--primary"
            >
              ✉ Reenviar factura
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

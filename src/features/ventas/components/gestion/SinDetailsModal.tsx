import type {
  GestionVenta,
} from "../../types/gestionVentas.types";

interface Props {
  venta: GestionVenta | null;

  onCerrar: () => void;

  onReintentar?: (
    venta: GestionVenta
  ) => void;
}

export default function SinDetailsModal({
  venta,
  onCerrar,
  onReintentar,
}: Props) {
  if (!venta) {
    return null;
  }

  const sin = venta.sin;

  return (
    <div
      className="gestion-modal-backdrop"
      onMouseDown={onCerrar}
    >
      <div
        className="gestion-modal gestion-modal--sin"
        onMouseDown={(event) =>
          event.stopPropagation()
        }
      >
        <header className="gestion-modal__header">
          <div>
            <h2>
              Información del S.I.N.
            </h2>

            <p>
              Datos asociados a la factura
              #
              {venta.numeroFactura}
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

        <div className="gestion-modal__body">
          {!sin ? (
            <div className="gestion-empty-state">
              <span>◎</span>

              <strong>
                Información del S.I.N.
                todavía no disponible
              </strong>

              <p>
                Esta sección quedará
                conectada posteriormente
                al módulo de facturación.
              </p>
            </div>
          ) : (
            <>
              <div className="sin-caption">
                Información obtenida del
                S.I.N.
              </div>

              <div className="sin-details">
                <div>
                  <strong>CUF</strong>

                  <span>{sin.cuf}</span>
                </div>

                <div>
                  <strong>
                    Fecha emisión
                  </strong>

                  <span>
                    {sin.fechaEmision}
                  </span>
                </div>

                <div>
                  <strong>
                    Número factura
                  </strong>

                  <span>
                    {sin.numeroFactura}
                  </span>
                </div>

                <div>
                  <strong>
                    Código sucursal
                  </strong>

                  <span>
                    {sin.codigoSucursal}
                  </span>
                </div>

                <div>
                  <strong>
                    Código punto venta
                  </strong>

                  <span>
                    {
                      sin.codigoPuntoVenta
                    }
                  </span>
                </div>

                <div>
                  <strong>
                    Descripción
                  </strong>

                  <span>
                    {
                      sin.codigoDescripcion
                    }
                  </span>
                </div>

                <div>
                  <strong>
                    Código estado
                  </strong>

                  <span>
                    {sin.codigoEstado ??
                      "-"}
                  </span>
                </div>

                <div>
                  <strong>
                    Código recepción
                  </strong>

                  <span>
                    {sin.codigoRecepcion ??
                      "-"}
                  </span>
                </div>

                <div>
                  <strong>Log</strong>

                  <span>
                    {sin.log ?? "-"}
                  </span>
                </div>
              </div>

              <div className="sin-notice">
                Esta información será
                obtenida directamente del
                Servicio de Impuestos
                Nacionales cuando
                integremos el módulo de
                facturación.
              </div>
            </>
          )}
        </div>

        <footer className="gestion-modal__footer">
          <button
            type="button"
            className="gestion-button gestion-button--ghost"
            onClick={onCerrar}
          >
            Cerrar
          </button>

          <button
            type="button"
            className="gestion-button gestion-button--primary"
            onClick={() => {
              if (venta) {
                onReintentar?.(venta);
              }
            }}
          >
            Reintentar consulta
          </button>
        </footer>
      </div>
    </div>
  );
}
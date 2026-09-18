import FacturaActionsMenu from "./FacturaActionsMenu";

import type {
  FacturaAction,
  GestionVenta,
  GestionVentasFilters,
} from "../../types/gestionVentas.types";

interface Props {
  ventas: GestionVenta[];

  filters: GestionVentasFilters;

  onFilterChange: <
    K extends keyof GestionVentasFilters
  >(
    campo: K,
    valor: GestionVentasFilters[K]
  ) => void;

  onAction: (
    action: FacturaAction,
    venta: GestionVenta
  ) => void;
  canIssueInvoice?: boolean;
}

function money(
  value: number,
  moneda: string
) {
  return `${new Intl.NumberFormat(
    "es-BO",
    {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }
  ).format(value)} ${moneda}`;
}

function fecha(
  value: string
) {
  const date = new Date(value);

  if (
    Number.isNaN(date.getTime())
  ) {
    return value;
  }

  return new Intl.DateTimeFormat(
    "es-BO",
    {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",

      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",

      hour12: false,
    }
  ).format(date);
}

export default function GestionVentasTable({
  ventas,
  filters,
  onFilterChange,
  onAction,
  canIssueInvoice = false,
}: Props) {
  return (
    <div className="gestion-table-scroll">
      <table className="gestion-table">
        <thead>
          <tr>
            <th className="gestion-col-actions">
              Acciones
            </th>

            <th>
              Nro. Factura
            </th>

            <th>
              Fecha emisión
            </th>

            <th>
              Razón social
            </th>

            <th>
              Nro. Documento
            </th>

            <th className="gestion-text-right">
              Monto
            </th>

            <th>Usuario</th>

            <th>Estado</th>
          </tr>

          <tr className="gestion-filter-row">
            <th />

            <th>
              <input
                value={
                  filters.numeroFactura
                }
                onChange={(event) =>
                  onFilterChange(
                    "numeroFactura",
                    event.target.value
                  )
                }
                placeholder="Buscar factura..."
              />
            </th>

            <th />

            <th>
              <input
                value={
                  filters.razonSocial
                }
                onChange={(event) =>
                  onFilterChange(
                    "razonSocial",
                    event.target.value
                  )
                }
                placeholder="Buscar cliente..."
              />
            </th>

            <th>
              <input
                value={
                  filters.numeroDocumento
                }
                onChange={(event) =>
                  onFilterChange(
                    "numeroDocumento",
                    event.target.value
                  )
                }
                placeholder="Buscar documento..."
              />
            </th>

            <th />

            <th>
              <input
                value={
                  filters.usuario
                }
                onChange={(event) =>
                  onFilterChange(
                    "usuario",
                    event.target.value
                  )
                }
                placeholder="Buscar usuario..."
              />
            </th>

            <th />
          </tr>
        </thead>

        <tbody>
          {ventas.length === 0 ? (
            <tr>
              <td
                colSpan={8}
                className="gestion-table-empty"
              >
                <div>
                  <span>⌕</span>

                  <strong>
                    No encontramos ventas
                  </strong>

                  <p>
                    Prueba cambiando los
                    filtros de búsqueda.
                  </p>
                </div>
              </td>
            </tr>
          ) : (
            ventas.map((venta) => (
              <tr key={venta.id}>
                <td>
                  <FacturaActionsMenu
                    venta={venta}
                    onAction={
                      onAction
                    }
                    canIssueInvoice={canIssueInvoice}
                  />
                </td>

                <td>
                  <strong className="gestion-invoice-number">
                    #
                    {
                      venta.numeroFactura
                    }
                  </strong>
                </td>

                <td>
                  {fecha(
                    venta.fechaEmision
                  )}
                </td>

                <td>
                  <div className="gestion-client-cell">
                    <strong>
                      {
                        venta.razonSocial
                      }
                    </strong>
                  </div>
                </td>

                <td>
                  {
                    venta.numeroDocumento
                  }
                </td>

                <td className="gestion-text-right">
                  <strong>
                    {money(
                      venta.monto,
                      venta.moneda
                    )}
                  </strong>
                </td>

                <td>
                  {venta.usuario}
                </td>

                <td>
                  <span
                    className={`gestion-status gestion-status--${venta.estado.toLowerCase()}`}
                  >
                    {venta.estado}
                  </span>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

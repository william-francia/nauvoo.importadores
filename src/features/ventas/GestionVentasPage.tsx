/*
function GestionVentasPagePlaceholder() {
  return (
    <section className="placeholder-page">
      <div className="placeholder-icon">▤</div>
      <h1>Gestión de ventas</h1>
      <p>
        Esta sección queda preparada para el historial, filtros, detalle,
        estados, reimpresiones y operaciones posteriores de venta.
      </p>
      <span>Aún no hay operaciones de gestión conectadas.</span>
    </section>
  );
}

}
*/

import {
  useState,
} from "react";

import "../../features/ventas/styles/gestionVentas.css";

import GestionVentasTable from "../../features/ventas/components/gestion/GestionVentasTable";
import ResendEmailModal from "../../features/ventas/components/gestion/ResendEmailModal";
import SinDetailsModal from "../../features/ventas/components/gestion/SinDetailsModal";

import { GESTION_VENTAS_MOCK } from "../../features/ventas/data/gestionVentas.mock";

import { useGestionVentas } from "../../features/ventas/hooks/useGestionVentas";

import type {
  FacturaAction,
  GestionVenta,
} from "../../features/ventas/types/gestionVentas.types";

interface NotificationState {
  type:
    | "success"
    | "info"
    | "warning";

  message: string;
}

export default function GestionVentasPage() {
  const gestion =
    useGestionVentas(
      GESTION_VENTAS_MOCK
    );

  const [
    ventaSin,
    setVentaSin,
  ] =
    useState<GestionVenta | null>(
      null
    );

  const [
    ventaCorreo,
    setVentaCorreo,
  ] =
    useState<GestionVenta | null>(
      null
    );

  const [
    notification,
    setNotification,
  ] =
    useState<NotificationState | null>(
      null
    );

  function mostrarPendiente(
    mensaje: string
  ) {
    setNotification({
      type: "info",
      message: mensaje,
    });
  }

  function handleAction(
    action: FacturaAction,
    venta: GestionVenta
  ) {
    switch (action) {
      case "SIN":
        setVentaSin(venta);
        return;

      case "REENVIAR_CORREO":
        setVentaCorreo(venta);
        return;

      case "PDF_ROLLO":
        mostrarPendiente(
          `PDF en rollo de la factura #${venta.numeroFactura}. La interfaz está preparada; se conectará al módulo de facturación.`
        );
        return;

      case "PDF_MEDIO_OFICIO":
        mostrarPendiente(
          `PDF medio oficio de la factura #${venta.numeroFactura}. Se conectará cuando implementemos facturación.`
        );
        return;

      case "XML":
        mostrarPendiente(
          `XML de la factura #${venta.numeroFactura}. Esta acción quedará conectada al documento fiscal.`
        );
        return;

      case "URL_SIN":
        mostrarPendiente(
          `Consulta de URL del S.I.N. para la factura #${venta.numeroFactura}. Pendiente de integración.`
        );
        return;

      case "ANULAR":
        setNotification({
          type: "warning",

          message:
            `Anulación de factura #${venta.numeroFactura}: el botón ya está preparado, pero todavía no ejecutará una anulación fiscal hasta desarrollar el módulo de facturación.`,
        });

        return;
    }
  }

  function handleEnviarCorreos(
    venta: GestionVenta,
    correos: string[]
  ) {
    /*
     * Visual por ahora.
     *
     * Posteriormente:
     *
     * await reenviarFactura({
     *   ventaId: venta.id,
     *   correos,
     * });
     */

    setVentaCorreo(null);

    setNotification({
      type: "success",

      message:
        `Reenvío preparado para la factura #${venta.numeroFactura} a ${correos.length} correo${correos.length === 1 ? "" : "s"}. La conexión real se realizará con facturación.`,
    });
  }

  return (
    <div className="gestion-ventas-page">
      <header className="gestion-page-header">
        <div>
          <div className="gestion-breadcrumb">
            <span>Ventas</span>

            <span>›</span>

            <span>
              Gestión de ventas
            </span>
          </div>

          <h1>
            Gestión de Ventas
          </h1>

          <p>
            Consulta las ventas
            realizadas y administra los
            documentos asociados.
          </p>
        </div>

        <div className="gestion-page-actions">
          <button
            type="button"
            className="gestion-button gestion-button--outline"
            onClick={() =>
              mostrarPendiente(
                "La exportación general se conectará posteriormente."
              )
            }
          >
            ↓ Exportar
          </button>

          <button
            type="button"
            className="gestion-button gestion-button--outline"
            onClick={() =>
              mostrarPendiente(
                "La exportación detallada se conectará posteriormente."
              )
            }
          >
            ↓ Exportar detalles
          </button>
        </div>
      </header>

      {notification && (
        <div
          className={`gestion-notification gestion-notification--${notification.type}`}
        >
          <span>
            {notification.type ===
            "success"
              ? "✓"
              : notification.type ===
                  "warning"
                ? "!"
                : "i"}
          </span>

          <p>
            {
              notification.message
            }
          </p>

          <button
            type="button"
            onClick={() =>
              setNotification(null)
            }
          >
            ×
          </button>
        </div>
      )}

      <section className="gestion-card">
        <div className="gestion-card-header">
          <div>
            <h2>
              Ventas registradas
            </h2>

            <span>
              {
                gestion
                  .ventasFiltradas
                  .length
              }{" "}
              resultado
              {gestion
                .ventasFiltradas
                .length === 1
                ? ""
                : "s"}
            </span>
          </div>

          <button
            type="button"
            className="gestion-clear-filters"
            onClick={
              gestion.limpiarFiltros
            }
          >
            ↻ Limpiar filtros
          </button>
        </div>

        <GestionVentasTable
          ventas={
            gestion.ventasPagina
          }
          filters={
            gestion.filters
          }
          onFilterChange={
            gestion.actualizarFiltro
          }
          onAction={
            handleAction
          }
        />

        <footer className="gestion-pagination">
          <div className="gestion-page-size">
            <span>
              Filas por página
            </span>

            <select
              value={
                gestion.porPagina
              }
              onChange={(event) => {
                gestion.setPorPagina(
                  Number(
                    event.target.value
                  )
                );

                gestion.setPagina(1);
              }}
            >
              <option value={10}>
                10
              </option>

              <option value={20}>
                20
              </option>

              <option value={50}>
                50
              </option>
            </select>
          </div>

          <div className="gestion-pagination__info">
            {gestion.desde}-
            {gestion.hasta} de{" "}
            {
              gestion
                .ventasFiltradas
                .length
            }
          </div>

          <div className="gestion-pagination__buttons">
            <button
              type="button"
              disabled={
                gestion.pagina <= 1
              }
              onClick={() =>
                gestion.setPagina(
                  gestion.pagina - 1
                )
              }
            >
              ‹
            </button>

            <span>
              {gestion.pagina} /{" "}
              {
                gestion.totalPaginas
              }
            </span>

            <button
              type="button"
              disabled={
                gestion.pagina >=
                gestion.totalPaginas
              }
              onClick={() =>
                gestion.setPagina(
                  gestion.pagina + 1
                )
              }
            >
              ›
            </button>
          </div>
        </footer>
      </section>

      <SinDetailsModal
        venta={ventaSin}
        onCerrar={() =>
          setVentaSin(null)
        }
        onReintentar={(venta) =>
          mostrarPendiente(
            `Consulta al S.I.N. de la factura #${venta.numeroFactura} pendiente de integración.`
          )
        }
      />

      <ResendEmailModal
        venta={ventaCorreo}
        onCerrar={() =>
          setVentaCorreo(null)
        }
        onEnviar={
          handleEnviarCorreos
        }
      />
    </div>
  );
}

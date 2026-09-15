import {
  AlertTriangle,
  X,
} from "lucide-react";

import type {
  ReporteIssue,
} from "../types/reportes.types";

interface Props {
  abierto: boolean;

  issues: ReporteIssue[];

  onCerrar: () => void;

  onIngresarDatos: () => void;
}

export default function FaltanDatosModal({
  abierto,

  issues,

  onCerrar,

  onIngresarDatos,
}: Props) {
  if (!abierto) {
    return null;
  }

  const manuales =
    issues.some(
      (issue) =>
        issue.tipo ===
        "MANUAL"
    );

  return (
    <div
      className="report-modal-backdrop"
      onMouseDown={onCerrar}
    >
      <div
        className="report-modal"
        onMouseDown={(event) =>
          event.stopPropagation()
        }
      >
        <header className="report-modal__header">
          <div>
            <AlertTriangle
              size={20}
            />

            <div>
              <h2>
                Faltan datos para completar el reporte
              </h2>

              <p>
                Corrige la información antes
                de descargar.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onCerrar}
          >
            <X
              size={18}
            />
          </button>
        </header>

        <div className="report-modal__body">
          {issues.map(
            (issue) => (
              <div
                key={issue.id}
                className="missing-data-item"
              >
                <strong>
                  {issue.titulo}
                </strong>

                <span>
                  {issue.descripcion}
                </span>

                <small>
                  {issue.tipo ===
                  "MANUAL"
                    ? "Dato complementario"
                    : "Debe corregirse en los datos originales"}
                </small>
              </div>
            )
          )}
        </div>

        <footer className="report-modal__footer">
          <button
            type="button"
            className="reports-btn reports-btn--ghost"
            onClick={onCerrar}
          >
            Cancelar
          </button>

          {manuales && (
            <button
              type="button"
              className="reports-btn reports-btn--primary"
              onClick={
                onIngresarDatos
              }
            >
              Ingresar datos
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
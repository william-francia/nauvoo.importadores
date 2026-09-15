// src/features/productos/components/ProductoPreviewModal.tsx

import {
  LOCALES,
} from "../constants/productos.constants";

import type {
  Producto,
} from "../types/productos.types";

import {
  calcularInventarioTotal,
  obtenerEstadoStockProducto,
  obtenerTextoEstado,
} from "../utils/productos.utils";

interface Props {
  producto: Producto | null;
  onCerrar: () => void;
  onEditar: (
    producto: Producto
  ) => void;
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

export default function ProductoPreviewModal({
  producto,
  onCerrar,
  onEditar,
}: Props) {
  if (!producto) {
    return null;
  }

  const total =
    calcularInventarioTotal(
      producto.stockPorLocal
    );

  const estado =
    obtenerEstadoStockProducto(
      producto
    );

  return (
    <div
      className="producto-modal-backdrop"
      onMouseDown={onCerrar}
    >
      <div
        className="producto-preview-modal"
        onMouseDown={(event) =>
          event.stopPropagation()
        }
      >
        <header className="producto-modal-header">
          <div>
            <span className="producto-modal-overline">
              Producto
            </span>

            <h2>
              {producto.nombre}
            </h2>

            <p>
              SKU:{" "}
              {producto.sku ||
                "Sin SKU"}
            </p>
          </div>

          <button
            type="button"
            onClick={onCerrar}
          >
            ×
          </button>
        </header>

        <div className="producto-preview-body">
          <div className="producto-preview-description">
            {producto.descripcion ||
              "Sin descripción"}
          </div>

          <div className="producto-preview-grid">
            <div>
              <span>
                Actividad económica
              </span>

              <strong>
                {
                  producto.actividadEconomicaCodigo
                }
              </strong>
            </div>

            <div>
              <span>
                Unidad
              </span>

              <strong>
                {
                  producto.unidadMedida
                }
              </strong>
            </div>

            <div>
              <span>
                Precio
              </span>

              <strong>
                {money(
                  producto.precio
                )}{" "}
                BOB
              </strong>
            </div>

            <div>
              <span>
                Inventario total
              </span>

              <strong>
                {total}
              </strong>
            </div>
          </div>

          <div className="producto-preview-stock">
            <h3>
              Stock por local
            </h3>

            {LOCALES.map(
              (local) => (
                <div
                  key={
                    local.id
                  }
                >
                  <span>
                    {
                      local.nombre
                    }
                  </span>

                  <strong>
                    {
                      producto
                        .stockPorLocal[
                        local.id
                      ]
                    }
                  </strong>
                </div>
              )
            )}
          </div>

          <div
            className={`producto-status producto-status--${estado.toLowerCase()}`}
          >
            {obtenerTextoEstado(
              estado
            )}
          </div>
        </div>

        <footer className="producto-modal-footer">
          <button
            type="button"
            className="productos-btn productos-btn--ghost"
            onClick={onCerrar}
          >
            Cerrar
          </button>

          <button
            type="button"
            className="productos-btn productos-btn--primary"
            onClick={() =>
              onEditar(producto)
            }
          >
            ✎ Editar producto
          </button>
        </footer>
      </div>
    </div>
  );
}
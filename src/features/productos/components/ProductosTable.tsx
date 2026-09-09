// src/features/productos/components/ProductosTable.tsx

import {
  LOCALES,
} from "../constants/productos.constants";

import type {
  GestionProductosFilters,
  Producto,
} from "../types/productos.types";

import {
  calcularInventarioTotal,
  obtenerEstadoStockProducto,
  obtenerTextoEstado,
} from "../utils/productos.utils";

interface Props {
  productos: Producto[];

  filters: GestionProductosFilters;

  seleccionados: Set<string>;

  onFilterChange: <
    K extends keyof GestionProductosFilters
  >(
    key: K,
    value: GestionProductosFilters[K]
  ) => void;

  onToggleProducto: (
    id: string
  ) => void;

  onTogglePagina: () => void;

  onPreview: (
    producto: Producto
  ) => void;

  onEdit: (
    producto: Producto
  ) => void;
}

function StockChip({
  value,
}: {
  value: number;
}) {
  return (
    <span
      className={
        value === 0
          ? "producto-stock-chip producto-stock-chip--zero"
          : "producto-stock-chip"
      }
    >
      {value}
    </span>
  );
}

export default function ProductosTable({
  productos,

  filters,

  seleccionados,

  onFilterChange,

  onToggleProducto,

  onTogglePagina,

  onPreview,

  onEdit,
}: Props) {
  const todosSeleccionados =
    productos.length > 0 &&
    productos.every((item) =>
      seleccionados.has(item.id)
    );

  return (
    <div className="productos-table-scroll">
      <table className="productos-table">
        <thead>
          <tr>
            <th className="productos-col-actions">
              Acciones
            </th>

            <th className="productos-col-check">
              <input
                type="checkbox"
                checked={
                  todosSeleccionados
                }
                onChange={
                  onTogglePagina
                }
              />
            </th>

            <th>
              Act.Eco.
            </th>

            <th className="productos-col-producto">
              Producto
            </th>

            <th>
              Inventario
            </th>

            {LOCALES.map(
              (local) => (
                <th
                  key={
                    local.id
                  }
                  className="productos-local-column"
                  title={
                    local.nombre
                  }
                >
                  {local.corto}
                </th>
              )
            )}

            <th>Estado</th>
          </tr>

          <tr className="productos-filters">
            <th />

            <th />

            <th>
              <input
                value={
                  filters.actividadEconomica
                }
                placeholder="Filtrar..."
                onChange={(event) =>
                  onFilterChange(
                    "actividadEconomica",
                    event.target.value
                  )
                }
              />
            </th>

            <th>
              <input
                value={
                  filters.producto
                }
                placeholder="Filtrar por producto..."
                onChange={(event) =>
                  onFilterChange(
                    "producto",
                    event.target.value
                  )
                }
              />
            </th>

            <th>
              <input
                value={
                  filters.inventario
                }
                placeholder="Inventario..."
                onChange={(event) =>
                  onFilterChange(
                    "inventario",
                    event.target.value
                  )
                }
              />
            </th>

            {LOCALES.map(
              (local) => (
                <th
                  key={
                    local.id
                  }
                />
              )
            )}

            <th />
          </tr>
        </thead>

        <tbody>
          {productos.length ===
          0 ? (
            <tr>
              <td
                colSpan={
                  6 +
                  LOCALES.length
                }
                className="productos-empty"
              >
                <strong>
                  No encontramos
                  productos
                </strong>

                <span>
                  Cambia los filtros de
                  búsqueda.
                </span>
              </td>
            </tr>
          ) : (
            productos.map(
              (producto) => {
                const total =
                  calcularInventarioTotal(
                    producto.stockPorLocal
                  );

                const estado =
                  obtenerEstadoStockProducto(
                    producto
                  );

                const seleccionado =
                  seleccionados.has(
                    producto.id
                  );

                return (
                  <tr
                    key={
                      producto.id
                    }
                    className={
                      seleccionado
                        ? "productos-row productos-row--selected"
                        : "productos-row"
                    }
                  >
                    <td>
                      <ProductoRowActions
                        onPreview={() => onPreview(producto)}
                        onEdit={() => onEdit(producto)}
                      />
                    </td>

                    <td>
                      <input
                        type="checkbox"
                        checked={
                          seleccionado
                        }
                        onChange={() =>
                          onToggleProducto(
                            producto.id
                          )
                        }
                      />
                    </td>

                    <td>
                      {
                        producto.actividadEconomicaCodigo
                      }
                    </td>

                    <td>
                      <button
                        type="button"
                        className="producto-name-button"
                        onClick={() =>
                          onPreview(
                            producto
                          )
                        }
                      >
                        {
                          producto.nombre
                        }
                      </button>

                      {producto.sku && (
                        <span className="producto-table-sku">
                          SKU:{" "}
                          {
                            producto.sku
                          }
                        </span>
                      )}
                    </td>

                    <td>
                      <span className="producto-inventory-total">
                        {total} items
                      </span>
                    </td>

                    {LOCALES.map(
                      (local) => (
                        <td
                          key={
                            local.id
                          }
                          className="productos-local-cell"
                        >
                          <StockChip
                            value={
                              producto
                                .stockPorLocal[
                                local.id
                              ]
                            }
                          />
                        </td>
                      )
                    )}

                    <td>
                      <span
                        className={`producto-status producto-status--${estado.toLowerCase()}`}
                      >
                        {obtenerTextoEstado(
                          estado
                        )}
                      </span>
                    </td>
                  </tr>
                );
              }
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
import ProductoRowActions from "./ProductoRowActions";

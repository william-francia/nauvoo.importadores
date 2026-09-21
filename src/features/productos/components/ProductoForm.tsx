// src/features/productos/components/ProductoForm.tsx

import { useState } from "react";
import type { FormEvent } from "react";

import {
  LOCALES,
  PROVEEDORES,
  TIPOS_PRODUCTO,
  UNIDADES_MEDIDA,
} from "../constants/productos.constants";

import type {
  ProductoFormValues,
  StockPorLocal,
} from "../types/productos.types";

interface Props {
  mode:
    | "create"
    | "edit";

  initialValues: ProductoFormValues;

  stockActual?: StockPorLocal;

  guardando?: boolean;

  errorExterno?: string | null;

  onSubmit: (
    values: ProductoFormValues
  ) => Promise<void> | void;

  onCancelar: () => void;
}

export default function ProductoForm({
  mode,

  initialValues,

  stockActual = {
    uquisamana: 0,
    isac_tamayo: 0,
    calacoto: 0,
    santa_cruz: 0,
  },

  guardando = false,

  errorExterno,

  onSubmit,

  onCancelar,
}: Props) {
  const [form, setForm] =
    useState<ProductoFormValues>(
      initialValues
    );

  const [error, setError] =
    useState("");

  function setField<
    K extends keyof ProductoFormValues
  >(
    key: K,
    value: ProductoFormValues[K]
  ) {
    setForm((current) => ({
      ...current,
      [key]: value,
    }));

    setError("");
  }

  async function handleSubmit(
    event: FormEvent
  ) {
    event.preventDefault();

    if (!form.nombre.trim()) {
      setError(
        "Ingresa el nombre del producto."
      );

      return;
    }

    if (!form.unidadMedida) {
      setError(
        "Selecciona una unidad de medida."
      );

      return;
    }

    if (!form.sku.trim()) {
      setError("Ingresa el SKU o código interno del producto.");
      return;
    }

    if (
      Number(form.precio) < 0
    ) {
      setError(
        "El precio no puede ser negativo."
      );

      return;
    }

    await onSubmit(form);
  }

  return (
    <form
      className="producto-form"
      onSubmit={
        handleSubmit
      }
    >
      <div className="producto-form-top">
        <div className="producto-form-main">
          <section className="producto-form-section">
            <h2>
              INFORMACIÓN DEL PRODUCTO
            </h2>

            <label className="producto-field">
              <span>
                Nombre Producto *
              </span>

              <input
                value={
                  form.nombre
                }
                onChange={(event) =>
                  setField(
                    "nombre",
                    event.target.value
                  )
                }
                placeholder="Nombre Producto"
              />
            </label>

            <label className="producto-field">
              <span>
                Descripción
              </span>

              <textarea
                value={
                  form.descripcion
                }
                onChange={(event) =>
                  setField(
                    "descripcion",
                    event.target.value
                  )
                }
                placeholder="Descripción del producto"
              />
            </label>
          </section>

          <section className="producto-form-section">
            <h2>
              PRECIO - UNIDAD MEDIDA
            </h2>

            <label className="producto-field">
              <span>
                Unidad Medida *
              </span>

              <select
                value={
                  form.unidadMedida
                }
                onChange={(event) =>
                  setField(
                    "unidadMedida",
                    event.target.value
                  )
                }
              >
                <option value="">
                  Seleccione la unidad de medida
                </option>

                {UNIDADES_MEDIDA.map(
                  (unidad) => (
                    <option
                      key={unidad}
                      value={unidad}
                    >
                      {unidad}
                    </option>
                  )
                )}
              </select>
            </label>

            <div className="producto-form-grid-3">
              <label className="producto-field">
                <span>
                  Precio *
                </span>

                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    form.precio
                  }
                  onChange={(event) =>
                    setField(
                      "precio",
                      Number(
                        event.target
                          .value
                      )
                    )
                  }
                />
              </label>

              <label className="producto-field">
                <span>
                  Precio de comparación
                </span>

                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    form.precioComparacion
                  }
                  onChange={(event) =>
                    setField(
                      "precioComparacion",
                      Number(
                        event.target
                          .value
                      )
                    )
                  }
                />

                <small>
                  Introduce 0 si no
                  deseas registrar
                </small>
              </label>

              <label className="producto-field">
                <span>
                  Costo
                </span>

                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={
                    form.costo
                  }
                  onChange={(event) =>
                    setField(
                      "costo",
                      Number(
                        event.target
                          .value
                      )
                    )
                  }
                />

                <small>
                  Información interna
                </small>
              </label>
            </div>
          </section>

          <section className="producto-form-section">
            <h2>
              INVENTARIO
            </h2>

            <div className="producto-form-grid-2">
              <label className="producto-field">
                <span>SKU</span>

                <input
                  value={
                    form.sku
                  }
                  onChange={(event) =>
                    setField(
                      "sku",
                      event.target.value
                    )
                  }
                  placeholder="SKU (Código de producto)"
                />
              </label>

              <label className="producto-field">
                <span>
                  Código de Barras
                </span>

                <input
                  value={
                    form.codigoBarras
                  }
                  onChange={(event) =>
                    setField(
                      "codigoBarras",
                      event.target.value
                    )
                  }
                  placeholder="Código de barras"
                />
              </label>
            </div>

            <div className="producto-inventory-notice">
              <strong>
                Las cantidades no se
                modifican desde aquí.
              </strong>

              <span>
                La entrada, salida y
                distribución entre
                locales se realizará
                desde “Inventario de
                productos”.
              </span>
            </div>

            <div className="producto-form-stock-table">
              <div className="producto-form-stock-header">
                <span>Local</span>

                <span>
                  Cantidad actual
                </span>
              </div>

              {LOCALES.map(
                (local) => (
                  <div
                    key={
                      local.id
                    }
                    className="producto-form-stock-row"
                  >
                    <span>
                      {
                        local.nombre
                      }
                    </span>

                    <strong>
                      {
                        stockActual[
                          local.id
                        ]
                      }
                    </strong>
                  </div>
                )
              )}
            </div>
          </section>

          <section className="producto-form-section">
            <h2>OPCIONES</h2>

            <label className="producto-options-checkbox">
              <input
                type="checkbox"
                checked={
                  form.tieneOpciones
                }
                onChange={(event) =>
                  setField(
                    "tieneOpciones",
                    event.target.checked
                  )
                }
              />

              <span>
                Este producto tiene
                opciones como talla,
                marca, color, medida,
                etc.
              </span>
            </label>
          </section>
        </div>

        <aside className="producto-form-sidebar">
          <section className="producto-form-section">
            <h2>
              Clasificador de productos
            </h2>

            <label className="producto-field">
              <span>
                Tipo Producto
              </span>

              <select
                value={
                  form.tipoProducto
                }
                onChange={(event) =>
                  setField(
                    "tipoProducto",
                    event.target.value
                  )
                }
              >
                <option value="">
                  Seleccione...
                </option>

                {TIPOS_PRODUCTO.map(
                  (tipo) => (
                    <option
                      key={tipo}
                      value={tipo}
                    >
                      {tipo}
                    </option>
                  )
                )}
              </select>
            </label>
          </section>

          <section className="producto-form-section">
            <h2>Proveedor</h2>

            <label className="producto-field">
              <span>
                Seleccione su proveedor
              </span>

              <select
                value={
                  form.proveedor
                }
                onChange={(event) =>
                  setField(
                    "proveedor",
                    event.target.value
                  )
                }
              >
                <option value="">
                  Seleccione proveedor...
                </option>

                {PROVEEDORES.map(
                  (proveedor) => (
                    <option
                      key={
                        proveedor
                      }
                      value={
                        proveedor
                      }
                    >
                      {proveedor}
                    </option>
                  )
                )}
              </select>
            </label>
          </section>
        </aside>
      </div>

      {(error || errorExterno) && (
        <div className="producto-form-error">
          {error || errorExterno}
        </div>
      )}

      <div className="producto-form-actions">
        <button
          type="button"
          className="productos-btn productos-btn--ghost"
          onClick={
            onCancelar
          }
          disabled={
            guardando
          }
        >
          Cancelar
        </button>

        <button
          type="submit"
          className="productos-btn productos-btn--primary"
          disabled={
            guardando
          }
        >
          ▣{" "}
          {guardando
            ? "Guardando..."
            : mode === "create"
              ? "Registrar Producto"
              : "Guardar Cambios"}
        </button>
      </div>
    </form>
  );
}

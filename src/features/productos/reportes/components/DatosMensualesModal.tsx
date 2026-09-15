import {
  useState,
} from "react";

import type {
  FormEvent,
} from "react";

import {
  X,
} from "lucide-react";

import type {
  DatosMensualesComplementarios,
} from "../types/reportes.types";

interface Props {
  mes: string;

  valores:
    DatosMensualesComplementarios;

  onCerrar: () => void;

  onGuardar: (
    value: DatosMensualesComplementarios
  ) => void;
}

export default function DatosMensualesModal({
  mes,

  valores,

  onCerrar,

  onGuardar,
}: Props) {
  const [form, setForm] =
    useState(valores);

  function numberValue(
    value: string
  ) {
    if (
      value.trim() === ""
    ) {
      return null;
    }

    return Number(value);
  }

  function submit(
    event: FormEvent
  ) {
    event.preventDefault();

    onGuardar(form);
  }

  return (
    <div
      className="report-modal-backdrop"
      onMouseDown={onCerrar}
    >
      <form
        className="report-modal report-modal--large"
        onSubmit={submit}
        onMouseDown={(event) =>
          event.stopPropagation()
        }
      >
        <header className="report-modal__header">
          <div>
            <div>
              <h2>
                Datos complementarios
              </h2>

              <p>
                Período {mes}
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

        <div className="report-modal__body report-manual-grid">
          <label>
            IVA crédito fiscal

            <input
              type="number"
              step="0.01"
              value={
                form.ivaCreditoFiscal ??
                ""
              }
              onChange={(event) =>
                setForm({
                  ...form,

                  ivaCreditoFiscal:
                    numberValue(
                      event.target.value
                    ),
                })
              }
            />
          </label>

          <label>
            IT declarado / estimado

            <input
              type="number"
              step="0.01"
              value={
                form.itDeclaradoOEstimado ??
                ""
              }
              onChange={(event) =>
                setForm({
                  ...form,

                  itDeclaradoOEstimado:
                    numberValue(
                      event.target.value
                    ),
                })
              }
            />
          </label>

          <label>
            IUE estimado

            <input
              type="number"
              step="0.01"
              value={
                form.iueEstimado ??
                ""
              }
              onChange={(event) =>
                setForm({
                  ...form,

                  iueEstimado:
                    numberValue(
                      event.target.value
                    ),
                })
              }
            />
          </label>

          <label>
            Saldo inicial caja

            <input
              type="number"
              step="0.01"
              value={
                form.saldoInicialCaja ??
                ""
              }
              onChange={(event) =>
                setForm({
                  ...form,

                  saldoInicialCaja:
                    numberValue(
                      event.target.value
                    ),
                })
              }
            />
          </label>

          <label>
            Saldo inicial bancos

            <input
              type="number"
              step="0.01"
              value={
                form.saldoInicialBancos ??
                ""
              }
              onChange={(event) =>
                setForm({
                  ...form,

                  saldoInicialBancos:
                    numberValue(
                      event.target.value
                    ),
                })
              }
            />
          </label>

          <label>
            Otros ingresos

            <input
              type="number"
              step="0.01"
              value={
                form.otrosIngresos
              }
              onChange={(event) =>
                setForm({
                  ...form,

                  otrosIngresos:
                    Number(
                      event.target.value
                    ),
                })
              }
            />
          </label>

          <label>
            Otros gastos

            <input
              type="number"
              step="0.01"
              value={
                form.otrosGastos
              }
              onChange={(event) =>
                setForm({
                  ...form,

                  otrosGastos:
                    Number(
                      event.target.value
                    ),
                })
              }
            />
          </label>

          <label>
            Gastos operativos adicionales

            <input
              type="number"
              step="0.01"
              value={
                form.gastosOperativosAdicionales
              }
              onChange={(event) =>
                setForm({
                  ...form,

                  gastosOperativosAdicionales:
                    Number(
                      event.target.value
                    ),
                })
              }
            />
          </label>

          <label>
            Gastos financieros adicionales

            <input
              type="number"
              step="0.01"
              value={
                form.gastosFinancierosAdicionales
              }
              onChange={(event) =>
                setForm({
                  ...form,

                  gastosFinancierosAdicionales:
                    Number(
                      event.target.value
                    ),
                })
              }
            />
          </label>
        </div>

        <footer className="report-modal__footer">
          <button
            type="button"
            className="reports-btn reports-btn--ghost"
            onClick={onCerrar}
          >
            Cancelar
          </button>

          <button
            type="submit"
            className="reports-btn reports-btn--primary"
          >
            Guardar datos
          </button>
        </footer>
      </form>
    </div>
  );
}

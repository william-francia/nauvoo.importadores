import { useState } from "react";
import type { FormEvent } from "react";
import { crearClienteRapido } from "../services/ventas.api";
import type {
  ClienteVenta,
  NuevoClienteInput,
  TipoDocumento,
} from "../types/ventas.types";

interface Props {
  abierto: boolean;
  onCerrar: () => void;
  onClienteCreado: (cliente: ClienteVenta) => void;
}

const initialForm: NuevoClienteInput = {
  tipo_documento: "CI",
  nombre_razon_social: "",
  numero_documento: "",
  correo: "",
  telefono: "",
};

export default function NuevoClienteModal({
  abierto,
  onCerrar,
  onClienteCreado,
}: Props) {
  const [form, setForm] = useState<NuevoClienteInput>(initialForm);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!abierto) return null;

  function change(key: keyof NuevoClienteInput, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setGuardando(true);

    try {
      const cliente = await crearClienteRapido(form);
      onClienteCreado(cliente);
      setForm(initialForm);
      onCerrar();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo registrar el cliente.");
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="venta-modal-backdrop" role="presentation">
      <form className="venta-modal" onSubmit={submit}>
        <header className="venta-modal__header">
          <div>
            <h2>Nuevo cliente</h2>
            <p>Se registrará y seleccionará para esta venta.</p>
          </div>
          <button className="venta-icon-button" type="button" onClick={onCerrar} aria-label="Cerrar">
            ×
          </button>
        </header>

        <div className="venta-modal__body">
          {error && <div className="venta-alert venta-alert--error">{error}</div>}

          <div className="venta-field">
            <label>Nombre o razón social</label>
            <input required value={form.nombre_razon_social} onChange={(event) => change("nombre_razon_social", event.target.value)} />
          </div>
          <div className="venta-field">
            <label>Tipo de documento</label>
            <select value={form.tipo_documento} onChange={(event) => change("tipo_documento", event.target.value as TipoDocumento)}>
              <option value="CI">CI</option>
              <option value="NIT">NIT</option>
              <option value="PASAPORTE">Pasaporte</option>
              <option value="CEX">CEX</option>
              <option value="OTRO">Otro</option>
            </select>
          </div>
          <div className="venta-field">
            <label>Número de documento</label>
            <input required value={form.numero_documento} onChange={(event) => change("numero_documento", event.target.value)} />
          </div>
          <div className="venta-field">
            <label>Correo electrónico</label>
            <input required type="email" value={form.correo} onChange={(event) => change("correo", event.target.value)} />
          </div>
          <div className="venta-field">
            <label>Teléfono</label>
            <input value={form.telefono} onChange={(event) => change("telefono", event.target.value)} />
          </div>
        </div>

        <footer className="venta-modal__footer">
          <button className="venta-button venta-button--ghost" type="button" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </button>
          <button className="venta-button venta-button--primary" type="submit" disabled={guardando}>
            {guardando ? "Guardando..." : "Guardar cliente"}
          </button>
        </footer>
      </form>
    </div>
  );
}

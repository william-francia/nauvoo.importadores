import { useState } from "react";
import type { FormEvent } from "react";
import { AlertCircle, Info, Save, X } from "lucide-react";
import { crearClienteRapido } from "../services/ventas.api";
import type {
  ClienteVenta,
  NuevoClienteInput,
  TipoDocumento,
} from "../types/ventas.types";
import "../../../pages/clientes/ClientesPage.css";

interface Props {
  abierto: boolean;
  onCerrar: () => void;
  onClienteCreado: (cliente: ClienteVenta) => void;
}

const initialForm: NuevoClienteInput = {
  tipo_documento: "CI",
  nombre_razon_social: "",
  numero_documento: "",
  complemento: "",
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
    <div className="clients-modal-overlay" role="presentation" onMouseDown={onCerrar}>
      <form className="clients-modal clients-form-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}>
        <header className="clients-modal-header">
          <div>
            <span className="clients-modal-eyebrow">Nuevo registro</span>
            <h2>Registrar nuevo cliente</h2>
          </div>
          <button className="clients-modal-close" type="button" onClick={onCerrar} aria-label="Cerrar">
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="clients-modal-body">
          {error && <div className="clients-form-error"><AlertCircle aria-hidden="true" />{error}</div>}

          <div className="clients-form-grid">
            <label className="clients-field clients-field-full">
              <span>Tipo Documento Identidad<strong>*</strong></span>
              <select required value={form.tipo_documento} onChange={(event) => change("tipo_documento", event.target.value as TipoDocumento)}>
                <option value="CI">CI - CÉDULA DE IDENTIDAD</option>
                <option value="CEX">CEX - CÉDULA DE EXTRANJERO</option>
                <option value="NIT">NIT</option>
                <option value="PASAPORTE">PASAPORTE</option>
                <option value="OTRO">OTRO DOCUMENTO</option>
              </select>
            </label>

            <label className="clients-field clients-field-full">
              <span>Razón Social / Nombre<strong>*</strong></span>
              <input autoFocus required type="text" placeholder="Ej. Juan Pérez o Empresa S.R.L." value={form.nombre_razon_social} onChange={(event) => change("nombre_razon_social", event.target.value)} />
            </label>

            <label className="clients-field">
              <span>Número Documento<strong>*</strong></span>
              <input required type="text" placeholder="Número de documento" value={form.numero_documento} onChange={(event) => change("numero_documento", event.target.value)} />
            </label>

            <label className="clients-field">
              <span>Complemento</span>
              <input type="text" placeholder="Ej. 1A" value={form.complemento ?? ""} onChange={(event) => change("complemento", event.target.value)} />
            </label>

            <label className="clients-field">
              <span>Correo Electrónico<strong>*</strong></span>
              <input required type="email" placeholder="cliente@correo.com" value={form.correo} onChange={(event) => change("correo", event.target.value)} />
            </label>

            <label className="clients-field">
              <span>Teléfonos</span>
              <input type="tel" placeholder="Ej. 70000000" value={form.telefono ?? ""} onChange={(event) => change("telefono", event.target.value)} />
            </label>
          </div>

          <div className="clients-form-info">
            <Info aria-hidden="true" />
            <div>
              <strong>El código del cliente se generará automáticamente.</strong>
              <span>El cliente quedará habilitado y seleccionado para esta venta.</span>
            </div>
          </div>
        </div>

        <footer className="clients-modal-footer">
          <button className="clients-modal-cancel" type="button" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </button>
          <button className="clients-modal-save" type="submit" disabled={guardando}>
            <Save aria-hidden="true" />
            {guardando ? "Guardando..." : "Guardar nuevo cliente"}
          </button>
        </footer>
      </form>
    </div>
  );
}

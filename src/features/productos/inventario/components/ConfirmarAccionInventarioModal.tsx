import { AlertTriangle, X } from "lucide-react";

interface Detalle {
  etiqueta: string;
  valor: string | number;
}

interface Props {
  abierto: boolean;
  titulo: string;
  descripcion: string;
  detalles: Detalle[];
  procesando?: boolean;
  etiquetaConfirmar: string;
  onCancelar: () => void;
  onConfirmar: () => void | Promise<void>;
}

export default function ConfirmarAccionInventarioModal({
  abierto,
  titulo,
  descripcion,
  detalles,
  procesando = false,
  etiquetaConfirmar,
  onCancelar,
  onConfirmar,
}: Props) {
  if (!abierto) return null;

  return (
    <div className="inv-confirm-backdrop" role="presentation" onMouseDown={procesando ? undefined : onCancelar}>
      <section className="inv-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="inv-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <span className="inv-confirm-icon"><AlertTriangle size={24} aria-hidden="true" /></span>
          <div>
            <h2 id="inv-confirm-title">{titulo}</h2>
            <p>{descripcion}</p>
          </div>
          <button type="button" onClick={onCancelar} disabled={procesando} aria-label="Cerrar confirmación"><X size={20} /></button>
        </header>

        <div className="inv-confirm-details">
          {detalles.map((detalle) => <div key={detalle.etiqueta}><span>{detalle.etiqueta}</span><strong>{detalle.valor}</strong></div>)}
        </div>

        <p className="inv-confirm-warning">Esta acción modificará el inventario y quedará registrada en el historial.</p>

        <footer>
          <button type="button" className="inv-button inv-button--ghost" onClick={onCancelar} disabled={procesando}>Cancelar</button>
          <button type="button" className="inv-button inv-button--primary" onClick={() => void onConfirmar()} disabled={procesando}>
            {procesando ? "Confirmando..." : etiquetaConfirmar}
          </button>
        </footer>
      </section>
    </div>
  );
}

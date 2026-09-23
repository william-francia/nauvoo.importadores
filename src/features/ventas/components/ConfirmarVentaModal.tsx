import { AlertTriangle, CheckCircle2, X } from "lucide-react";

interface Props {
  abierto: boolean;
  exitoso?: boolean;
  total: string;
  cliente: string;
  procesando?: boolean;
  onCancelar: () => void;
  onConfirmar?: () => void | Promise<void>;
}

export default function ConfirmarVentaModal({
  abierto,
  exitoso = false,
  total,
  cliente,
  procesando = false,
  onCancelar,
  onConfirmar,
}: Props) {
  if (!abierto) return null;

  return (
    <div className="venta-confirm-backdrop" role="presentation" onMouseDown={procesando ? undefined : onCancelar}>
      <section className={`venta-confirm-modal${exitoso ? " venta-confirm-modal--success" : ""}`} role="dialog" aria-modal="true" aria-labelledby="venta-confirm-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className={exitoso ? "venta-confirm-modal__header venta-confirm-modal__header--success" : "venta-confirm-modal__header"}>
          <span className="venta-confirm-modal__icon">
            {exitoso ? <CheckCircle2 size={25} aria-hidden="true" /> : <AlertTriangle size={25} aria-hidden="true" />}
          </span>
          <div>
            <h2 id="venta-confirm-title">{exitoso ? "Venta realizada" : "¿Confirmar venta?"}</h2>
            <p>{exitoso ? "La venta se registró correctamente." : "Revisa los datos antes de realizar el pago."}</p>
          </div>
          <button type="button" onClick={onCancelar} disabled={procesando} aria-label="Cerrar">
            <X size={20} />
          </button>
        </header>

        <div className="venta-confirm-details">
          <div><span>Cliente</span><strong>{cliente}</strong></div>
          <div><span>Total</span><strong>{total} BOB</strong></div>
        </div>

        <footer>
          {!exitoso && <button type="button" className="venta-confirm-button venta-confirm-button--ghost" onClick={onCancelar} disabled={procesando}>Cancelar</button>}
          {exitoso ? (
            <button type="button" className="venta-confirm-button venta-confirm-button--primary" onClick={onCancelar}>Aceptar</button>
          ) : (
            <button type="button" className="venta-confirm-button venta-confirm-button--primary" onClick={() => void onConfirmar?.()} disabled={procesando}>
              {procesando ? "Procesando..." : "Confirmar y realizar pago"}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

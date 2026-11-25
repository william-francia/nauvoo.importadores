import { useRef, useState, type FormEvent } from "react";
import type { GestionVenta } from "../../types/gestionVentas.types";
interface Props {
  venta: GestionVenta | null; onCerrar: () => void; disponible: boolean; motivo: string;
  onEnviar: (venta: GestionVenta, destinatario: string, idempotencia: string) => Promise<void>;
}
export default function ResendEmailModal(props: Props) {
  if (!props.venta) return null;
  return <Content key={props.venta.id} {...props} venta={props.venta} />;
}
function Content({ venta, onCerrar, disponible, motivo, onEnviar }: Props & { venta: GestionVenta }) {
  const [correo, setCorreo] = useState(venta.correoCliente ?? "");
  const [confirmado, setConfirmado] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [intentado, setIntentado] = useState(false);
  const lock = useRef(false);
  const idempotencia = useRef(crypto.randomUUID());
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current || intentado || !disponible || !confirmado) return;
    const to = correo.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) || to.length > 254) { setError("Ingresa un correo válido."); return; }
    lock.current = true; setBusy(true); setIntentado(true); setError("");
    try { await onEnviar(venta, to, idempotencia.current); }
    catch (e) { setError((e instanceof Error ? e.message : "No se confirmó el envío.") + " No se realizará un reintento automático."); }
    finally { setBusy(false); lock.current = false; }
  }
  return <div className="gestion-modal-backdrop" onMouseDown={() => { if (!busy) onCerrar(); }}><section className="gestion-modal gestion-modal--email" role="dialog" aria-modal="true" aria-labelledby="correo-factura-title" onMouseDown={e => e.stopPropagation()}>
    <header className="gestion-modal__header"><div><h2 id="correo-factura-title">Reenviar factura</h2><p>Factura #{venta.numeroFactura} · {venta.razonSocial} · {venta.ambiente}</p></div><button type="button" disabled={busy} onClick={onCerrar} aria-label="Cerrar">×</button></header>
    <form onSubmit={e => { void submit(e); }}><div className="gestion-modal__body"><p>Se enviarán el PDF carta y el XML firmado original de este documento. No se modifica el correo del cliente.</p>
      {!disponible && <p role="status" className="gestion-form-error">{motivo}</p>}
      <label className="gestion-field"><span>Correo del destinatario</span><input type="email" required maxLength={254} disabled={busy || intentado} value={correo} onChange={e => { setCorreo(e.target.value); setConfirmado(false); }} /></label>
      <label><input type="checkbox" checked={confirmado} disabled={busy || intentado} onChange={e => setConfirmado(e.target.checked)} /> Confirmo que el destinatario es correcto y autorizo enviar esta factura.</label>
      {error && <p role="alert" className="gestion-form-error">{error}</p>}</div>
      <footer className="gestion-modal__footer"><button type="button" className="gestion-button gestion-button--ghost" disabled={busy} onClick={onCerrar}>Cerrar</button><button type="submit" className="gestion-button gestion-button--primary" disabled={busy || intentado || !disponible || !confirmado}>{busy ? "Enviando…" : "Confirmar y reenviar"}</button></footer>
    </form></section></div>;
}

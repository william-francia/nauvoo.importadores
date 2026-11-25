import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listarMotivosAnulacion, obtenerFacturaSiat } from "../../../facturas/services/siat.service";
import { obtenerCapacidades9A, obtenerNotificaciones9A, solicitarAnulacionSiat, solicitarReversionSiat } from "../../../facturas/services/siat.gateway.service";
import type { FacturaSiatResumen } from "../../../facturas/types/siat.types";

export default function FiscalOperationModal({ factura, kind, onClose, onNotice }: {
  factura: FacturaSiatResumen; kind: "cancel" | "reverse"; onClose: () => void; onNotice: (text: string) => void;
}) {
  const client = useQueryClient();
  const [motivo, setMotivo] = useState("");
  const [noDdjj, setNoDdjj] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const idempotency = useRef(crypto.randomUUID());
  const detail = useQuery({ queryKey: ["siat-factura-detalle", factura.id], queryFn: () => obtenerFacturaSiat(factura.id) });
  const capabilities = useQuery({ queryKey: ["siat-9a-capacidades"], queryFn: obtenerCapacidades9A, staleTime: 0 });
  const notices = useQuery({ queryKey: ["siat-9a-notificaciones", factura.id], queryFn: () => obtenerNotificaciones9A(factura.id), enabled: kind === "cancel" });
  const motives = useQuery({ queryKey: ["siat-motivos-anulacion"], queryFn: listarMotivosAnulacion, enabled: kind === "cancel" });
  const current = detail.data;
  const eligible = current?.ambiente === "PRUEBAS" && !current.auditoria.some(item => item.accion === "REVERSION_ANULACION") &&
    (kind === "cancel" ? current.estadoFiscal === "VALIDADA" && current.codigoEstado === 908 && current.transaccion === true && Boolean(current.codigoRecepcion) && capabilities.data?.cancelacion === true && notices.data?.notificaciones.some(item => item.operacion === "ANULACION" && item.estado === "PENDIENTE") === true
      : current.estadoFiscal === "ANULADA" && capabilities.data?.reversion === true);
  const reason = current?.estadoFiscal === "REVERTIDA" || current?.auditoria.some(item => item.accion === "REVERSION_ANULACION")
    ? "Esta factura ya fue revertida y no puede volver a anularse."
    : !eligible ? "La operación requiere un documento elegible, autorización fiscal habilitada y, para anular, un destinatario preparado en Gestión de facturas." : "";
  async function submit() {
    if (lock.current || attempted || !eligible || (kind === "cancel" && (!motivo || !noDdjj))) return;
    if (kind === "cancel" && !confirm) { setConfirm(true); return; }
    lock.current = true; setBusy(true); setAttempted(true); setError("");
    try {
      // El backend vuelve a comprobar estado, plazo, permisos, motivo, CUIS/CUFD e idempotencia.
      const result = kind === "cancel"
        ? await solicitarAnulacionSiat(factura.id, Number(motivo), idempotency.current, noDdjj, null, null)
        : await solicitarReversionSiat(factura.id, idempotency.current, null, null);
      await Promise.all([client.invalidateQueries({ queryKey: ["siat-facturas"] }), client.invalidateQueries({ queryKey: ["siat-factura-detalle", factura.id] })]);
      onNotice(`Solicitud registrada: ${result.estado}. ${result.worker?.failures.length ? "La respuesta requiere revisión; no repita la solicitud." : "Espere la respuesta oficial; la solicitud no equivale a confirmación fiscal."}`);
      onClose();
    } catch (cause) {
      setError((cause instanceof Error ? cause.message : "Resultado incierto.") + " Revise el estado fiscal antes de otro intento.");
      await client.invalidateQueries({ queryKey: ["siat-facturas"] });
    } finally { setBusy(false); lock.current = false; }
  }
  return <div className="gestion-modal-backdrop"><section className="gestion-modal gestion-modal--sin" role="dialog" aria-modal="true" aria-labelledby="fiscal-operation-title">
    <header className="gestion-modal__header"><h2 id="fiscal-operation-title">{confirm ? "Confirmación" : kind === "cancel" ? "Anular documento" : "Revertir documento"}</h2><button type="button" disabled={busy} onClick={onClose} aria-label="Cerrar">×</button></header>
    <div className="gestion-modal__body"><p>{confirm ? `¿Está seguro de que desea ${kind === "cancel" ? "anular" : "revertir"} este documento?` : kind === "reverse" ? "¿Está seguro de que desea revertir este documento?" : "Seleccione el motivo oficial de anulación."}</p>
      <p><strong>Nro. factura:</strong> {factura.numeroFactura}<br/><strong>Cliente:</strong> {factura.cliente}<br/><strong>Fecha de emisión:</strong> {factura.fechaEmision}</p>
      {!confirm && kind === "cancel" && <><label className="gestion-field"><span>Motivo de la anulación</span><select value={motivo} onChange={e => setMotivo(e.target.value)}><option value="">Seleccione motivo</option>{motives.data?.map(item => <option key={item.codigo} value={item.codigo}>{item.descripcion}</option>)}</select></label><label><input type="checkbox" checked={noDdjj} onChange={e => setNoDdjj(e.target.checked)}/> Declaro que esta factura no fue utilizada en una declaración jurada.</label></>}
      {kind === "reverse" && <p className="gestion-notification gestion-notification--warning"><strong>Advertencia.</strong> Una vez revertida la anulación del documento, ya no podrá volver a anularlo.</p>}
      {reason && <p role="status" className="gestion-form-error">{reason}</p>}{error && <p role="alert" className="gestion-form-error">{error}</p>}
    </div><footer className="gestion-modal__footer"><button type="button" className="gestion-button gestion-button--ghost" disabled={busy} onClick={onClose}>Cancelar</button><button type="button" className="gestion-button gestion-button--primary" disabled={!eligible || busy || attempted || (kind === "cancel" && !confirm && (!motivo || !noDdjj))} onClick={() => { void submit(); }}>{busy ? "Procesando…" : confirm ? "Confirmar" : kind === "cancel" ? "Anular documento" : "Revertir"}</button></footer>
  </section></div>;
}

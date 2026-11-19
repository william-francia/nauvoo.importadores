import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, Download, FileText, LoaderCircle, RotateCcw, X } from "lucide-react";
import { ETIQUETAS_ESTADO_FISCAL } from "../constants/siat.constants";
import { listarMotivosAnulacion, listarSucursalesSiat, obtenerConfiguracionSiat, obtenerFacturaSiat } from "../services/siat.service";
import { obtenerCapacidades9A, obtenerNotificaciones9A, solicitarAnulacionSiat, solicitarReversionSiat } from "../services/siat.gateway.service";
import { prepararAvisoFiscal } from "../services/aviso-fiscal.service";
import { ejecutarAccionDocumentoFiscal, type AccionDocumentoFiscal } from "../services/documentos-fiscales.service";
import type { FacturaSiatResumen } from "../types/siat.types";
import FiscalEvidencePanel from "./FiscalEvidencePanel";

export function SiatPageHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <header className="siat-page-header"><div><p className="siat-breadcrumb">Facturas <span>›</span> {title}</p><h1>{title}</h1><p>{description}</p></div><div className="siat-header-actions"><span className="siat-setup-badge">SIAT en configuración</span>{action}</div></header>;
}

export function EstadoBadge({ estado }: { estado: string }) {
  const normalized = estado.toUpperCase();
  const tone = ["VALIDADA", "VALIDADO", "VIGENTE", "ONLINE", "HOMOLOGADO", "COMPLETADA"].includes(normalized)
    ? "success"
    : ["RECHAZADA", "RECHAZADO", "INVALIDO", "CON_ERROR", "VENCIDO", "ANULADA"].includes(normalized)
      ? "danger"
      : ["PENDIENTE", "EN_COLA", "OBSERVADA", "OBSERVADO", "OFFLINE", "EN_CONFIGURACION", "CREDENCIALES_CONFIGURADAS", "GATEWAY_PENDIENTE"].includes(normalized)
        ? "warning" : "neutral";
  return <span className={`siat-status siat-status--${tone}`}>{ETIQUETAS_ESTADO_FISCAL[normalized] ?? estado.replaceAll("_", " ")}</span>;
}

export function SiatLoading({ label = "Cargando información…" }: { label?: string }) {
  return <div className="siat-state"><LoaderCircle className="siat-spin" />{label}</div>;
}

export function SiatError({ message }: { message: string }) {
  return <div className="siat-alert siat-alert--error"><AlertTriangle /><span>{message}</span></div>;
}

export function SiatEmpty({ title, description }: { title: string; description: string }) {
  return <div className="siat-empty"><FileText /><strong>{title}</strong><span>{description}</span></div>;
}

function formatDate(value: string | null | undefined) {
  return value ? new Intl.DateTimeFormat("es-BO", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}

function snapshotValue(value: unknown) {
  if (value == null || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function FacturaDetalleModal({ factura, onClose, canManage = false }: { factura: FacturaSiatResumen | null; onClose: () => void; canManage?: boolean }) {
  const [message, setMessage] = useState<string | null>(null); const [rollWidth, setRollWidth] = useState(80);
  const [approval, setApproval] = useState({ scope: "", motivo: "", confirmacion: false, noDdjj: false, sucursal: "", punto: "" });
  const keys = useRef<Record<string, string>>({}); const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["siat-factura-detalle", factura?.id], queryFn: () => obtenerFacturaSiat(factura!.id), enabled: Boolean(factura) });
  const scope = `${factura?.id ?? ""}:${query.data?.estadoFiscal ?? ""}`;
  const selected = approval.scope === scope ? approval : { scope, motivo: "", confirmacion: false, noDdjj: false, sucursal: "", punto: "" };
  const { motivo, confirmacion, noDdjj, sucursal, punto } = selected;
  const updateApproval = (values: Partial<typeof selected>) => setApproval({ ...selected, ...values, scope });
  const motives = useQuery({ queryKey: ["siat-motivos-anulacion"], queryFn: listarMotivosAnulacion, enabled: Boolean(factura && canManage) });
  const branches = useQuery({ queryKey: ["siat-sucursales"], queryFn: listarSucursalesSiat, enabled: Boolean(factura && canManage) });
  const config = useQuery({ queryKey: ["siat-configuracion"], queryFn: obtenerConfiguracionSiat, enabled: Boolean(factura && canManage) });
  const capabilities = useQuery({ queryKey: ["siat-9a-capacidades"], queryFn: obtenerCapacidades9A, enabled: Boolean(factura && canManage) });
  const notifications = useQuery({ queryKey: ["siat-9a-notificaciones", factura?.id], queryFn: () => obtenerNotificaciones9A(factura!.id), enabled: Boolean(factura && canManage) });
  const destinationReady = notifications.data?.notificaciones.some((item) => item.operacion === "ANULACION" && item.estado === "PENDIENTE") === true;
  const allowCancel = capabilities.data?.cancelacion === true && destinationReady;
  const operation = useMutation({ mutationFn: async (kind: "cancel" | "reverse") => {
    if (!factura || !confirmacion || (kind === "cancel" && (!allowCancel || !motivo || !noDdjj)) || (kind === "reverse" && capabilities.data?.reversion !== true)) throw new Error("Operación fiscal bloqueada, sin destinatario o sin confirmación.");
    const key = `${factura.id}:${kind}`; keys.current[key] ??= crypto.randomUUID();
    return kind === "cancel" ? solicitarAnulacionSiat(factura.id, Number(motivo), keys.current[key], noDdjj, sucursal || null, punto || null) : solicitarReversionSiat(factura.id, keys.current[key], sucursal || null, punto || null);
  }, onSuccess: async (result) => { setMessage(`Solicitud registrada: ${result.estado}.${result.worker?.failures.length ? ` Atención: ${result.worker.failures.join("; ")}. Revise el estado y la auditoría; no repita la operación.` : ""}`); await queryClient.invalidateQueries({ queryKey: ["siat-facturas"] }); await queryClient.invalidateQueries({ queryKey: ["siat-factura-detalle", factura?.id] }); }, onError: (error) => setMessage(error.message) });
  const download = useMutation({ mutationFn: ({ action, target }: { action: AccionDocumentoFiscal; target?: Window | null }) => ejecutarAccionDocumentoFiscal(query.data!, action, rollWidth, target), onError: (error) => setMessage(error.message) });
  const openDocument = (action: AccionDocumentoFiscal) => {
    const target = action === "VER" || action === "CONSULTA" ? window.open("", "_blank") : undefined;
    if (target === null) { setMessage("El navegador bloqueó la nueva ventana."); return; }
    if (target) target.opener = null;
    setMessage(null); download.mutate({ action, target });
  };
  if (!factura) return null;
  const detail = query.data;
  const reason = detail?.motivoAnulacion ?? motives.data?.find((item) => Number(item.codigo) === detail?.motivoAnulacionCodigo)?.descripcion ?? null;
  const avisoInput = detail ? { numeroFactura: String(detail.numeroFactura ?? ""), cuf: detail.cuf, motivo: reason, emisor: config.data?.razonSocial ?? "", nitEmisor: config.data?.nit ?? "" } : null;
  const avisoAnulacionBase = detail && avisoInput && ["ANULADA", "REVERTIDA"].includes(detail.estadoFiscal) ? prepararAvisoFiscal({ ...avisoInput, estadoFiscal: "ANULADA" }) : null;
  const avisoAnulacion = avisoAnulacionBase && detail?.estadoFiscal === "REVERTIDA" ? `${avisoAnulacionBase} La anulación fue revertida posteriormente.` : avisoAnulacionBase;
  const avisoReversion = detail && avisoInput && detail.estadoFiscal === "REVERTIDA" ? prepararAvisoFiscal({ ...avisoInput, estadoFiscal: "REVERTIDA" }) : null;
  return <div className="siat-modal-backdrop" role="presentation" onMouseDown={onClose}><section className="siat-modal" role="dialog" aria-modal="true" aria-labelledby="siat-invoice-title" onMouseDown={(event) => event.stopPropagation()}><header><div><small>Documento fiscal</small><h2 id="siat-invoice-title">Factura {factura.numeroFactura}</h2></div><button type="button" onClick={onClose} aria-label="Cerrar"><X /></button></header>
    {query.isLoading && <SiatLoading />}{query.error && <SiatError message={query.error.message} />}
    {detail && <><div className="siat-detail-grid"><span><small>Estado fiscal</small><EstadoBadge estado={detail.estadoFiscal} /></span><span><small>Estado comercial</small><strong>{detail.estadoComercial}</strong></span><span><small>Fecha</small><strong>{formatDate(detail.fechaEmision)}</strong></span><span><small>Comprador</small><strong>{detail.cliente}</strong></span><span><small>NIT/CI</small><strong>{detail.documento}</strong></span><span><small>Total</small><strong>Bs {detail.total.toFixed(2)}</strong></span><span><small>Sucursal / P.V.</small><strong>{detail.sucursal} / {detail.puntoVenta}</strong></span><span><small>Recepción</small><strong>{detail.codigoRecepcion ?? "—"}</strong></span><span><small>Intentos</small><strong>{detail.cantidadIntentos}</strong></span></div>
      <div className="siat-code-block"><small>CUF</small><code>{detail.cuf ?? "Pendiente"}</code></div><div className="siat-code-block"><small>CUFD utilizado</small><code>{detail.cufdUtilizado ? `${detail.cufdUtilizado.slice(0, 12)}…` : "Pendiente"}</code></div>
      <section className="siat-detail-section"><h3>Detalle y totales del snapshot</h3>{detail.detalleSnapshot.length === 0 ? <p className="siat-muted">El snapshot fiscal todavía no fue generado.</p> : <div className="siat-table-wrap"><table className="siat-table"><thead><tr><th>#</th><th>Detalle inmutable</th></tr></thead><tbody>{detail.detalleSnapshot.map((item, index) => <tr key={index}><td>{index + 1}</td><td><code>{snapshotValue(item)}</code></td></tr>)}</tbody></table></div>}<p className="siat-muted">Totales: {snapshotValue(detail.totalesSnapshot)} · Pago: {snapshotValue(detail.pagoSnapshot)}</p></section>
      <section className="siat-detail-section"><h3>Mensajes SIN</h3>{detail.mensajesSiat.length ? <ul>{detail.mensajesSiat.map((message, index) => <li key={index}>{snapshotValue(message)}</li>)}</ul> : <p className="siat-muted">Sin mensajes registrados.</p>}</section>
      <section className="siat-detail-section"><h3>Historial / auditoría</h3>{detail.auditoria.length ? <div className="siat-timeline">{detail.auditoria.map((item) => <article key={item.id}><span /><div><strong>{item.accion}</strong><small>{formatDate(item.fecha)} · {item.actor === "Sistema" ? "Sistema" : `Usuario ${item.actor.slice(0, 8)}…`}</small><p><EstadoBadge estado={item.resultado} /></p></div></article>)}</div> : <p className="siat-muted">Sin registros de auditoría disponibles.</p>}</section>
      {canManage && ["VALIDADA", "ANULADA", "REVERTIDA"].includes(detail.estadoFiscal) && <p className="siat-muted">{allowCancel ? "Anulación piloto disponible con confirmación administrativa." : "Anulación bloqueada: requiere habilitación piloto y destinatario preparado."} Reversión bloqueada hasta confirmar habilitación oficial. La notificación requiere envío privado; no se envía automáticamente.</p>}
      {canManage && ["ANULACION_PENDIENTE", "REVERSION_PENDIENTE"].includes(detail.estadoFiscal) && <p className="siat-alert siat-alert--warning">Operación pendiente o con resultado incierto. Revise los mensajes y la auditoría; no repita la operación hasta contar con evidencia oficial y revisión administrativa.</p>}
      {canManage && <FiscalEvidencePanel key={`${detail.id}:${detail.estadoFiscal}`} facturaId={detail.id} estado={detail.estadoFiscal} avisoAnulacion={avisoAnulacion} avisoReversion={avisoReversion} correoAutomatico={capabilities.data?.correoAutomatico === true} />}
      {canManage && ["VALIDADA", "ANULADA"].includes(detail.estadoFiscal) && <section className="siat-detail-section"><label><input type="checkbox" checked={confirmacion} onChange={(event) => updateApproval({ confirmacion: event.target.checked })} /> Confirmo expresamente {detail.estadoFiscal === "VALIDADA" ? "la anulación" : "la reversión de la anulación"} de esta factura.</label>{detail.estadoFiscal === "VALIDADA" && <label><input type="checkbox" checked={noDdjj} onChange={(event) => updateApproval({ noDdjj: event.target.checked })} /> Declaro que la factura no fue utilizada en una declaración jurada.</label>}</section>}
      {canManage && ["VALIDADA", "ANULADA"].includes(detail.estadoFiscal) && <section className="siat-detail-section"><label>Sucursal para la operación <select value={sucursal} onChange={(event) => updateApproval({ sucursal: event.target.value, punto: "", confirmacion: false })}><option value="">Sucursal y punto originales</option>{branches.data?.filter((item) => item.activo).map((item) => <option key={item.id} value={item.id}>{item.codigo} · {item.nombre}</option>)}</select></label>{sucursal && <label>Punto de venta <select value={punto} onChange={(event) => updateApproval({ punto: event.target.value, confirmacion: false })}><option value="">Sin punto de venta</option>{branches.data?.find((item) => item.id === sucursal)?.puntosVenta.filter((item) => item.activo).map((item) => <option key={item.id} value={item.id}>{item.codigo} · {item.nombre}</option>)}</select></label>}</section>}
      {message && <p className={`siat-form-message${download.isError || operation.isError ? " error" : ""}`}>{message}</p>}<footer className="siat-modal-actions">{canManage && <>
        <button type="button" className="siat-secondary-button" disabled={!detail.xmlDisponible || detail.estadoFiscal !== "VALIDADA" || download.isPending} onClick={() => openDocument("VER")}><FileText />Ver factura</button>
        <button type="button" className="siat-secondary-button" disabled={!detail.xmlDisponible || detail.estadoFiscal !== "VALIDADA" || download.isPending} onClick={() => openDocument("PDF_CARTA")}><Download />Descargar PDF carta</button>
        <label>Ancho rollo <select value={rollWidth} onChange={(event) => setRollWidth(Number(event.target.value))}><option value={58}>58 mm</option><option value={80}>80 mm</option></select></label>
        <button type="button" className="siat-secondary-button" disabled={!detail.xmlDisponible || detail.estadoFiscal !== "VALIDADA" || download.isPending} onClick={() => openDocument("PDF_ROLLO")}><Download />Descargar PDF rollo</button>
        <button type="button" className="siat-secondary-button" disabled={!detail.xmlDisponible || detail.estadoFiscal !== "VALIDADA" || download.isPending} onClick={() => openDocument("XML")}><Download />Descargar XML firmado</button>
        <button type="button" className="siat-secondary-button" disabled={!detail.xmlDisponible || detail.estadoFiscal !== "VALIDADA" || download.isPending} onClick={() => openDocument("CONSULTA")}>Abrir consulta fiscal</button>
        <button type="button" className="siat-secondary-button" disabled title="Correo no configurado">Enviar por correo (no configurado)</button>
      </>}{canManage && detail.estadoFiscal === "VALIDADA" && <><select aria-label="Motivo de anulación" value={motivo} onChange={(event) => updateApproval({ motivo: event.target.value, confirmacion: false })}><option value="">Motivo de anulación</option>{motives.data?.map((item) => <option key={item.codigo} value={item.codigo}>{item.codigo} · {item.descripcion}</option>)}</select><button type="button" className="siat-secondary-button" disabled={!allowCancel || !confirmacion || !noDdjj || !motivo || operation.isPending} title={!allowCancel ? "Falta habilitación piloto o destinatario preparado" : undefined} onClick={() => operation.mutate("cancel")}><Ban />Solicitar anulación</button></>}{canManage && detail.estadoFiscal === "ANULADA" && <button type="button" className="siat-secondary-button" disabled={capabilities.data?.reversion !== true || !confirmacion || operation.isPending} title="Reversión fiscal aún no habilitada" onClick={() => operation.mutate("reverse")}><RotateCcw />Revertir anulación</button>}</footer></>}
  </section></div>;
}

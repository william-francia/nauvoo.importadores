import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Ban, Download, FileText, LoaderCircle, RotateCcw, X } from "lucide-react";
import { ETIQUETAS_ESTADO_FISCAL } from "../constants/siat.constants";
import { listarMotivosAnulacion, obtenerFacturaSiat } from "../services/siat.service";
import { descargarDocumentoFiscal, solicitarAnulacionSiat, solicitarReversionSiat } from "../services/siat.gateway.service";
import type { FacturaSiatResumen } from "../types/siat.types";

export function SiatPageHeader({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return <header className="siat-page-header"><div><p className="siat-breadcrumb">Facturas <span>›</span> {title}</p><h1>{title}</h1><p>{description}</p></div><div className="siat-header-actions"><span className="siat-setup-badge">SIAT en configuración</span>{action}</div></header>;
}

export function EstadoBadge({ estado }: { estado: string }) {
  const normalized = estado.toUpperCase();
  const tone = ["VALIDADA", "VALIDADO", "VIGENTE", "ONLINE", "HOMOLOGADO", "COMPLETADA"].includes(normalized)
    ? "success"
    : ["RECHAZADA", "RECHAZADO", "INVALIDO", "CON_ERROR", "VENCIDO", "ANULADA"].includes(normalized)
      ? "danger"
      : ["PENDIENTE", "EN_COLA", "OBSERVADA", "OBSERVADO", "OFFLINE", "EN_CONFIGURACION", "GATEWAY_PENDIENTE"].includes(normalized)
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
  const [motivo, setMotivo] = useState(""); const [message, setMessage] = useState<string | null>(null); const client = useQueryClient();
  const query = useQuery({ queryKey: ["siat-factura-detalle", factura?.id], queryFn: () => obtenerFacturaSiat(factura!.id), enabled: Boolean(factura) });
  const motives = useQuery({ queryKey: ["siat-motivos-anulacion"], queryFn: listarMotivosAnulacion, enabled: Boolean(factura && canManage) });
  const operation = useMutation({ mutationFn: async (kind: "cancel" | "reverse") => kind === "cancel" ? solicitarAnulacionSiat(factura!.id, Number(motivo)) : solicitarReversionSiat(factura!.id), onSuccess: async (result) => { setMessage(`Solicitud registrada: ${result.estado}.`); await Promise.all([client.invalidateQueries({ queryKey: ["siat-factura-detalle", factura?.id] }), client.invalidateQueries({ queryKey: ["siat-facturas"] })]); }, onError: (error) => setMessage(error.message) });
  const download = useMutation({ mutationFn: (type: "PDF" | "XML") => descargarDocumentoFiscal(factura!.id, type), onError: (error) => setMessage(error.message) });
  if (!factura) return null;
  const detail = query.data;
  return <div className="siat-modal-backdrop" role="presentation" onMouseDown={onClose}><section className="siat-modal" role="dialog" aria-modal="true" aria-labelledby="siat-invoice-title" onMouseDown={(event) => event.stopPropagation()}><header><div><small>Documento fiscal</small><h2 id="siat-invoice-title">Factura {factura.numeroFactura}</h2></div><button type="button" onClick={onClose} aria-label="Cerrar"><X /></button></header>
    {query.isLoading && <SiatLoading />}{query.error && <SiatError message={query.error.message} />}
    {detail && <><div className="siat-detail-grid"><span><small>Estado fiscal</small><EstadoBadge estado={detail.estadoFiscal} /></span><span><small>Estado comercial</small><strong>{detail.estadoComercial}</strong></span><span><small>Fecha</small><strong>{formatDate(detail.fechaEmision)}</strong></span><span><small>Comprador</small><strong>{detail.cliente}</strong></span><span><small>NIT/CI</small><strong>{detail.documento}</strong></span><span><small>Total</small><strong>Bs {detail.total.toFixed(2)}</strong></span><span><small>Sucursal / P.V.</small><strong>{detail.sucursal} / {detail.puntoVenta}</strong></span><span><small>Recepción</small><strong>{detail.codigoRecepcion ?? "—"}</strong></span><span><small>Intentos</small><strong>{detail.cantidadIntentos}</strong></span></div>
      <div className="siat-code-block"><small>CUF</small><code>{detail.cuf ?? "Pendiente"}</code></div><div className="siat-code-block"><small>CUFD utilizado</small><code>{detail.cufdUtilizado ? `${detail.cufdUtilizado.slice(0, 12)}…` : "Pendiente"}</code></div>
      <section className="siat-detail-section"><h3>Detalle y totales del snapshot</h3>{detail.detalleSnapshot.length === 0 ? <p className="siat-muted">El snapshot fiscal todavía no fue generado.</p> : <div className="siat-table-wrap"><table className="siat-table"><thead><tr><th>#</th><th>Detalle inmutable</th></tr></thead><tbody>{detail.detalleSnapshot.map((item, index) => <tr key={index}><td>{index + 1}</td><td><code>{snapshotValue(item)}</code></td></tr>)}</tbody></table></div>}<p className="siat-muted">Totales: {snapshotValue(detail.totalesSnapshot)} · Pago: {snapshotValue(detail.pagoSnapshot)}</p></section>
      <section className="siat-detail-section"><h3>Mensajes SIN</h3>{detail.mensajesSiat.length ? <ul>{detail.mensajesSiat.map((message, index) => <li key={index}>{snapshotValue(message)}</li>)}</ul> : <p className="siat-muted">Sin mensajes registrados.</p>}</section>
      <section className="siat-detail-section"><h3>Historial / auditoría</h3>{detail.auditoria.length ? <div className="siat-timeline">{detail.auditoria.map((item) => <article key={item.id}><span /><div><strong>{item.accion}</strong><small>{formatDate(item.fecha)} · {item.actor === "Sistema" ? "Sistema" : `Usuario ${item.actor.slice(0, 8)}…`}</small><p><EstadoBadge estado={item.resultado} /></p></div></article>)}</div> : <p className="siat-muted">Sin registros de auditoría disponibles.</p>}</section>
      {message && <p className={`siat-form-message${operation.isError || download.isError ? " error" : ""}`}>{message}</p>}<footer className="siat-modal-actions"><button type="button" className="siat-secondary-button" disabled={!detail.pdfDisponible || download.isPending} onClick={() => download.mutate("PDF")}><Download />PDF fiscal</button><button type="button" className="siat-secondary-button" disabled={!detail.xmlDisponible || download.isPending} onClick={() => download.mutate("XML")}><Download />XML</button>{canManage && ["VALIDADA", "REVERTIDA"].includes(detail.estadoFiscal) && <><select aria-label="Motivo de anulación" value={motivo} onChange={(event) => setMotivo(event.target.value)}><option value="">Motivo de anulación</option>{motives.data?.map((item) => <option key={item.codigo} value={item.codigo}>{item.codigo} · {item.descripcion}</option>)}</select><button type="button" className="siat-secondary-button" disabled={!motivo || operation.isPending} onClick={() => operation.mutate("cancel")}><Ban />Solicitar anulación</button></>}{canManage && detail.estadoFiscal === "ANULADA" && <button type="button" className="siat-secondary-button" disabled={operation.isPending} onClick={() => operation.mutate("reverse")}><RotateCcw />Revertir anulación</button>}</footer></>}
  </section></div>;
}

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Eye, X } from "lucide-react";
import { EstadoBadge, FacturaDetalleModal, SiatEmpty, SiatPageHeader } from "../../features/facturas/components/SiatShared";
import { listarVentasOffline } from "../../features/facturas/services/siat.service";
import { descargarDocumentoLocal, listarFacturasAgenteLocal, type LocalInvoiceSummary } from "../../features/facturas/services/siat.local-agent.service";
import type { VentaOfflineSiat } from "../../features/facturas/types/siat.types";
import "../../features/facturas/styles/siat.css";

const date = (value: string) => new Intl.DateTimeFormat("es-BO", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
type Row = { key: string; source: "LOCAL" | "REMOTO"; id: string; number: string; issuedAt: string; client: string; document: string; total: number; state: string; event: string; package: string; remote?: VentaOfflineSiat; local?: LocalInvoiceSummary };

export default function VentasOfflinePage() {
  const remote = useQuery({ queryKey: ["siat-ventas-offline"], queryFn: listarVentasOffline });
  const local = useQuery({ queryKey: ["siat-ventas-offline-local"], queryFn: listarFacturasAgenteLocal, refetchInterval: 15_000, retry: 1 });
  const [text, setText] = useState(""); const [state, setState] = useState("TODOS"); const [detail, setDetail] = useState<Row | null>(null); const [downloadError, setDownloadError] = useState<string | null>(null);
  const rows = useMemo<Row[]>(() => {
    const localIds = new Set((local.data ?? []).map(item => item.id));
    const all: Row[] = (local.data ?? []).map(item => ({ key: `local:${item.id}`, source: "LOCAL", id: item.id, number: String(item.numeroFactura), issuedAt: item.fechaEmision, client: String(item.cliente.nombreRazonSocial ?? "Sin cliente"), document: String(item.cliente.numeroDocumento ?? "—"), total: Number(item.total), state: item.estado, event: item.eventId.slice(0, 8), package: item.paqueteId?.slice(0, 8) ?? "Local", local: item }));
    for (const item of remote.data ?? []) if (!localIds.has(item.id)) all.push({ key: `remote:${item.id}`, source: "REMOTO", id: item.id, number: item.numeroFactura, issuedAt: item.fechaEmision, client: item.cliente, document: item.documento, total: item.total, state: item.estadoFiscal, event: item.evento, package: item.paquete, remote: item });
    return all.filter(item => `${item.number} ${item.client} ${item.document}`.toLowerCase().includes(text.toLowerCase()) && (state === "TODOS" || item.state === state));
  }, [local.data, remote.data, state, text]);
  const allStates = [...new Set(rows.map(item => item.state))]; const count = (values: string[]) => rows.filter(item => values.includes(item.state)).length;
  async function download(type: "pdf" | "xml") { if (!detail?.local) return; try { setDownloadError(null); await descargarDocumentoLocal(detail.local.id, type); } catch (error) { setDownloadError(error instanceof Error ? error.message : "No se pudo descargar."); } }
  return <div className="siat-page"><SiatPageHeader title="Gestión de ventas offline" description="Documentos locales y recuperados, relacionados con su evento y paquete fiscal." />
    <section className="siat-metrics"><article><small>Pendientes</small><strong>{count(["PENDIENTE", "OFFLINE"])}</strong></article><article><small>En cola</small><strong>{count(["EN_COLA", "ENVIADA"])}</strong></article><article><small>Validadas</small><strong>{count(["VALIDADA"])}</strong></article><article><small>Observadas</small><strong>{count(["OBSERVADA", "ERROR"])}</strong></article></section>
    {remote.error && local.error && <div className="siat-alert siat-alert--error">No se pudo consultar ni el agente local ni el respaldo remoto.</div>}
    <section className="siat-card"><div className="siat-toolbar"><div className="siat-search"><input value={text} onChange={event => setText(event.target.value)} placeholder="Buscar por factura, razón social o documento…" /></div><select value={state} onChange={event => setState(event.target.value)}><option value="TODOS">Todos los estados</option>{allStates.map(item => <option key={item}>{item}</option>)}</select></div>
      {rows.length === 0 ? <SiatEmpty title="Sin ventas offline" description="No hay documentos offline registrados." /> : <div className="siat-table-wrap"><table className="siat-table"><thead><tr><th>N.º factura</th><th>Emisión</th><th>Razón social</th><th>Documento</th><th>Monto</th><th>Origen</th><th>Estado</th><th>Evento</th><th>Paquete</th><th></th></tr></thead><tbody>{rows.map(item => <tr key={item.key}><td>{item.number}</td><td>{date(item.issuedAt)}</td><td>{item.client}</td><td>{item.document}</td><td>Bs {item.total.toFixed(2)}</td><td>{item.source === "LOCAL" ? "Agente local" : "Supabase"}</td><td><EstadoBadge estado={item.state} /></td><td>{item.event}</td><td>{item.package}</td><td><button className="siat-link-button" onClick={() => setDetail(item)}><Eye size={16}/></button></td></tr>)}</tbody></table></div>}
    </section>
    {detail?.remote && <FacturaDetalleModal factura={detail.remote} onClose={() => setDetail(null)} />}
    {detail?.local && <div className="siat-modal-backdrop" onMouseDown={() => setDetail(null)}><section className="siat-modal siat-small-modal" onMouseDown={event => event.stopPropagation()}><header><div><small>Documento cifrado en el agente</small><h2>Factura {detail.number}</h2></div><button onClick={() => setDetail(null)}><X /></button></header><div className="siat-detail-grid"><span><small>Estado</small><EstadoBadge estado={detail.state}/></span><span><small>Cliente</small><strong>{detail.client}</strong></span><span><small>Total</small><strong>Bs {detail.total.toFixed(2)}</strong></span><span><small>Evento</small><strong>{detail.event}</strong></span></div><div className="siat-code-block"><small>CUF</small><code>{detail.local.cuf}</code></div>{downloadError && <p className="siat-form-message error">{downloadError}</p>}<footer className="siat-modal-actions"><button className="siat-secondary-button" onClick={() => void download("pdf")}><Download/>PDF local</button><button className="siat-secondary-button" onClick={() => void download("xml")}><Download/>XML local</button></footer></section></div>}
  </div>;
}

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudDownload, Plus, RefreshCw } from "lucide-react";
import RegistrarContingenciaModal from "../../features/facturas/components/RegistrarContingenciaModal";
import { EstadoBadge, SiatEmpty, SiatError, SiatLoading, SiatPageHeader } from "../../features/facturas/components/SiatShared";
import { listarEventosSiat } from "../../features/facturas/services/siat.service";
import { aprovisionarAgenteLocal, obtenerEstadoAgenteLocal, recuperarAgenteLocal, reportarEstadoNavegadorLocal } from "../../features/facturas/services/siat.local-agent.service";
import type { EventoSignificativoSiat } from "../../features/facturas/types/siat.types";
import "../../features/facturas/styles/siat.css";

const date = (value: string | null) => value ? new Intl.DateTimeFormat("es-BO", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "Abierta";
function EventTable({ rows }: { rows: EventoSignificativoSiat[] }) { return rows.length === 0 ? <SiatEmpty title="Sin contingencias" description="No existen eventos reales en esta vista." /> : <div className="siat-table-wrap"><table className="siat-table"><thead><tr><th>Vigencia</th><th>Suc. / P.V.</th><th>Facturas</th><th>Paquetes</th><th>Recepcionados</th><th>Validados</th><th>Estado</th><th>CUFD vigente</th></tr></thead><tbody>{rows.map(item => <tr key={item.id}><td>{date(item.fechaInicio)}<br/><small>a {date(item.fechaFin)}</small></td><td>{item.sucursal} / {item.puntoVenta}</td><td>{item.cantidadFacturas}</td><td>{item.cantidadPaquetes}</td><td>{item.paquetesRecepcionados}</td><td>{item.paquetesValidados}</td><td><EstadoBadge estado={item.estado}/></td><td>{item.cufdVigente ? "Sí" : "No"}</td></tr>)}</tbody></table></div>; }

export default function ContingenciasPage() {
  const client = useQueryClient(); const [tab, setTab] = useState<"VIGENTES" | "HISTORIAL">("VIGENTES"); const [modal, setModal] = useState(false); const [message, setMessage] = useState<string | null>(null);
  const events = useQuery({ queryKey: ["siat-eventos"], queryFn: listarEventosSiat });
  const agent = useQuery({ queryKey: ["siat-agente-local"], queryFn: obtenerEstadoAgenteLocal, refetchInterval: 15_000, retry: 1 });
  const provision = useMutation({ mutationFn: aprovisionarAgenteLocal, onSuccess: async data => { setMessage(`Agente aprovisionado: ${data.products} productos y ${data.clients} clientes.`); await client.invalidateQueries({ queryKey: ["siat-agente-local"] }); }, onError: error => setMessage(error.message) });
  const recover = useMutation({ mutationFn: recuperarAgenteLocal, onSuccess: async data => { setMessage(`Recuperación: ${data.status}${data.pendientes ? ` (${data.pendientes} pendientes)` : ""}.`); await Promise.all([client.invalidateQueries({ queryKey: ["siat-agente-local"] }), client.invalidateQueries({ queryKey: ["siat-eventos"] })]); }, onError: error => setMessage(error.message) });
  useEffect(() => { const report = () => void reportarEstadoNavegadorLocal(navigator.onLine).catch(() => undefined); report(); window.addEventListener("online", report); window.addEventListener("offline", report); return () => { window.removeEventListener("online", report); window.removeEventListener("offline", report); }; }, []);
  const localEvent = agent.data?.event; const combined = useMemo(() => {
    const rows = [...(events.data ?? [])];
    if (localEvent && !rows.some(item => item.id === String(localEvent.id))) rows.unshift({ id: String(localEvent.id), sucursal: "Agente local", puntoVenta: "Caja", tipoEventoCodigo: String(localEvent.tipoEventoCodigo ?? ""), descripcion: String(localEvent.descripcion ?? "Contingencia local"), observaciones: String(localEvent.observaciones ?? ""), fechaInicio: String(localEvent.fechaInicio), fechaFin: null, estado: "OFFLINE", cufdId: String(localEvent.cufdId ?? ""), cufdVigente: true, codigoRecepcion: null, cantidadFacturas: agent.data?.pending ?? 0, cantidadPaquetes: 0, paquetesRecepcionados: 0, paquetesValidados: 0 });
    return rows;
  }, [agent.data?.pending, events.data, localEvent]);
  const rows = combined.filter(item => tab === "VIGENTES" ? !item.fechaFin : Boolean(item.fechaFin)); const pending = combined.filter(item => item.fechaFin && !["VALIDADO", "VALIDADA"].includes(item.estado));
  return <div className="siat-page"><SiatPageHeader title="Contingencias" description="Eventos significativos, operación local y recuperación fiscal." action={<><button className="siat-secondary-button" onClick={() => provision.mutate()} disabled={provision.isPending}><CloudDownload/>Aprovisionar agente</button><button className="siat-secondary-button" onClick={() => recover.mutate()} disabled={recover.isPending || !localEvent}><RefreshCw/>Recuperar</button><button className="siat-primary-button" onClick={() => setModal(true)}><Plus/>Registrar contingencia</button></>}/>
    {agent.error && <SiatError message={agent.error.message}/>} {message && <div className="siat-alert siat-alert--warning">{message}</div>}
    <section className="siat-metrics"><article><small>Estado operativo</small><EstadoBadge estado={agent.data?.state ?? "AGENTE NO DISPONIBLE"}/></article><article><small>Evento actual</small><strong>{String(localEvent?.descripcion ?? "Sin evento")}</strong></article><article><small>Facturas pendientes</small><strong>{agent.data?.pending ?? 0}</strong></article><article><small>Comunicación</small><strong>{agent.data?.evidence?.backendOnline ? "Gateway disponible" : "Sin gateway"}</strong></article></section>
    <div className="siat-tabs"><button className={tab === "VIGENTES" ? "active" : ""} onClick={() => setTab("VIGENTES")}>Vigentes</button><button className={tab === "HISTORIAL" ? "active" : ""} onClick={() => setTab("HISTORIAL")}>Historial</button></div>
    <section className="siat-card"><div className="siat-card-title"><h3>{tab === "VIGENTES" ? "Contingencias registradas" : "Historial de contingencias"}</h3></div>{events.isLoading ? <SiatLoading/> : <EventTable rows={rows}/>}</section>
    {pending.length > 0 && <section className="siat-card"><div className="siat-card-title"><h3>Contingencias pendientes a validar</h3></div><EventTable rows={pending}/></section>}
    {modal && <RegistrarContingenciaModal onClose={() => setModal(false)}/>}</div>;
}

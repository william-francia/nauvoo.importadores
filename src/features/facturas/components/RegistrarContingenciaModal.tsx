import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { contingenciaSchema } from "../schemas/siat.schemas";
import { obtenerOpcionesContingencia } from "../services/siat.service";
import { registrarEventoLocal } from "../services/siat.local-agent.service";
import type { ContingenciaInput } from "../types/siat.types";
import { SiatError, SiatLoading } from "./SiatShared";

const INITIAL: ContingenciaInput = { sucursalId: "", puntoVentaId: "", tipoEventoCodigo: "", descripcion: "", fechaInicio: "", cufdId: "", observaciones: "" };

export default function RegistrarContingenciaModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState(INITIAL); const [message, setMessage] = useState<string | null>(null); const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["siat-opciones-contingencia"], queryFn: obtenerOpcionesContingencia });
  const register = useMutation({ mutationFn: registrarEventoLocal, onSuccess: async () => { setMessage("Contingencia administrativa registrada en el agente local."); await Promise.all([queryClient.invalidateQueries({ queryKey: ["siat-agente-local"] }), queryClient.invalidateQueries({ queryKey: ["siat-eventos"] })]); }, onError: error => setMessage(error.message) });
  const branch = query.data?.sucursales.find(item => item.id === form.sucursalId);
  const cufd = useMemo(() => (query.data?.cufd ?? []).filter(item => !form.sucursalId || item.sucursalId === form.sucursalId).filter(item => !form.puntoVentaId || item.puntoVentaId === form.puntoVentaId), [form.puntoVentaId, form.sucursalId, query.data?.cufd]);
  function field<K extends keyof ContingenciaInput>(key: K, value: ContingenciaInput[K]) { setForm(current => ({ ...current, [key]: value })); setMessage(null); }
  function submit(event: React.FormEvent) { event.preventDefault(); const parsed = contingenciaSchema.safeParse(form); if (!parsed.success) { setMessage(parsed.error.issues[0]?.message ?? "Completa el formulario."); return; } register.mutate({ tipoEventoCodigo: parsed.data.tipoEventoCodigo, descripcion: parsed.data.descripcion, evidencia: parsed.data.observaciones }); }
  return <div className="siat-modal-backdrop" role="presentation" onMouseDown={onClose}><form className="siat-modal siat-small-modal" onSubmit={submit} onMouseDown={event => event.stopPropagation()}><header><div><small>Evento significativo</small><h2>Registrar contingencia</h2></div><button type="button" onClick={onClose} aria-label="Cerrar"><X /></button></header>
    <p className="siat-muted">Esta acción es administrativa: el agente solo la acepta si ya existe evidencia técnica de degradación. La operación normal es automática.</p>
    {query.isLoading && <SiatLoading />}{query.error && <SiatError message={query.error.message} />}
    <div className="siat-form-grid two"><label><span>Sucursal</span><select value={form.sucursalId} onChange={event => { field("sucursalId", event.target.value); field("puntoVentaId", ""); field("cufdId", ""); }}><option value="">Selecciona</option>{query.data?.sucursales.map(item => <option key={item.id} value={item.id}>{item.codigo} · {item.nombre}</option>)}</select></label><label><span>Punto de venta</span><select value={form.puntoVentaId} onChange={event => field("puntoVentaId", event.target.value)}><option value="">Selecciona</option>{branch?.puntosVenta.map(item => <option key={item.id} value={item.id}>{item.codigo} · {item.nombre}</option>)}</select></label><label><span>Tipo de evento sincronizado</span><select value={form.tipoEventoCodigo} onChange={event => field("tipoEventoCodigo", event.target.value)}><option value="">Selecciona</option>{query.data?.tiposEvento.map(item => <option key={item.codigo} value={item.codigo}>{item.codigo} · {item.descripcion}</option>)}</select></label><label><span>Fecha/hora de evidencia</span><input type="datetime-local" value={form.fechaInicio} onChange={event => field("fechaInicio", event.target.value)} /></label><label className="wide"><span>CUFD aprovisionado</span><select value={form.cufdId} onChange={event => field("cufdId", event.target.value)}><option value="">Selecciona CUFD</option>{cufd.map(item => <option key={item.id} value={item.id}>{item.etiqueta}</option>)}</select></label><label className="wide"><span>Descripción</span><input value={form.descripcion} onChange={event => field("descripcion", event.target.value)} /></label><label className="wide"><span>Evidencia / observaciones operativas</span><textarea value={form.observaciones} onChange={event => field("observaciones", event.target.value)} /></label></div>
    {message && <p className={`siat-form-message${register.isError ? " error" : ""}`}>{message}</p>}<footer className="siat-modal-actions"><button className="siat-primary-button" type="submit" disabled={register.isPending}>{register.isPending ? "Registrando…" : "Registrar en agente local"}</button></footer>
  </form></div>;
}

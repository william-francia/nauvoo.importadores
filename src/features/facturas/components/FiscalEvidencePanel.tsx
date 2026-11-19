import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { enviarCorreo9A, guardarNotificacion9A, guardarRevision9A, obtenerNotificaciones9A } from "../services/siat.gateway.service";

const PROTEGIDAS = new Set(["c2279bbb-e851-468b-afe6-8ebf0b436d28", "08dd889e-f2f7-4acb-be2e-2f911aae9919"]);
type Canal = "CORREO" | "WHATSAPP";
type Tipo = "RESPUESTA_ORIGINAL" | "CONSULTA_SIN" | "OTRA";

export default function FiscalEvidencePanel({ facturaId, estado, avisoAnulacion, avisoReversion, correoAutomatico }: { facturaId: string; estado: string; avisoAnulacion: string | null; avisoReversion: string | null; correoAutomatico: boolean }) {
  const client = useQueryClient(); const protectedInvoice = PROTEGIDAS.has(facturaId.toLowerCase());
  const pendingReview = estado === "ANULACION_PENDIENTE" || estado === "REVERSION_PENDIENTE";
  const [mode, setMode] = useState(estado === "ANULADA" ? "ENVIO_ANULACION" : estado === "REVERTIDA" ? "ENVIO_REVERSION" : "PREPARAR_ANULACION");
  const [canal, setCanal] = useState<Canal>("CORREO"); const [destinatario, setDestinatario] = useState("");
  const [evidencia, setEvidencia] = useState(""); const [confirmacion, setConfirmacion] = useState(false);
  const [fechaEnvio, setFechaEnvio] = useState("");
  const [tipo, setTipo] = useState<Tipo>("RESPUESTA_ORIGINAL"); const [dictamen, setDictamen] = useState<"NO_CONCLUYENTE" | "EVIDENCIA_PARA_REVISION">("NO_CONCLUYENTE");
  const [mensaje, setMensaje] = useState<string | null>(null);
  const status = useQuery({ queryKey: ["siat-9a-notificaciones", facturaId], queryFn: () => obtenerNotificaciones9A(facturaId), enabled: !protectedInvoice });
  const selectedOperation = mode.endsWith("REVERSION") ? "REVERSION" : "ANULACION";
  const aviso = selectedOperation === "REVERSION" ? avisoReversion : avisoAnulacion;
  const uncertainEmail = status.data?.notificaciones.some((item) => item.operacion === selectedOperation && item.estado === "PENDIENTE" && Boolean(item.envio_intentado_at)) === true;
  const send = useMutation({ mutationFn: async () => {
    if (!confirmacion) throw new Error("Confirme expresamente los datos y la evidencia.");
    if (pendingReview) return guardarRevision9A({ facturaId, tipo, dictamen, evidencia });
    const operacion = mode.endsWith("REVERSION") ? "REVERSION" : "ANULACION";
    if (mode.startsWith("AUTO")) {
      if (!correoAutomatico || !aviso) throw new Error("Correo automático o datos fiscales no disponibles.");
      return enviarCorreo9A({ facturaId, operacion, destinatario });
    }
    const etapa = mode.startsWith("CONFIRMAR") ? "CONFIRMAR_ENTREGA_MANUAL" : mode.startsWith("ENVIO") ? "REGISTRAR_ENVIO_MANUAL" : "PREPARAR";
    if (etapa !== "PREPARAR" && !aviso) throw new Error("Faltan datos fiscales para el aviso.");
    if (etapa !== "PREPARAR" && (!fechaEnvio || Number.isNaN(new Date(fechaEnvio).getTime()))) throw new Error("Indique la fecha y hora declaradas.");
    return guardarNotificacion9A({ facturaId, operacion, canal, destinatario, etapa, evidencia: etapa !== "PREPARAR" ? evidencia : undefined, fechaEnvio: etapa !== "PREPARAR" ? new Date(fechaEnvio).toISOString() : undefined });
  }, onSuccess: async () => {
    setMensaje(pendingReview ? "Revisión registrada; el estado fiscal no cambió y no se reenvió la operación." : mode.startsWith("AUTO") ? "Proveedor aceptó el envío; entrega no verificada." : mode.startsWith("CONFIRMAR") ? "Entrega confirmada por declaración administrativa con referencia de acuse." : mode.startsWith("ENVIO") ? "Envío manual declarado y evidencia registrada; entrega no verificada." : "Destinatario declarado y protegido; notificación pendiente.");
    setConfirmacion(false); setDestinatario(""); setEvidencia(""); setFechaEnvio(""); await client.invalidateQueries({ queryKey: ["siat-9a-notificaciones", facturaId] }); await client.invalidateQueries({ queryKey: ["siat-factura-detalle", facturaId] });
  }, onError: async (error) => { setMensaje(error.message); await client.invalidateQueries({ queryKey: ["siat-9a-notificaciones", facturaId] }); } });
  if (protectedInvoice) return <p className="siat-muted">Factura piloto anterior protegida: no se registran acciones nuevas.</p>;
  if (!["VALIDADA", "ANULADA", "REVERTIDA", "ANULACION_PENDIENTE", "REVERSION_PENDIENTE"].includes(estado)) return null;
  return <section className="siat-detail-section"><h3>{pendingReview ? "Revisión administrativa" : "Notificación privada"}</h3>
    {!pendingReview && <><p className="siat-muted">{correoAutomatico ? "Correo automático configurado; requiere confirmación expresa." : "Correo automático no configurado."} Abrir un canal o copiar el aviso no registra ningún envío. Los destinatarios se almacenan protegidos.</p>
      {status.data?.notificaciones.map((item) => <p key={item.operacion}>{item.operacion}: {item.estado === "ENTREGA_CONFIRMADA" ? "ENTREGA CONFIRMADA — acuse revisado por administración" : item.estado === "ENVIADA" ? item.evidencia_tipo === "PROVEEDOR_ACEPTO" ? "ENVIADA — aceptada por proveedor" : "ENVIADA — declarada por administración" : item.estado} · {item.canal} · {item.destinatario_mascara}{item.enviado_at ? ` · ${new Date(item.enviado_at).toLocaleString("es-BO")}` : ""}{item.estado === "PENDIENTE" && item.envio_intentado_at ? " · envío incierto: revisar proveedor antes de otra acción" : ""}</p>)}
      {status.error && <p className="error">No se pudo consultar el registro de notificaciones.</p>}
      <label>Acción <select value={mode} onChange={(event) => { setMode(event.target.value); if (event.target.value.startsWith("AUTO")) setCanal("CORREO"); setConfirmacion(false); }}>
        {estado === "VALIDADA" && <option value="PREPARAR_ANULACION">Preparar destinatario para anulación</option>}
        {estado === "ANULADA" && <><option value="ENVIO_ANULACION">Registrar envío manual de anulación</option>{correoAutomatico && <option value="AUTO_ANULACION">Enviar correo de anulación</option>}{status.data?.notificaciones.some((item) => item.operacion === "ANULACION" && item.estado === "ENVIADA") && <option value="CONFIRMAR_ANULACION">Registrar acuse de entrega</option>}<option value="PREPARAR_ANULACION">Preparar destinatario de anulación</option><option value="PREPARAR_REVERSION">Preparar destinatario para reversión</option></>}
        {estado === "REVERTIDA" && <><option value="ENVIO_REVERSION">Registrar envío manual de reversión</option>{correoAutomatico && <option value="AUTO_REVERSION">Enviar correo de reversión</option>}{status.data?.notificaciones.some((item) => item.operacion === "REVERSION" && item.estado === "ENVIADA") && <option value="CONFIRMAR_REVERSION">Registrar acuse de reversión</option>}<option value="PREPARAR_ANULACION">Preparar destinatario de anulación</option><option value="ENVIO_ANULACION">Registrar envío manual de anulación</option>{correoAutomatico && <option value="AUTO_ANULACION">Enviar correo de anulación</option>}{status.data?.notificaciones.some((item) => item.operacion === "ANULACION" && item.estado === "ENVIADA") && <option value="CONFIRMAR_ANULACION">Registrar acuse de anulación</option>}</>}
      </select></label>
      {!mode.startsWith("AUTO") && <label>Canal <select value={canal} onChange={(event) => { setCanal(event.target.value as Canal); setConfirmacion(false); }}><option value="CORREO">Correo manual</option><option value="WHATSAPP">WhatsApp manual</option></select></label>}
      <label>Destinatario real <input value={destinatario} onChange={(event) => { setDestinatario(event.target.value); setConfirmacion(false); }} placeholder={canal === "CORREO" ? "Correo del comprador" : "+código de país y número"} /></label>
      {(mode.startsWith("ENVIO") || mode.startsWith("AUTO") || mode.startsWith("CONFIRMAR")) && <p>{aviso ?? "Faltan datos fiscales o del emisor para construir el aviso."}</p>}
      {(mode.startsWith("ENVIO") || mode.startsWith("CONFIRMAR")) && <><label>Fecha y hora declaradas de {mode.startsWith("CONFIRMAR") ? "entrega" : "envío"} <input type="datetime-local" step="1" value={fechaEnvio} onChange={(event) => { setFechaEnvio(event.target.value); setConfirmacion(false); }} /></label><label>Referencia del {mode.startsWith("CONFIRMAR") ? "acuse de entrega" : "comprobante de envío"} <input value={evidencia} onChange={(event) => { setEvidencia(event.target.value); setConfirmacion(false); }} /></label><small>Conserve el comprobante original: NUVOO registra su huella; la revisión del acuse es responsabilidad administrativa.</small></>}
    </>}
    {pendingReview && <><p>Se conserva la respuesta original. Este registro no modifica el estado fiscal ni reenvía la operación.</p><label>Tipo de evidencia <select value={tipo} onChange={(event) => setTipo(event.target.value as Tipo)}><option value="RESPUESTA_ORIGINAL">Respuesta original</option><option value="CONSULTA_SIN">Consulta oficial ya realizada</option><option value="OTRA">Otra evidencia</option></select></label><label>Resultado de revisión <select value={dictamen} onChange={(event) => setDictamen(event.target.value as typeof dictamen)}><option value="NO_CONCLUYENTE">No concluyente</option><option value="EVIDENCIA_PARA_REVISION">Evidencia para revisión</option></select></label><label>Referencia de evidencia <input value={evidencia} onChange={(event) => { setEvidencia(event.target.value); setConfirmacion(false); }} /></label><small>Conserve la evidencia original; se almacena su huella.</small></>}
    <label><input type="checkbox" checked={confirmacion} onChange={(event) => setConfirmacion(event.target.checked)} /> {pendingReview ? "Confirmo la revisión y su evidencia." : mode.startsWith("AUTO") ? "Autorizo enviar este aviso al comprador indicado." : mode.startsWith("CONFIRMAR") ? "Declaro que revisé el acuse de entrega del comprador y conservo la evidencia." : mode.startsWith("ENVIO") ? "Declaro que envié el aviso al destinatario indicado y conservo el comprobante." : "Declaro que el destinatario indicado corresponde al comprador."}</label>
    <button type="button" className="siat-secondary-button" disabled={!confirmacion || send.isPending || (!pendingReview && !destinatario.trim()) || (!pendingReview && uncertainEmail && (mode.startsWith("AUTO") || mode.startsWith("ENVIO"))) || ((mode.startsWith("ENVIO") || mode.startsWith("CONFIRMAR")) && !pendingReview && !fechaEnvio) || ((pendingReview || mode.startsWith("ENVIO") || mode.startsWith("CONFIRMAR")) && evidencia.trim().length < 12)} onClick={() => send.mutate()}>{pendingReview ? "Registrar revisión" : mode.startsWith("AUTO") ? "Enviar correo" : mode.startsWith("CONFIRMAR") ? "Registrar acuse de entrega" : mode.startsWith("ENVIO") ? "Registrar envío declarado" : "Preparar destinatario"}</button>
    {mensaje && <p className="siat-form-message">{mensaje}</p>}
  </section>;
}

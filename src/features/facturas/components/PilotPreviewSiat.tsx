import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { aprobarCertificadoPilotoSiat, emitirFacturaPilotoSiat, habilitarAutorizacionPilotoSiat, prepararAutorizacionPilotoSiat, previsualizarFacturaPilotoSiat, verificarNitClientePilotoSiat } from "../services/siat.gateway.service";
import { obtenerFacturaSiat } from "../services/siat.service";

const CONFIRMACION = "AUTORIZO EMITIR ESTA UNICA FACTURA EN SIAT PILOTO";
const CONFIRMACION_CERTIFICADO = "DECLARO CONFIRMACION VERBAL REPORTADA POR EL USUARIO SOLO PARA SIAT PILOTO";
const CONFIRMACION_HABILITACION = "HABILITO SOLO ESTA AUTORIZACION PARA UNA FACTURA EN SIAT PILOTO";

export default function PilotPreviewSiat() {
  const [precio, setPrecio] = useState("5");
  const [descuento, setDescuento] = useState("0");
  const [confirmacion, setConfirmacion] = useState("");
  const [confirmacionCertificado, setConfirmacionCertificado] = useState("");
  const [confirmacionHabilitacion, setConfirmacionHabilitacion] = useState("");
  const [tipoEvidencia, setTipoEvidencia] = useState("PENDIENTE");
  const [previewConfirmado, setPreviewConfirmado] = useState<string | null>(null);
  const preview = useMutation({ mutationFn: () => previsualizarFacturaPilotoSiat(Number(precio), Number(descuento)) });
  const verifyNit = useMutation({ mutationFn: verificarNitClientePilotoSiat, onSuccess: () => { prepare.reset(); preview.mutate(); } });
  const approveCertificate = useMutation({ mutationFn: () => aprobarCertificadoPilotoSiat(confirmacionCertificado), onSuccess: () => { prepare.reset(); preview.mutate(); } });
  const prepare = useMutation({ mutationFn: () => prepararAutorizacionPilotoSiat(Number(precio), Number(descuento), preview.data!.previewHash) });
  const enable = useMutation({ mutationFn: () => habilitarAutorizacionPilotoSiat(prepare.data!.authorizationId, confirmacionHabilitacion), onSuccess: () => preview.mutate() });
  const issue = useMutation({ mutationFn: () => emitirFacturaPilotoSiat(prepare.data!.authorizationId, confirmacion) });
  const fiscalResult = useMutation({ mutationFn: () => obtenerFacturaSiat(issue.data!.facturaId) });
  const data = preview.data;
  const prepared = prepare.data;
  const precioConfirmado = Boolean(data && previewConfirmado === data.previewHash);
  const pending = preview.isPending || prepare.isPending || enable.isPending || issue.isPending || fiscalResult.isPending || verifyNit.isPending || approveCertificate.isPending;
  const change = (setter: (value: string) => void, value: string) => { setter(value); preview.reset(); prepare.reset(); enable.reset(); issue.reset(); fiscalResult.reset(); setPreviewConfirmado(null); setConfirmacion(""); setConfirmacionHabilitacion(""); };
  const canIssue = Boolean(data?.puedeConfirmar && prepared?.estado === "PREPARADA" && prepared.previewHash === data.previewHash
    && data.control.autorizacionHabilitadaId === prepared.authorizationId && precioConfirmado && confirmacion === CONFIRMACION);
  return <section className="siat-card">
    <div className="siat-card-title"><div><h3>Factura piloto aislada · vista previa</h3><p>Fixture no comercial. El preview no reserva número, no descuenta stock y no envía al SIN.</p></div></div>
    <div className="siat-form-grid">
      <label><span>Precio propuesto (Bs)</span><input type="number" min="0.01" step="0.01" value={precio} disabled={pending} onChange={(event) => change(setPrecio, event.target.value)} /></label>
      <label><span>Descuento propuesto (Bs)</span><input type="number" min="0" step="0.01" value={descuento} disabled={pending} onChange={(event) => change(setDescuento, event.target.value)} /></label>
    </div>
    <div className="siat-operation-actions"><button type="button" className="siat-secondary-button" disabled={pending || !precio} onClick={() => preview.mutate()}>{preview.isPending ? "Preparando…" : "Ver preview piloto"}</button></div>
    {preview.error && <p className="siat-form-message error">{preview.error.message}</p>}
    {data && <>
      {data.etapaPiloto === 2 && <p className="siat-form-message">Prueba de anulación 9A: una tercera factura piloto con autorización nueva. Las facturas 1 y 2 permanecen protegidas. Solo después de recibir 908 podrá preparar el destinatario real y solicitar anulación desde Gestión de facturas.</p>}
      {!data.codigos.cufdVigente && <p className="siat-form-message error">CUFD no vigente: solicite su renovación desde Configuración SIAT únicamente después de autorizar la prueba. El preview no lo renueva.</p>}
      <div className="siat-operation-grid">
      <span><small>Emisor</small><strong>NIT {data.emisor.nit} · actividad {data.emisor.actividad} · ambiente {data.codigoAmbiente}</strong></span>
      <span><small>Cliente</small><strong>{data.cliente.nombre} · {data.cliente.tipoDocumento} {data.cliente.documento}</strong></span>
      <span><small>Producto fixture</small><strong>{data.producto.cantidad} PIEZA · {data.producto.descripcion}</strong></span>
      <span><small>Clasificación SIN</small><strong>{data.producto.actividad} / producto {data.producto.codigoSin} / unidad {data.producto.unidadSin}</strong></span>
      <span><small>Pago</small><strong>{data.pago.metodo} / SIN {data.pago.codigoSin}</strong></span>
      <span><small>Importes</small><strong>Bs {data.montos.precio.toFixed(2)} − Bs {data.montos.descuento.toFixed(2)} = Bs {data.montos.total.toFixed(2)}</strong></span>
      <span><small>CUIS / CUFD</small><strong>{data.codigos.cuisVigente ? "Vigente" : "No vigente"} / {data.codigos.cufdVigente ? `Vigente hasta ${new Date(data.codigos.cufdVence!).toLocaleString("es-BO")}` : "No vigente"}</strong></span>
      <span><small>Certificado</small><strong>{data.certificadoFiscal.replaceAll("_", " ")}</strong></span>
      <span><small>Evidencia EKU</small><strong>{data.control.ekuTipoEvidencia ?? "Pendiente"}</strong></span>
      <span><small>Entorno</small><strong>PRUEBAS · una factura lógica · sin venta ni stock</strong></span>
      </div>
      <p className="siat-form-message">Bloqueos: {data.blockers.join(", ")}. Advertencia: {data.advertencias.join(", ")}.</p>
      {data.cliente.tipoDocumento === "NIT" && <>
        <div className="siat-operation-actions"><button type="button" className="siat-secondary-button" disabled={pending || data.control.nitClienteVerificado} onClick={() => verifyNit.mutate()}>Verificar NIT 9204357 en SIN Piloto</button></div>
        {verifyNit.data && <p className="siat-form-message">NIT: {verifyNit.data.resultado} ({verifyNit.data.codigo ?? "sin código"}). {verifyNit.data.aprobado || verifyNit.data.yaVerificado ? "Verificado." : "Emisión bloqueada."}</p>}
        {verifyNit.error && <p className="siat-form-message error">{verifyNit.error.message}</p>}
      </>}
      {!data.control.ekuFiscalAprobado && <>
        <p className="siat-form-message">La confirmación verbal fue reportada por el usuario; no equivale a autorización escrita del SIN. La declaración administrativa queda auditada y limitada a SIAT Piloto; no habilita transmisión.</p>
        <div className="siat-form-grid">
          <label className="wide"><span>Tipo de evidencia</span><select value={tipoEvidencia} disabled={pending} onChange={(event) => setTipoEvidencia(event.target.value)}><option value="PENDIENTE">Selecciona una opción</option><option value="CONFIRMACION_VERBAL_REPORTADA_POR_USUARIO">Confirmación verbal reportada por el usuario</option></select></label>
          {tipoEvidencia === "CONFIRMACION_VERBAL_REPORTADA_POR_USUARIO" && <label className="wide"><span>Declaración administrativa literal</span><input value={confirmacionCertificado} disabled={pending} onChange={(event) => setConfirmacionCertificado(event.target.value)} placeholder={CONFIRMACION_CERTIFICADO} /></label>}
        </div>
        <div className="siat-operation-actions"><button type="button" className="siat-secondary-button" disabled={pending || tipoEvidencia !== "CONFIRMACION_VERBAL_REPORTADA_POR_USUARIO" || confirmacionCertificado !== CONFIRMACION_CERTIFICADO} onClick={() => approveCertificate.mutate()}>Registrar declaración del certificado para PILOTO</button></div>
        {approveCertificate.error && <p className="siat-form-message error">{approveCertificate.error.message}</p>}
      </>}
      <label className="siat-form-message"><input type="checkbox" checked={precioConfirmado} disabled={pending} onChange={(event) => setPreviewConfirmado(event.target.checked ? data.previewHash : null)} /> Confirmo comprador {data.cliente.nombre}, {data.cliente.tipoDocumento} {data.cliente.documento}, cantidad {data.producto.cantidad}, precio final Bs {data.montos.precio.toFixed(2)}, descuento Bs {data.montos.descuento.toFixed(2)} y total Bs {data.montos.total.toFixed(2)}.</label>
      <div className="siat-operation-actions"><button type="button" className="siat-secondary-button" disabled={pending || !precioConfirmado || !data.control.ekuFiscalAprobado || !data.control.documentoListo || data.blockers.some((code) => !["PILOTO_EMISION_CERRADA", "AUTORIZACION_EXPLICITA_PENDIENTE"].includes(code))} onClick={() => prepare.mutate()}>Confirmar precio y preparar autorización individual (no emite)</button></div>
      {prepare.error && <p className="siat-form-message error">{prepare.error.message}</p>}
      {prepared && <p className="siat-form-message">Autorización {prepared.authorizationId}: {prepared.estado}. Prepararla no emite ni consume número.</p>}
      {prepared && data.control.ekuFiscalAprobado && data.control.documentoListo && !data.control.emisionHabilitada && <>
        <div className="siat-form-grid"><label className="wide"><span>Habilitación exclusiva de esta autorización</span><input value={confirmacionHabilitacion} disabled={pending} onChange={(event) => setConfirmacionHabilitacion(event.target.value)} placeholder={CONFIRMACION_HABILITACION} /></label></div>
        <div className="siat-operation-actions"><button type="button" className="siat-secondary-button" disabled={pending || confirmacionHabilitacion !== CONFIRMACION_HABILITACION} onClick={() => enable.mutate()}>Habilitar esta autorización (no emite)</button></div>
        {enable.error && <p className="siat-form-message error">{enable.error.message}</p>}
      </>}
      {prepared && <div className="siat-form-grid"><label className="wide"><span>Confirmación expresa para esta única factura</span><input value={confirmacion} disabled={!data.puedeConfirmar || pending} onChange={(event) => setConfirmacion(event.target.value)} placeholder={CONFIRMACION} /></label></div>}
      {prepared && <div className="siat-operation-actions"><button type="button" className="siat-primary-button" disabled={!canIssue || pending} onClick={() => issue.mutate()}>Confirmar y emitir UNA factura en SIAT Piloto</button></div>}
      {!data.puedeConfirmar && <p className="siat-form-message error">La transmisión sigue cerrada hasta aprobar el certificado y habilitar esta autorización individual.</p>}
      {issue.error && <p className="siat-form-message error">{issue.error.message}</p>}
      {issue.data && <p className="siat-form-message">Factura {issue.data.facturaId}: {issue.data.estado}. Revisar resultado fiscal antes de repetir acciones.</p>}
      {issue.data && <div className="siat-operation-actions"><button type="button" className="siat-secondary-button" disabled={pending} onClick={() => fiscalResult.mutate()}>Consultar resultado fiscal</button></div>}
      {fiscalResult.error && <p className="siat-form-message error">{fiscalResult.error.message}</p>}
      {fiscalResult.data && <p className="siat-form-message">Estado fiscal: {fiscalResult.data.estadoFiscal}. Recepción: {fiscalResult.data.codigoRecepcion ?? "pendiente"}. CUF: {fiscalResult.data.cuf ?? "pendiente"}. {fiscalResult.data.estadoFiscal === "SIN_RESPUESTA" ? "Esperar conciliación; no reenviar." : fiscalResult.data.estadoFiscal === "OBSERVADA" ? "Conservar observaciones; no emitir otra factura automáticamente." : ""}</p>}
    </>}
  </section>;
}

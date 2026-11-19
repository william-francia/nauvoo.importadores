import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import ClienteSelector from "../../features/ventas/components/ClienteSelector";
import PagoPanel from "../../features/ventas/components/PagoPanel";
import ProductoSelector from "../../features/ventas/components/ProductoSelector";
import VentaItemsTable from "../../features/ventas/components/VentaItemsTable";
import { useVentaDraft } from "../../features/ventas/hooks/useVentaDraft";
import type { ProductoVenta } from "../../features/ventas/types/ventas.types";
import {
  buscarClientesAgenteLocal,
  buscarProductosAgenteLocal,
  buscarProductosCafcAgenteLocal,
  listarCafcAgenteLocal,
  obtenerEstadoAgenteLocal,
  prepararTranscripcionCafcAgente,
  registrarVentaAgenteLocal,
} from "../../features/facturas/services/siat.local-agent.service";
import { vincularCafcVentaSiat } from "../../features/facturas/services/siat.gateway.service";
import { transcribirCafc } from "../../features/facturas/services/cafc-transcripcion";
import { finishOfflineSale, offlineSaleKey } from "../../features/facturas/services/offline-idempotency";
import { SiatLoading } from "../../features/facturas/components/SiatShared";
import "../../features/ventas/ventas.css";
import "../../features/facturas/styles/siat.css";

const money = (value: number) =>
  new Intl.NumberFormat("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

export default function RegistrarVentaOfflinePage() {
  const [mode, setMode] = useState<"DIGITAL" | "MANUAL_CAFC">("DIGITAL");
  const venta = useVentaDraft({ scope: "offline", allowNoStock: mode === "MANUAL_CAFC" });
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["siat-agente-local"], queryFn: obtenerEstadoAgenteLocal, refetchInterval: 15_000, retry: 1 });
  const cafc = useQuery({ queryKey: ["siat-cafc-local"], queryFn: listarCafcAgenteLocal, retry: 1 });
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const issuing = useRef(false);
  const [detalleExtraAbierto, setDetalleExtraAbierto] = useState(false);
  const [cafcId, setCafcId] = useState("");
  const [manualNumber, setManualNumber] = useState(0);
  const [evidence, setEvidence] = useState<File | null>(null);
  const [ventaOriginal, setVentaOriginal] = useState("");
  const [eventoOriginal, setEventoOriginal] = useState("");
  const [fechaOriginal, setFechaOriginal] = useState("");
  const [totalOriginal, setTotalOriginal] = useState("");
  const [totalIvaOriginal, setTotalIvaOriginal] = useState("");
  const [leyendaOriginal, setLeyendaOriginal] = useState("");
  const [metodoManual, setMetodoManual] = useState("EFECTIVO");
  const [tarjetaManual, setTarjetaManual] = useState("");
  const [revisionConfirmada, setRevisionConfirmada] = useState<string | null>(null);
  const [detalleOriginal, setDetalleOriginal] = useState<Record<string, { codigo: string; descripcion: string; subtotal: string }>>({});
  const available = mode === "DIGITAL" && status.data?.emisionOfflineHabilitada === true;
  const revisionActual = JSON.stringify({ ventaOriginal, eventoOriginal, cafcId, manualNumber, fechaOriginal, totalOriginal, totalIvaOriginal, leyendaOriginal, metodoManual, tarjetaManual, cliente: venta.cliente?.id, lineas: venta.lineas, descuento: venta.descuentoAdicional, detalleOriginal, archivo: evidence && [evidence.name, evidence.size, evidence.lastModified] });
  const revisado = revisionConfirmada !== null && revisionConfirmada === revisionActual;

  function add(product: ProductoVenta) {
    try { venta.agregarProducto(product); setMessage(null); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo agregar el producto."); }
  }

  async function pay(payment: { metodo: "EFECTIVO" | "TARJETA" | "TRANSFERENCIA" | "QR" | "OTRO"; montoRecibido: number; tarjetaOfuscada: string | null }) {
    if (issuing.current) return;
    if (!venta.cliente || !venta.lineas.length || !available) {
      setMessage("Selecciona cliente y productos, y verifica que exista una contingencia activa.");
      return;
    }
    issuing.current = true; setProcessing(true); setMessage(null); setSuccess(null);
    try {
      const idempotencyKey = offlineSaleKey(localStorage);
      const invoice = await registrarVentaAgenteLocal({
        idempotencyKey,
        cajaId: window.location.hostname || "CAJA-WEB",
        clienteId: venta.cliente.id,
        metodoPago: payment.metodo,
        tarjetaOfuscada: payment.tarjetaOfuscada,
        descuentoAdicional: venta.descuentoAdicional,
        observacion: venta.observacion,
        items: venta.lineas.map((line) => ({ productoId: line.producto.id, almacenId: line.almacen_id, cantidad: line.cantidad, precioUnitario: line.precio_unitario, descuento: line.descuento, informacionExtra: line.informacion_extra })),
      });
      setSuccess(`Factura offline N.º ${invoice.numeroFactura} guardada localmente. CUF ${invoice.cuf}.`);
      venta.limpiarVenta();
      finishOfflineSale(localStorage);
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["siat-agente-local"] }), queryClient.invalidateQueries({ queryKey: ["siat-ventas-offline-local"] })]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo emitir la factura offline.");
    } finally { issuing.current = false; setProcessing(false); }
  }

  async function transcribir() {
    if (!available || processing) { setMessage("PENDIENTE: la transcripción CAFC permanece bloqueada hasta autorizar contingencias piloto."); return; }
    setProcessing(true); setMessage(null); setSuccess(null);
    try {
      const result = await transcribirCafc({ ventaId: ventaOriginal.trim(), eventoId: eventoOriginal.trim(), cafcId, numeroFactura: manualNumber,
        fechaEmision: fechaOriginal, clienteId: venta.cliente?.id ?? "", metodoPago: metodoManual, tarjetaOfuscada: metodoManual === "TARJETA" && tarjetaManual.length === 8 ? `${tarjetaManual.slice(0, 4)}00000000${tarjetaManual.slice(4)}` : null,
        descuentoAdicional: venta.descuentoAdicional, totalOriginal, totalSujetoIva: totalIvaOriginal, leyenda: leyendaOriginal,
        items: venta.lineas.map(line => ({ productoId: line.producto.id, codigoOriginal: detalleOriginal[line.id]?.codigo ?? "", descripcionOriginal: detalleOriginal[line.id]?.descripcion ?? "", subtotalOriginal: detalleOriginal[line.id]?.subtotal ?? "", cantidad: line.cantidad, precioUnitario: line.precio_unitario, descuento: line.descuento })),
        originalRevisado: revisado, original: evidence }, { preparar: prepararTranscripcionCafcAgente, vincular: vincularCafcVentaSiat });
      if (result.estado === "PENDIENTE_CONCILIACION") setMessage(`PENDIENTE: ${result.motivo ?? "la venta no coincide o no está disponible; revisa cliente, pago, importes y detalle"}. No se creó una venta.`);
      else setSuccess("Comprobante vinculado a la venta existente. El envío fiscal continúa sujeto a autorización.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "PENDIENTE: no se pudo preparar la transcripción."); }
    finally { setProcessing(false); }
  }

  if (status.isLoading) return <div className="nueva-venta-page siat-offline-sale-page"><SiatLoading /></div>;

  return (
    <div className="nueva-venta-page siat-offline-sale-page">
      <header className="venta-page-header">
        <div>
          <div className="venta-breadcrumb">Facturas <span>›</span> Registrar venta offline</div>
          <h1>Registrar Venta</h1>
          <p>Registra productos, selecciona el cliente y completa el pago durante la contingencia.</p>
        </div>
      </header>

      {status.error && <div className="venta-alert venta-alert--error"><AlertTriangle size={18} />No se pudo consultar el estado del agente local.</div>}
      <div className={`venta-alert ${available ? "venta-alert--success" : "venta-alert--error"}`}>
        {available ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
        {available ? "Contingencia activa: la factura se guardará localmente para su posterior envío al SIAT." : "Emisión fuera de línea bloqueada: pendiente de validación y autorización de contingencias."}
      </div>
      {message && <div className="venta-alert venta-alert--error"><AlertTriangle size={18} />{message}</div>}
      {success && <div className="venta-alert venta-alert--success"><CheckCircle2 size={18} />{success}</div>}

      <div className="venta-layout">
        <main className="venta-main">
          <section className="venta-panel">
            <button type="button" className="venta-collapse-header" onClick={() => setDetalleExtraAbierto((open) => !open)}>
              <span><b>⊕</b> DETALLE EXTRA</span><span>{detalleExtraAbierto ? "−" : "+"}</span>
            </button>
            {detalleExtraAbierto ? (
              <div className="siat-offline-extra-grid">
                <textarea className="venta-observacion" value={venta.observacion} onChange={(event) => venta.setObservacion(event.target.value)} placeholder="Observación de la venta" />
                <div className="siat-manual-mode">
                  <label>Tipo de contingencia
                    <select value={mode} onChange={(event) => setMode(event.target.value as "DIGITAL" | "MANUAL_CAFC")}>
                      <option value="DIGITAL">Factura digital offline</option>
                      <option value="MANUAL_CAFC" disabled={!cafc.data?.length}>Transcripción manual CAFC</option>
                    </select>
                  </label>
                  {mode === "MANUAL_CAFC" && <>
                    <label>Rango CAFC<select value={cafcId} onChange={(event) => setCafcId(event.target.value)}><option value="">Selecciona rango</option>{cafc.data?.map((item) => <option key={item.id} value={item.id}>{item.autorizacion} · {item.rangoDesde}-{item.rangoHasta}</option>)}</select></label>
                    <label>Identificador de venta original<input value={ventaOriginal} onChange={event => setVentaOriginal(event.target.value)} placeholder="UUID de la venta confirmada" /></label>
                    <label>Identificador del evento cerrado<input value={eventoOriginal} onChange={event => setEventoOriginal(event.target.value)} placeholder="UUID del evento con este CAFC" /></label>
                    <label>Número físico<input type="number" min="1" value={manualNumber || ""} onChange={(event) => setManualNumber(Number(event.target.value))} /></label>
                    <label>Fecha y hora del original (Bolivia)<input type="datetime-local" value={fechaOriginal} onChange={event => setFechaOriginal(event.target.value)} /></label>
                    <label>Total del comprobante (Bs)<input type="number" min="0" step="0.01" value={totalOriginal} onChange={event => setTotalOriginal(event.target.value)} /></label>
                    <label>Importe sujeto a IVA (Bs)<input type="number" min="0" step="0.01" value={totalIvaOriginal} onChange={event => setTotalIvaOriginal(event.target.value)} /></label>
                    <label>Leyenda del comprobante<input value={leyendaOriginal} onChange={event => setLeyendaOriginal(event.target.value)} /></label>
                    <label>Método de pago<select value={metodoManual} onChange={event => setMetodoManual(event.target.value)}><option value="EFECTIVO">Efectivo</option><option value="TARJETA">Tarjeta</option><option value="TRANSFERENCIA">Transferencia</option><option value="QR">QR</option><option value="OTRO">Otro</option></select></label>
                    {metodoManual === "TARJETA" && <label>Primeros y últimos 4 dígitos de tarjeta<input inputMode="numeric" maxLength={8} value={tarjetaManual} onChange={event => setTarjetaManual(event.target.value.replace(/\D/g, ""))} /></label>}
                    <label>Evidencia del original<input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return setEvidence(null);
                      if (file.size > 8_000_000) { setEvidence(null); return setMessage("La evidencia no puede superar 8 MB."); }
                      setEvidence(file); setRevisionConfirmada(null);
                    }} /></label>
                    <label><input type="checkbox" checked={revisado} onChange={event => setRevisionConfirmada(event.target.checked ? revisionActual : null)} /> Confirmo que cliente, producto y homologación, cantidades, precios, descuentos, pago y datos fiscales coinciden con el comprobante original.</label>
                  </>}
                </div>
              </div>
            ) : <div className="venta-none">Ninguno</div>}
          </section>

          <section className="venta-panel">
            <ProductoSelector soloFiscal={mode === "MANUAL_CAFC"} onAgregar={add} buscar={mode === "MANUAL_CAFC" ? buscarProductosCafcAgenteLocal : buscarProductosAgenteLocal} />
            <div className="venta-table-container"><VentaItemsTable soloFiscal={mode === "MANUAL_CAFC"} lineas={venta.lineas} onCantidad={venta.actualizarCantidad} onAlmacen={venta.actualizarAlmacen} onPrecio={venta.actualizarPrecio} onDescuento={venta.actualizarDescuento} onInformacionExtra={venta.actualizarInformacionExtra} onEliminar={venta.eliminarLinea} /></div>
            {mode === "MANUAL_CAFC" && venta.lineas.map(line => <div key={line.id}><strong>{line.producto.nombre}: datos del comprobante original</strong><label>Código original<input value={detalleOriginal[line.id]?.codigo ?? ""} onChange={event => setDetalleOriginal(current => ({ ...current, [line.id]: { codigo: event.target.value, descripcion: current[line.id]?.descripcion ?? "", subtotal: current[line.id]?.subtotal ?? "" } }))} /></label><label>Descripción original<input value={detalleOriginal[line.id]?.descripcion ?? ""} onChange={event => setDetalleOriginal(current => ({ ...current, [line.id]: { codigo: current[line.id]?.codigo ?? "", descripcion: event.target.value, subtotal: current[line.id]?.subtotal ?? "" } }))} /></label><label>Subtotal original (Bs)<input type="number" min="0" step="0.01" value={detalleOriginal[line.id]?.subtotal ?? ""} onChange={event => setDetalleOriginal(current => ({ ...current, [line.id]: { codigo: current[line.id]?.codigo ?? "", descripcion: current[line.id]?.descripcion ?? "", subtotal: event.target.value } }))} /></label></div>)}
            <div className="venta-totales">
              <div><span>SUB-TOTAL</span><strong>{money(venta.totales.subtotal)} BOB</strong></div>
              <div><span>DESCUENTO PRODUCTOS</span><strong>{money(venta.totales.descuentoLineas)} BOB</strong></div>
              <div><span>DESCUENTO ADICIONAL</span><div className="venta-discount-input"><input type="number" min="0" value={venta.descuentoAdicional} onChange={(event) => venta.setDescuentoAdicional(Math.max(0, Number(event.target.value)))} /><span>BOB</span></div></div>
              <div className="venta-totales__total"><span>TOTAL A PAGAR</span><strong>{money(venta.totales.total)} BOB</strong></div>
            </div>
          </section>
        </main>
        <aside className="venta-sidebar">
          <section className="venta-panel"><ClienteSelector cliente={venta.cliente} onSeleccionar={venta.setCliente} onNuevoCliente={() => setMessage("Durante la contingencia solo pueden usarse clientes previamente aprovisionados.")} buscar={buscarClientesAgenteLocal} /></section>
          {mode === "MANUAL_CAFC" ? <section className="venta-panel"><p>La vinculación comprueba la venta existente y no modifica inventario. El CAFC y CUFD se verifican contra el evento cerrado.</p><button type="button" disabled={!available || processing} onClick={() => void transcribir()}>PREPARAR TRANSCRIPCIÓN CAFC</button><p>Transcripción y envío fiscal bloqueados hasta su autorización piloto.</p></section> :
            <PagoPanel total={venta.totales.total} bloqueado={!available || !venta.cliente || venta.lineas.length === 0} procesando={processing} etiquetaBoton="REALIZAR VENTA OFFLINE" onPagar={pay} />}
        </aside>
      </div>
    </div>
  );
}

import { useState } from "react";
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
  listarCafcAgenteLocal,
  obtenerEstadoAgenteLocal,
  registrarVentaAgenteLocal,
} from "../../features/facturas/services/siat.local-agent.service";
import { SiatLoading } from "../../features/facturas/components/SiatShared";
import "../../features/ventas/ventas.css";
import "../../features/facturas/styles/siat.css";

const money = (value: number) =>
  new Intl.NumberFormat("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);

export default function RegistrarVentaOfflinePage() {
  const venta = useVentaDraft();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: ["siat-agente-local"], queryFn: obtenerEstadoAgenteLocal, refetchInterval: 15_000, retry: 1 });
  const cafc = useQuery({ queryKey: ["siat-cafc-local"], queryFn: listarCafcAgenteLocal, retry: 1 });
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [detalleExtraAbierto, setDetalleExtraAbierto] = useState(false);
  const [mode, setMode] = useState<"DIGITAL" | "MANUAL_CAFC">("DIGITAL");
  const [cafcId, setCafcId] = useState("");
  const [manualNumber, setManualNumber] = useState(0);
  const [evidence, setEvidence] = useState<{ data: string; mime: string } | null>(null);
  const available = status.data?.state === "OFFLINE" && Boolean(status.data.event);

  function add(product: ProductoVenta) {
    try { venta.agregarProducto(product); setMessage(null); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo agregar el producto."); }
  }

  async function pay(payment: { metodo: "EFECTIVO" | "TARJETA" | "TRANSFERENCIA" | "QR" | "OTRO"; montoRecibido: number; tarjetaOfuscada: string | null }) {
    if (!venta.cliente || !venta.lineas.length || !available) {
      setMessage("Selecciona cliente y productos, y verifica que exista una contingencia activa.");
      return;
    }
    setProcessing(true); setMessage(null); setSuccess(null);
    try {
      if (mode === "MANUAL_CAFC" && (!cafcId || manualNumber <= 0 || !evidence)) throw new Error("Selecciona rango, número y evidencia de la factura manual CAFC.");
      const invoice = await registrarVentaAgenteLocal({
        idempotencyKey: `caja:${crypto.randomUUID()}`,
        cajaId: window.location.hostname || "CAJA-WEB",
        clienteId: venta.cliente.id,
        metodoPago: payment.metodo,
        tarjetaOfuscada: payment.tarjetaOfuscada,
        descuentoAdicional: venta.descuentoAdicional,
        observacion: venta.observacion,
        items: venta.lineas.map((line) => ({ productoId: line.producto.id, almacenId: line.almacen_id, cantidad: line.cantidad, precioUnitario: line.precio_unitario, descuento: line.descuento, informacionExtra: line.informacion_extra })),
        manualCafc: mode === "MANUAL_CAFC" && evidence ? { rangeId: cafcId, numero: manualNumber, evidenciaBase64: evidence.data, evidenciaMime: evidence.mime } : undefined,
      });
      setSuccess(`Factura offline N.º ${invoice.numeroFactura} guardada localmente. CUF ${invoice.cuf}.`);
      venta.limpiarVenta();
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["siat-agente-local"] }), queryClient.invalidateQueries({ queryKey: ["siat-ventas-offline-local"] })]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo emitir la factura offline.");
    } finally { setProcessing(false); }
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
        {available ? "Contingencia activa: la factura se guardará localmente para su posterior envío al SIAT." : `Emisión bloqueada: agente ${status.data?.state ?? "no disponible"} o sin evento activo.`}
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
                    <label>Número físico<input type="number" min="1" value={manualNumber || ""} onChange={(event) => setManualNumber(Number(event.target.value))} /></label>
                    <label>Evidencia del original<input type="file" accept="image/*,application/pdf" onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return setEvidence(null);
                      if (file.size > 8_000_000) return setMessage("La evidencia no puede superar 8 MB.");
                      const reader = new FileReader();
                      reader.onload = () => setEvidence({ data: String(reader.result), mime: file.type || "application/octet-stream" });
                      reader.readAsDataURL(file);
                    }} /></label>
                  </>}
                </div>
              </div>
            ) : <div className="venta-none">Ninguno</div>}
          </section>

          <section className="venta-panel">
            <ProductoSelector onAgregar={add} buscar={buscarProductosAgenteLocal} />
            <div className="venta-table-container"><VentaItemsTable lineas={venta.lineas} onCantidad={venta.actualizarCantidad} onAlmacen={venta.actualizarAlmacen} onPrecio={venta.actualizarPrecio} onDescuento={venta.actualizarDescuento} onInformacionExtra={venta.actualizarInformacionExtra} onEliminar={venta.eliminarLinea} /></div>
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
          <PagoPanel total={venta.totales.total} bloqueado={!available || !venta.cliente || venta.lineas.length === 0} procesando={processing} etiquetaBoton="REALIZAR VENTA OFFLINE" onPagar={pay} />
        </aside>
      </div>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import "./styles/gestionVentas.css";
import "../facturas/styles/siat.css";
import GestionVentasTable from "./components/gestion/GestionVentasTable";
import SinDetailsModal from "./components/gestion/SinDetailsModal";
import ResendEmailModal from "./components/gestion/ResendEmailModal";
import FiscalOperationModal from "./components/gestion/FiscalOperationModal";
import { FacturaDetalleModal } from "../facturas/components/SiatShared";
import { listarFacturasSiat, obtenerFacturaSiat } from "../facturas/services/siat.service";
import { ejecutarAccionDocumentoFiscal, type AccionDocumentoFiscal } from "../facturas/services/documentos-fiscales.service";
import { obtenerCapacidadCorreoFactura, reenviarCorreoFactura } from "../facturas/services/siat.gateway.service";
import { useGestionVentas } from "./hooks/useGestionVentas";
import { listarVentasGestion } from "./services/ventas.api";
import { datosSin, integrarFacturasEnVentas, motivoDocumentoNoDisponible } from "./services/gestion-documentos";
import type { FacturaAction, GestionVenta } from "./types/gestionVentas.types";
import type { FacturaSiatResumen } from "../facturas/types/siat.types";
import { usePermissions } from "../account/hooks/useCurrentAccount";

export default function GestionVentasPage() {
  const permissions = usePermissions();
  const admin = permissions.data?.role?.toLowerCase() === "administrador";
  const ventasQuery = useQuery({ queryKey: ["gestion-ventas"], queryFn: listarVentasGestion, refetchInterval: 30000, refetchOnMount: "always" });
  // Comparte el mismo origen/cache con Gestión de facturas; actualiza también al volver a la pestaña.
  const facturasQuery = useQuery({ queryKey: ["siat-facturas"], queryFn: listarFacturasSiat, refetchInterval: 15000, refetchOnMount: "always" });
  const ventas = useMemo(() => integrarFacturasEnVentas(ventasQuery.data ?? [], facturasQuery.data ?? []), [ventasQuery.data, facturasQuery.data]);
  const gestion = useGestionVentas(ventas);
  const [detalle, setDetalle] = useState<FacturaSiatResumen | null>(null);
  const [ventaSin, setVentaSin] = useState<GestionVenta | null>(null);
  const [correoVenta, setCorreoVenta] = useState<GestionVenta | null>(null);
  const [fiscalOperation, setFiscalOperation] = useState<{ factura: FacturaSiatResumen; kind: "cancel" | "reverse" } | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rollWidth, setRollWidth] = useState(80);
  const correo = useQuery({ queryKey: ["siat-correo-factura-capacidad"], queryFn: obtenerCapacidadCorreoFactura, enabled: admin && Boolean(correoVenta), retry: false, staleTime: 0 });
  const error = ventasQuery.error ?? facturasQuery.error;
  const documentActions: Partial<Record<FacturaAction, AccionDocumentoFiscal>> = { PDF_ROLLO: "PDF_ROLLO", PDF_MEDIO_OFICIO: "PDF_CARTA", XML: "XML", URL_SIN: "CONSULTA" };

  async function handleAction(action: FacturaAction, venta: GestionVenta) {
    if (!venta.facturaId || !venta.factura) { setNotification("Esta venta no tiene factura electrónica asociada. No se generará un documento fiscal ni una venta adicional."); return; }
    if (action === "ANULAR" || action === "REVERTIR") {
      if (!admin) { setNotification("Esta operación requiere administración."); return; }
      setFiscalOperation({ factura: venta.factura, kind: action === "ANULAR" ? "cancel" : "reverse" }); return;
    }
    setNotification(null);
    if (action === "VER") { setDetalle(venta.factura); return; }
    if (busy) return;
    if (action !== "SIN") {
      const reason = motivoDocumentoNoDisponible(venta, admin);
      if (reason) { setNotification(reason); return; }
    }
    if (action === "REENVIAR_CORREO") { setCorreoVenta(venta); return; }
    const documentAction = documentActions[action];
    const target = documentAction === "CONSULTA" ? window.open("", "_blank") : undefined;
    if (target === null) { setNotification("El navegador bloqueó la nueva ventana."); return; }
    if (target) target.opener = null;
    setBusy(true);
    try {
      const invoice = await obtenerFacturaSiat(venta.facturaId);
      if (action === "SIN") setVentaSin({ ...venta, sin: datosSin(invoice) });
      else if (documentAction) await ejecutarAccionDocumentoFiscal(invoice, documentAction, rollWidth, target);
    } catch (e) { target?.close(); setNotification(e instanceof Error ? e.message : "No se pudo consultar el documento."); }
    finally { setBusy(false); }
  }

  return <div className="gestion-ventas-page">
    <header className="gestion-page-header"><div><div className="gestion-breadcrumb"><span>Ventas</span><span>›</span><span>Gestión de ventas</span></div>
      <h1>Gestión de Ventas</h1><p>Ventas comerciales y documentos fiscales, con sus estados y ambientes diferenciados.</p></div>
      <div className="gestion-page-actions"><button type="button" className="gestion-button gestion-button--outline" onClick={() => setNotification("La exportación general se conectará posteriormente.")}>↓ Exportar</button><button type="button" className="gestion-button gestion-button--outline" onClick={() => setNotification("La exportación detallada se conectará posteriormente.")}>↓ Exportar detalles</button></div>
    </header>
    {notification && <div className="gestion-notification gestion-notification--info" role="status"><p>{notification}</p><button type="button" onClick={() => setNotification(null)} aria-label="Cerrar aviso">×</button></div>}
    {error && <div className="gestion-notification gestion-notification--warning" role="alert"><p>{error.message} No se pudo actualizar toda la información.</p></div>}
    <section className="gestion-card">
      <div className="gestion-card-header"><div><h2>Ventas y facturas registradas</h2><span>{ventasQuery.isLoading || facturasQuery.isLoading ? "Cargando datos reales…" : gestion.ventasFiltradas.length + " resultados"}</span></div>
        <div className="gestion-page-actions"><label>Rollo <select aria-label="Ancho de PDF rollo" value={rollWidth} onChange={e => setRollWidth(Number(e.target.value))}><option value={80}>80 mm</option><option value={58}>58 mm</option></select></label><button type="button" className="gestion-clear-filters" disabled={ventasQuery.isFetching || facturasQuery.isFetching} onClick={() => { void ventasQuery.refetch(); void facturasQuery.refetch(); }}>Actualizar</button><button type="button" className="gestion-clear-filters" onClick={gestion.limpiarFiltros}>↻ Limpiar filtros</button></div>
      </div>
      <p className="gestion-document-note">Los documentos sin venta comercial se muestran solo para consulta; no representan ingresos, pagos ni movimientos de inventario. Actualización fiscal automática cada 15 segundos.</p>
      {busy && <p role="status" className="gestion-document-note">Consultando el documento seleccionado…</p>}
      <GestionVentasTable ventas={gestion.ventasPagina} filters={gestion.filters} onFilterChange={gestion.actualizarFiltro} onAction={(action, venta) => { void handleAction(action, venta); }} canIssueInvoice={permissions.can("invoices.issue")} />
      <footer className="gestion-pagination"><div className="gestion-page-size"><span>Filas por página</span><select value={gestion.porPagina} onChange={e => { gestion.setPorPagina(Number(e.target.value)); gestion.setPagina(1); }}><option value={10}>10</option><option value={20}>20</option><option value={50}>50</option></select></div><div className="gestion-pagination__info">{gestion.desde}-{gestion.hasta} de {gestion.ventasFiltradas.length}</div><div className="gestion-pagination__buttons"><button type="button" disabled={gestion.pagina <= 1} aria-label="Página anterior" onClick={() => gestion.setPagina(gestion.pagina - 1)}>‹</button><span>{gestion.pagina} / {gestion.totalPaginas}</span><button type="button" disabled={gestion.pagina >= gestion.totalPaginas} aria-label="Página siguiente" onClick={() => gestion.setPagina(gestion.pagina + 1)}>›</button></div></footer>
    </section>
    <FacturaDetalleModal key={detalle?.id ?? "sin-factura"} factura={detalle} onClose={() => setDetalle(null)} canManage={false} />
    <SinDetailsModal venta={ventaSin} onCerrar={() => setVentaSin(null)} />
    <ResendEmailModal venta={correoVenta} onCerrar={() => setCorreoVenta(null)} disponible={correo.data?.disponible === true} motivo={correo.error?.message ?? (correo.isLoading ? "Verificando configuración del proveedor…" : correo.data?.motivo ?? "Correo pendiente de configuración del gateway.")}
      onEnviar={async (venta, destinatario, idempotencia) => {
        const result = await reenviarCorreoFactura({ facturaId: venta.facturaId!, destinatario, idempotencia, confirmacion: true });
        setNotification(result.estado === "ENVIADA" ? "El proveedor aceptó el correo con PDF y XML. La entrega al destinatario no está confirmada." : "El resultado del correo es incierto. No repitas el envío; requiere revisión administrativa.");
        setCorreoVenta(null);
      }} />
    {fiscalOperation && <FiscalOperationModal key={`${fiscalOperation.factura.id}:${fiscalOperation.kind}`} factura={fiscalOperation.factura} kind={fiscalOperation.kind} onClose={() => setFiscalOperation(null)} onNotice={setNotification} />}
  </div>;
}

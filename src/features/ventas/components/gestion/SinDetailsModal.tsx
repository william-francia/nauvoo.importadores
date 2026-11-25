import type { GestionVenta } from "../../types/gestionVentas.types";
export default function SinDetailsModal({ venta, onCerrar }: { venta: GestionVenta | null; onCerrar: () => void }) {
  if (!venta) return null;
  const sin = venta.sin;
  return <div className="gestion-modal-backdrop" onMouseDown={onCerrar}><section className="gestion-modal gestion-modal--sin" role="dialog" aria-modal="true" aria-labelledby="sin-details-title" onMouseDown={event => event.stopPropagation()}>
    <header className="gestion-modal__header"><div><h2 id="sin-details-title">Información del S.I.N.</h2><p>Factura #{venta.numeroFactura}</p></div><button type="button" className="gestion-modal__close" onClick={onCerrar} aria-label="Cerrar">×</button></header>
    <div className="gestion-modal__body">{!sin ? <p>No existe información fiscal asociada a esta venta.</p> : <>
      <p className="sin-caption">Datos fiscales persistidos en Supabase</p><div className="sin-details">
        <div><strong>Ambiente</strong><span>{sin.ambiente ?? "—"}</span></div><div><strong>Estado fiscal</strong><span>{sin.codigoDescripcion}</span></div>
        <div><strong>CUF</strong><span>{sin.cuf}</span></div><div><strong>Fecha de emisión</strong><span>{sin.fechaEmision}</span></div>
        <div><strong>Número de factura</strong><span>{sin.numeroFactura}</span></div><div><strong>Sucursal / punto de venta</strong><span>{sin.codigoSucursal} / {sin.codigoPuntoVenta}</span></div>
        <div><strong>Código de estado SIN</strong><span>{sin.codigoEstado ?? "Sin respuesta"}</span></div><div><strong>Transacción</strong><span>{sin.transaccion == null ? "Sin respuesta concluyente" : String(sin.transaccion)}</span></div>
        <div><strong>Código de recepción</strong><span>{sin.codigoRecepcion ?? "No registrado"}</span></div><div><strong>Mensajes SIN</strong><span>{sin.log ?? "Sin mensajes registrados"}</span></div>
      </div><p className="sin-notice">Esta vista no ejecuta consultas ni reintentos ante el SIN.</p>
    </>}</div><footer className="gestion-modal__footer"><button type="button" className="gestion-button gestion-button--ghost" onClick={onCerrar}>Cerrar</button></footer>
  </section></div>;
}

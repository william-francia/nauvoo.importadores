import { ArrowRight, Box, PackageSearch, Trophy, TriangleAlert, X } from "lucide-react";
import type { DashboardProductStock, DashboardTopProduct } from "../types/dashboard.types";
import { CRITICAL_STOCK_LIMIT } from "../hooks/useDashboardData";
import { quantityFormatter } from "../utils/dashboard.format";

interface DashboardDetailsPanelProps {
  products?: DashboardProductStock[];
  lowStockProducts?: DashboardProductStock[];
  topProducts?: DashboardTopProduct[];
  isLoading: boolean;
  errorMessage?: string;
  onClose: () => void;
  onSeeInventory: () => void;
  onSeeSales: () => void;
}

function SectionHeader({ icon, title, action, onAction }: { icon: React.ReactNode; title: string; action: string; onAction: () => void }) {
  return <header className="details-section__header"><span>{icon}</span><h4>{title}</h4><button type="button" onClick={onAction}>{action}<ArrowRight /></button></header>;
}

function EmptyRow({ children }: { children: React.ReactNode }) {
  return <p className="details-section__empty">{children}</p>;
}

export function DashboardDetailsPanel({ products, lowStockProducts, topProducts, isLoading, errorMessage, onClose, onSeeInventory, onSeeSales }: DashboardDetailsPanelProps) {
  return <aside className="dashboard-details" aria-label="Detalle de la semana">
    <header className="dashboard-details__header"><div><h3>Detalle de la semana</h3><p>Información adicional de productos y ventas.</p></div><button type="button" onClick={onClose} aria-label="Cerrar detalle"><X /></button></header>
    {isLoading && <div className="business-dashboard-state"><span className="business-dashboard-spinner" />Cargando detalle…</div>}
    {!isLoading && errorMessage && <div className="business-dashboard-state business-dashboard-state--error">{errorMessage}</div>}
    {!isLoading && !errorMessage && <div className="dashboard-details__body">
      <section className="details-section">
        <SectionHeader icon={<Box />} title="Productos" action="Ver todos" onAction={onSeeInventory} />
        <div className="details-section__total"><PackageSearch /> <span><strong>{products?.length ?? 0}</strong> productos activos</span></div>
        {(products?.length ?? 0) === 0 ? <EmptyRow>No existen productos registrados.</EmptyRow> : <ul>{products?.slice(0, 3).map((product) => <li key={product.id}><div><strong>{product.name}</strong><small>SKU: {product.sku}</small></div><span>{quantityFormatter.format(product.stock)} unidades</span></li>)}</ul>}
      </section>
      <section className="details-section">
        <SectionHeader icon={<TriangleAlert />} title="Productos con stock bajo" action="Ver todos" onAction={onSeeInventory} />
        {(lowStockProducts?.length ?? 0) === 0 ? <EmptyRow>Inventario sin alertas de stock.</EmptyRow> : <ul>{lowStockProducts?.slice(0, 4).map((product) => {
          const critical = product.stock < CRITICAL_STOCK_LIMIT;
          return <li key={product.id}><div><strong>{product.name}</strong><small>SKU: {product.sku}</small></div><span className={`stock-pill ${critical ? "stock-pill--critical" : ""}`}>{quantityFormatter.format(product.stock)} un. · {critical ? "Crítico" : "Bajo"}</span></li>;
        })}</ul>}
      </section>
      <section className="details-section">
        <SectionHeader icon={<Trophy />} title="Productos más vendidos" action="Ver ventas" onAction={onSeeSales} />
        {(topProducts?.length ?? 0) === 0 ? <EmptyRow>Aún no hay ventas esta semana.</EmptyRow> : <ol>{topProducts?.slice(0, 4).map((product) => <li key={product.id}><div><strong>{product.name}</strong><small>SKU: {product.sku}</small></div><span>{quantityFormatter.format(product.quantity)} unidades</span></li>)}</ol>}
      </section>
    </div>}
  </aside>;
}

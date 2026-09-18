import { useState } from "react";
import { useNavigate } from "react-router";
import { DashboardDetailsPanel } from "./components/DashboardDetailsPanel";
import { DashboardStats } from "./components/DashboardStats";
import { WeeklySalesChart } from "./components/WeeklySalesChart";
import { useDashboardData } from "./hooks/useDashboardData";
import "./dashboard.css";

export default function DashboardHome() {
  const navigate = useNavigate();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const query = useDashboardData();
  const errorMessage = query.error instanceof Error ? "No se pudo cargar la información del Dashboard." : undefined;

  return <>
    <section className="page-heading">
      <div><p className="breadcrumb">Inicio / Dashboard</p><h1>Página Principal</h1><p className="page-description">Resumen general de Ferretería Francia.</p></div>
      <div className="heading-status"><span className="status-dot" />Sistema activo</div>
    </section>
    <DashboardStats
      todaySales={query.summary?.todaySales}
      todayChange={query.summary?.todayChange}
      weekSales={query.summary?.weekSales}
      weekChange={query.summary?.weekChange}
      alerts={query.summary?.lowStockProducts.length}
      isLoading={query.isLoading}
    />
    <section className={`business-dashboard-main ${detailsOpen ? "business-dashboard-main--expanded" : ""}`}>
      <WeeklySalesChart data={query.summary?.weeklySales} isLoading={query.isLoading} errorMessage={errorMessage} detailsOpen={detailsOpen} onToggleDetails={() => setDetailsOpen((open) => !open)} />
      {detailsOpen && <DashboardDetailsPanel
        products={query.summary?.products}
        lowStockProducts={query.summary?.lowStockProducts}
        topProducts={query.summary?.topProducts}
        isLoading={query.isLoading}
        errorMessage={errorMessage}
        onClose={() => setDetailsOpen(false)}
        onSeeInventory={() => navigate("/productos/inventario")}
        onSeeSales={() => navigate("/ventas/gestion")}
      />}
    </section>
  </>;
}

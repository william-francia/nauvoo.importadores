import { BarChart3, Bell, ShoppingCart } from "lucide-react";
import { formatMoney } from "../utils/dashboard.format";

interface DashboardStatsProps {
  todaySales?: number;
  todayChange?: number | null;
  weekSales?: number;
  weekChange?: number | null;
  alerts?: number;
  isLoading: boolean;
}

function Comparison({ value, label }: { value: number | null | undefined; label: string }) {
  if (value === undefined) return <span className="business-stat__meta">—</span>;
  if (value === null) return <span className="business-stat__meta">Sin comparación disponible</span>;
  const trend = value > 0 ? "positive" : value < 0 ? "negative" : "neutral";
  return <span className={`business-stat__comparison business-stat__comparison--${trend}`}>
    {value > 0 ? "↗" : value < 0 ? "↘" : "→"} {Math.abs(value).toFixed(0)}%
    <small>{label}</small>
  </span>;
}

export function DashboardStats({ todaySales, todayChange, weekSales, weekChange, alerts, isLoading }: DashboardStatsProps) {
  return <section className="business-stats" aria-label="Resumen del negocio">
    <article className="business-stat">
      <span className="business-stat__icon"><ShoppingCart /></span>
      <span className="business-stat__badge">Hoy</span>
      <div><p>Ventas de hoy</p><h2>{isLoading || todaySales === undefined ? "—" : formatMoney(todaySales)}</h2><Comparison value={todayChange} label="vs. ayer" /></div>
    </article>
    <article className="business-stat">
      <span className="business-stat__icon"><BarChart3 /></span>
      <span className="business-stat__badge">Semana actual</span>
      <div><p>Ventas de la semana</p><h2>{isLoading || weekSales === undefined ? "—" : formatMoney(weekSales)}</h2><Comparison value={weekChange} label="vs. semana anterior" /></div>
    </article>
    <article className="business-stat">
      <span className="business-stat__icon"><Bell /></span>
      <span className="business-stat__badge business-stat__badge--alert">Requieren atención</span>
      <div><p>Alertas</p><h2>{isLoading || alerts === undefined ? "—" : alerts}</h2><span className="business-stat__meta">Productos con stock bajo</span></div>
    </article>
  </section>;
}

import { BarChart3, Maximize2, Minimize2 } from "lucide-react";
import type { WeeklySale } from "../types/dashboard.types";
import { formatAxisMoney, formatMoney } from "../utils/dashboard.format";

interface WeeklySalesChartProps {
  data?: WeeklySale[];
  isLoading: boolean;
  errorMessage?: string;
  detailsOpen: boolean;
  onToggleDetails: () => void;
}

function chartMaximum(data: WeeklySale[]) {
  const maximum = Math.max(0, ...data.map((item) => item.total));
  if (maximum === 0) return 1_000;
  const magnitude = 10 ** Math.floor(Math.log10(maximum));
  const step = magnitude / (maximum / magnitude >= 5 ? 1 : 2);
  return Math.ceil(maximum / step) * step;
}

export function WeeklySalesChart({ data, isLoading, errorMessage, detailsOpen, onToggleDetails }: WeeklySalesChartProps) {
  const values = data ?? [];
  const maximum = chartMaximum(values);
  const ticks = [maximum, maximum * 0.75, maximum * 0.5, maximum * 0.25, 0];
  const isEmpty = values.length > 0 && values.every((item) => item.total === 0);

  return <article className="weekly-sales-card">
    <header className="weekly-sales-card__header">
      <div><span className="weekly-sales-card__icon"><BarChart3 /></span><div><h3>Ventas de la semana</h3><p>Total de ventas diarias de lunes a domingo.</p></div></div>
      <button type="button" onClick={onToggleDetails} aria-label={detailsOpen ? "Cerrar detalle de la semana" : "Abrir detalle de la semana"} title={detailsOpen ? "Cerrar detalle" : "Ver detalle"}>
        {detailsOpen ? <Minimize2 /> : <Maximize2 />}
      </button>
    </header>
    {isLoading && <div className="business-dashboard-state"><span className="business-dashboard-spinner" />Cargando ventas…</div>}
    {!isLoading && errorMessage && <div className="business-dashboard-state business-dashboard-state--error">{errorMessage}</div>}
    {!isLoading && !errorMessage && <div className="weekly-chart" role="img" aria-label="Ventas diarias de la semana en bolivianos">
      <div className="weekly-chart__axis">{ticks.map((tick, index) => <span key={`${tick}-${index}`}>{formatAxisMoney(tick)}</span>)}</div>
      <div className="weekly-chart__plot">
        {ticks.map((_, index) => <span className="weekly-chart__gridline" key={index} />)}
        {isEmpty && <p className="weekly-chart__empty">No hay ventas registradas esta semana.</p>}
        <div className="weekly-chart__bars">
          {values.map((item, index) => <div className="weekly-chart__column" key={item.label}>
            {item.total > 0 && <strong>{formatMoney(item.total)}</strong>}
            <span className={`weekly-chart__bar ${index === values.length - 1 ? "weekly-chart__bar--last" : ""}`} style={{ height: `${item.total === 0 ? 0 : Math.max(4, (item.total / maximum) * 100)}%` }} />
            <small>{item.label}</small>
          </div>)}
        </div>
      </div>
    </div>}
  </article>;
}

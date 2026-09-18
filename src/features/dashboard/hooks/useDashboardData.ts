import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchDashboardData } from "../services/dashboard.service";
import type { DashboardQueryRange, DashboardSummary } from "../types/dashboard.types";

export const LOW_STOCK_LIMIT = 1_000;
export const CRITICAL_STOCK_LIMIT = 500;
const WEEK_DAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

interface DashboardPeriods {
  today: Date;
  tomorrow: Date;
  yesterday: Date;
  currentWeekStart: Date;
  nextWeekStart: Date;
  previousWeekStart: Date;
}

function startOfLocalDay(value: Date) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function buildPeriods(now = new Date()): DashboardPeriods {
  const today = startOfLocalDay(now);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const currentWeekStart = new Date(today);
  currentWeekStart.setDate(currentWeekStart.getDate() - ((currentWeekStart.getDay() + 6) % 7));
  const nextWeekStart = new Date(currentWeekStart);
  nextWeekStart.setDate(nextWeekStart.getDate() + 7);
  const previousWeekStart = new Date(currentWeekStart);
  previousWeekStart.setDate(previousWeekStart.getDate() - 7);
  return { today, tomorrow, yesterday, currentWeekStart, nextWeekStart, previousWeekStart };
}

function localDateKey(value: string | Date) {
  const date = new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function percentageChange(current: number, previous: number) {
  if (previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

export function useDashboardData() {
  const periods = useMemo(() => buildPeriods(), []);
  const range: DashboardQueryRange = useMemo(() => ({
    salesFrom: periods.previousWeekStart.toISOString(),
    salesTo: periods.nextWeekStart.toISOString(),
    weekFrom: periods.currentWeekStart.toISOString(),
    weekTo: periods.nextWeekStart.toISOString(),
  }), [periods]);
  const query = useQuery({
    queryKey: ["dashboard-summary", range.salesFrom, range.salesTo],
    queryFn: () => fetchDashboardData(range),
  });

  const summary = useMemo<DashboardSummary | undefined>(() => {
    if (!query.data) return undefined;
    const totalBetween = (from: Date, to: Date) => query.data.sales.reduce((total, sale) => {
      const timestamp = new Date(sale.soldAt).getTime();
      return timestamp >= from.getTime() && timestamp < to.getTime() ? total + sale.total : total;
    }, 0);
    const todaySales = totalBetween(periods.today, periods.tomorrow);
    const yesterdaySales = totalBetween(periods.yesterday, periods.today);
    const weekSales = totalBetween(periods.currentWeekStart, periods.nextWeekStart);
    const previousWeekSales = totalBetween(periods.previousWeekStart, periods.currentWeekStart);
    const weeklySales = WEEK_DAYS.map((label, index) => {
      const date = new Date(periods.currentWeekStart);
      date.setDate(date.getDate() + index);
      return {
        label,
        total: query.data.sales
          .filter((sale) => localDateKey(sale.soldAt) === localDateKey(date))
          .reduce((total, sale) => total + sale.total, 0),
      };
    });
    const products = [...query.data.products].sort((a, b) => b.stock - a.stock);
    const lowStockProducts = query.data.products
      .filter((product) => product.stock < LOW_STOCK_LIMIT)
      .sort((a, b) => a.stock - b.stock);

    return {
      todaySales,
      todayChange: percentageChange(todaySales, yesterdaySales),
      weekSales,
      weekChange: percentageChange(weekSales, previousWeekSales),
      weeklySales,
      products,
      lowStockProducts,
      topProducts: query.data.topProducts,
    };
  }, [periods, query.data]);

  return { ...query, summary };
}

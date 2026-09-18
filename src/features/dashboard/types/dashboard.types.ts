export interface DashboardQueryRange {
  salesFrom: string;
  salesTo: string;
  weekFrom: string;
  weekTo: string;
}

export interface DashboardSale {
  soldAt: string;
  total: number;
}

export interface DashboardProductStock {
  id: string;
  name: string;
  sku: string;
  stock: number;
}

export interface DashboardTopProduct {
  id: string;
  name: string;
  sku: string;
  quantity: number;
}

export interface DashboardDataset {
  sales: DashboardSale[];
  products: DashboardProductStock[];
  topProducts: DashboardTopProduct[];
}

export interface WeeklySale {
  label: string;
  total: number;
}

export interface DashboardSummary {
  todaySales: number;
  todayChange: number | null;
  weekSales: number;
  weekChange: number | null;
  weeklySales: WeeklySale[];
  products: DashboardProductStock[];
  lowStockProducts: DashboardProductStock[];
  topProducts: DashboardTopProduct[];
}

import { supabase } from "../../../lib/supabase";
import type {
  DashboardDataset,
  DashboardProductStock,
  DashboardQueryRange,
  DashboardTopProduct,
} from "../types/dashboard.types";

const COMPLETED_SALE_STATUSES = ["confirmada", "facturada"];

interface SaleRow {
  fecha_venta: string;
  total: number | string | null;
}

interface StockRow {
  cantidad_disponible: number | string | null;
}

interface ProductRow {
  id: string;
  codigo_interno: string;
  nombre: string;
  stock_por_almacen: StockRow[] | null;
}

interface ProductRelation {
  id: string;
  codigo_interno: string;
  nombre: string;
}

interface SaleDetailRow {
  producto_id: string;
  cantidad: number | string | null;
  producto: ProductRelation | null;
}

export async function fetchDashboardData(range: DashboardQueryRange): Promise<DashboardDataset> {
  const [salesResult, productsResult, detailsResult] = await Promise.all([
    supabase
      .from("ventas")
      .select("fecha_venta, total")
      .in("estado", COMPLETED_SALE_STATUSES)
      .gte("fecha_venta", range.salesFrom)
      .lt("fecha_venta", range.salesTo),
    supabase
      .from("productos")
      .select("id, codigo_interno, nombre, stock_por_almacen(cantidad_disponible)")
      .eq("activo", true),
    supabase
      .from("detalle_ventas")
      .select("producto_id, cantidad, producto:productos!inner(id, codigo_interno, nombre), venta:ventas!inner(fecha_venta, estado)")
      .in("venta.estado", COMPLETED_SALE_STATUSES)
      .gte("venta.fecha_venta", range.weekFrom)
      .lt("venta.fecha_venta", range.weekTo),
  ]);

  if (salesResult.error) throw new Error(salesResult.error.message || "No se pudieron consultar las ventas.");
  if (productsResult.error) throw new Error(productsResult.error.message || "No se pudo consultar el inventario.");
  if (detailsResult.error) throw new Error(detailsResult.error.message || "No se pudo consultar el detalle de ventas.");

  const products = ((productsResult.data ?? []) as unknown as ProductRow[]).map(
    (row): DashboardProductStock => ({
      id: row.id,
      name: row.nombre,
      sku: row.codigo_interno,
      stock: (row.stock_por_almacen ?? []).reduce(
        (total, item) => total + Number(item.cantidad_disponible ?? 0),
        0,
      ),
    }),
  );

  const quantities = new Map<string, DashboardTopProduct>();
  for (const row of (detailsResult.data ?? []) as unknown as SaleDetailRow[]) {
    if (!row.producto) continue;
    const current = quantities.get(row.producto_id);
    quantities.set(row.producto_id, {
      id: row.producto_id,
      name: row.producto.nombre,
      sku: row.producto.codigo_interno,
      quantity: (current?.quantity ?? 0) + Number(row.cantidad ?? 0),
    });
  }

  return {
    sales: ((salesResult.data ?? []) as SaleRow[]).map((row) => ({
      soldAt: row.fecha_venta,
      total: Number(row.total ?? 0),
    })),
    products,
    topProducts: [...quantities.values()].sort((a, b) => b.quantity - a.quantity),
  };
}

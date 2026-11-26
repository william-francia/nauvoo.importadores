import { supabase } from "../../../lib/supabase";
import type { RegistrarVentaInput } from "../types/ventas.types";
export type CanalEntrega = "NINGUNO" | "CORREO" | "WHATSAPP";
export type EntregaVenta = { canal: CanalEntrega; destinatario: string; consentimiento: boolean };
export function canalInicial(cliente: { correo?: string | null; telefono?: string | null } | null): CanalEntrega {
  return cliente?.telefono?.trim() ? "WHATSAPP" : cliente?.correo?.trim() ? "CORREO" : "NINGUNO";
}
export type CheckoutResult = { ventaId: string; facturaId: string; estadoFiscal: string; codigoEstado: number | null; transaccion: boolean | null; recepcionPersistida: boolean; entrega: string };
export function mensajeCheckout(result: CheckoutResult) {
  const validada = result.estadoFiscal === "VALIDADA" && result.codigoEstado === 908 && result.transaccion === true && result.recepcionPersistida;
  return validada ? `Venta registrada y factura emitida correctamente. Entrega: ${result.entrega}.`
    : `Venta registrada. Estado fiscal: ${result.estadoFiscal}. No vuelva a registrar esta venta; consulte Gestión de facturas.`;
}
export async function confirmarVentaFiscal(venta: RegistrarVentaInput, entrega: EntregaVenta, idempotencia: string): Promise<CheckoutResult> {
  const { data, error } = await supabase.functions.invoke("siat-gateway", { body: { action: "checkout-sale", confirmacion: true, venta, entrega, idempotencia } });
  if (error) {
    const response = (error as { context?: Response }).context;
    const detail = response instanceof Response ? await response.clone().json().catch(() => null) : null;
    throw new Error(detail?.error ?? "No se pudo confirmar el resultado. Conserve la solicitud y consulte Gestión de ventas antes de reintentar.");
  }
  if (!data?.ventaId || !data?.facturaId) throw Error("Resultado incompleto: consulte Gestión de ventas antes de reintentar.");
  return data as CheckoutResult;
}

import { supabase } from "../../../lib/supabase";
import type { GatewayHealthSiat } from "../types/siat.types";

async function invoke<T>(action: string, values: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("siat-gateway", { body: { action, ...values } });
  if (error) throw new Error(error.message || "No fue posible comunicarse con el gateway SIAT.");
  if (data?.error) throw new Error(String(data.error));
  return data as T;
}

export const obtenerSaludGatewaySiat = () => invoke<GatewayHealthSiat>("health");
export const verificarServicioSiat = () => invoke<{ transaccion: boolean | null; codigoEstado: number | null; mensajes: Array<{ descripcion: string }> }>("verify-service");
export const solicitarCuisSiat = () => invoke<{ estado: string }>("request-cuis");
export const solicitarCufdSiat = () => invoke<{ estado: string }>("request-cufd");
export const sincronizarSiat = () => invoke<{ estado: string }>("sync");
export const prepararFacturaSiat = (ventaId: string) => invoke<{ facturaId: string | null; estado: string }>("prepare-invoice", { ventaId });
export const solicitarAnulacionSiat = (facturaId: string, motivo: number) => invoke<{ estado: string }>("cancel", { facturaId, motivo });
export const solicitarReversionSiat = (facturaId: string) => invoke<{ estado: string }>("reverse", { facturaId });

export async function descargarDocumentoFiscal(facturaId: string, type: "PDF" | "XML") {
  const result = await invoke<{ url: string; expiresIn: number }>("download", { facturaId, type });
  window.open(result.url, "_blank", "noopener,noreferrer");
}

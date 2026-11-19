import { supabase } from "../../../lib/supabase";
import type { ClienteVenta, MetodoPago, ProductoVenta } from "../../ventas/types/ventas.types";

const AGENT_URL = (import.meta.env.VITE_SIAT_AGENT_URL as string | undefined)?.replace(/\/$/, "") ?? "http://127.0.0.1:4737";

export interface LocalAgentStatus {
  state: "ONLINE" | "DEGRADADO" | "INICIANDO_CONTINGENCIA" | "OFFLINE" | "RECUPERANDO" | "REGISTRANDO_EVENTO" | "EMPAQUETANDO" | "ENVIANDO_PAQUETES" | "VALIDANDO_PAQUETES";
  evidence: { internetOnline?: boolean | null; backendOnline?: boolean | null; siatOnline?: boolean | null; checkedAt?: string | null; detail?: string };
  event: Record<string, unknown> | null;
  pending: number;
  bootstrapAt: string | null;
  emisionOfflineHabilitada?: boolean;
  reserva?: { estado: "ABIERTA" | "CIERRE_PENDIENTE" | "SIN_RESERVA"; desde: number | null; hasta: number | null };
  capacidades?: { aprovisionar: boolean; recuperar: boolean; registrarEvento: boolean; cerrarReservaSinEvento?: boolean };
}

export interface LocalInvoiceSummary {
  id: string; eventId: string; numeroFactura: number; cuf: string; fechaEmision: string;
  cliente: Record<string, unknown>; total: string; estado: string; paqueteId: string | null;
}
export interface LocalCafcRange { id: string; autorizacion: string; rangoDesde: number; rangoHasta: number; vigenteHasta: string; estado: string }

async function raw(path: string, init?: RequestInit, retry = true): Promise<Response> {
  let response: Response;
  try { response = await fetch(`${AGENT_URL}${path}`, { ...init, credentials: "include", headers: { "content-type": "application/json", ...init?.headers } }); }
  catch { throw new Error("El agente SIAT local no está disponible en esta caja."); }
  if (response.status === 401 && retry) {
    const { data } = await supabase.auth.getSession(); const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error("Inicia sesión para enlazar esta caja con el agente local.");
    const paired = await raw("/v1/pair", { method: "POST", body: JSON.stringify({ accessToken }) }, false);
    if (!paired.ok) throw new Error((await paired.json() as { error?: string }).error ?? "No se pudo enlazar la caja local.");
    return raw(path, init, false);
  }
  return response;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await raw(path, init); const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `Agente local HTTP ${response.status}.`); return data;
}

export const obtenerEstadoAgenteLocal = () => request<LocalAgentStatus>("/v1/status");
export const reportarEstadoNavegadorLocal = (online: boolean) => request<{ ok: boolean }>("/v1/browser-heartbeat", { method: "POST", body: JSON.stringify({ online }) });
export const buscarProductosAgenteLocal = (query: string) => request<ProductoVenta[]>(`/v1/products?q=${encodeURIComponent(query)}`);
export const buscarProductosCafcAgenteLocal = (query: string) => request<ProductoVenta[]>(`/v1/cafc/products?q=${encodeURIComponent(query)}`);
export const buscarClientesAgenteLocal = (query: string) => request<ClienteVenta[]>(`/v1/clients?q=${encodeURIComponent(query)}`);
export const listarFacturasAgenteLocal = () => request<LocalInvoiceSummary[]>("/v1/invoices");
export const listarCafcAgenteLocal = () => request<LocalCafcRange[]>("/v1/cafc");
export const aprovisionarAgenteLocal = () => request<{ generatedAt: string; products: number; clients: number }>("/v1/bootstrap", { method: "POST", body: "{}" });
export const recuperarAgenteLocal = () => request<{ status: string; pendientes?: number }>("/v1/recover", { method: "POST", body: "{}" });
export const cerrarReservaSinEventoLocal = () => request<{ estado: string }>("/v1/reservation/release-unused", { method: "POST", body: "{}" });
export const registrarEventoLocal = (input: { tipoEventoCodigo: string; descripcion: string; evidencia: string; cafcId?: string | null }) => request<Record<string, unknown>>("/v1/events/manual", { method: "POST", body: JSON.stringify(input) });

export const prepararTranscripcionCafcAgente = (input: { formulario: Record<string, unknown>; originalBase64: string; originalSha256: string; originalRevisado: true; idempotencyKey: string; ventaId: string | null }) => request<{
  facturaId: string; eventoId: string; cafcId: string; agenteId: string; correlationId: string; idempotencyKey: string; ventaId: string | null;
  xmlGzipBase64: string; xmlSha256: string; originalBase64: string; originalSha256: string; fingerprint: string; originalRevisado: true;
}>("/v1/cafc/prepare", { method: "POST", body: JSON.stringify(input) });

export async function registrarVentaAgenteLocal(input: {
  idempotencyKey: string; cajaId: string; clienteId: string; metodoPago: MetodoPago;
  tarjetaOfuscada: string | null; descuentoAdicional: number; observacion?: string;
  items: Array<{ productoId: string; almacenId: string; cantidad: number; precioUnitario: number; descuento: number; informacionExtra?: string }>;
  manualCafc?: { rangeId: string; numero: number; evidenciaBase64: string; evidenciaMime: string };
}) { return request<LocalInvoiceSummary>("/v1/invoices", { method: "POST", body: JSON.stringify(input) }); }

export async function descargarDocumentoLocal(id: string, type: "pdf" | "xml") {
  const response = await raw(`/v1/invoices/${id}/${type}`); if (!response.ok) throw new Error("No se pudo descargar el documento fiscal local.");
  const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `factura-${id}.${type}`; link.click(); URL.revokeObjectURL(url);
}

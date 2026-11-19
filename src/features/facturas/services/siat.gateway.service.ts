import { supabase } from "../../../lib/supabase";
import type { GatewayHealthSiat } from "../types/siat.types";

async function invoke<T>(action: string, values: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke("siat-gateway", { body: { action, ...values } });
  if (error) {
    const details = error.context instanceof Response ? await error.context.json().catch(() => null) as { code?: string; error?: string } | null : null;
    throw new Error(details?.code || details?.error || error.message || "No fue posible comunicarse con el gateway SIAT.");
  }
  if (data?.error) throw new Error(String(data.error));
  return data as T;
}

export const obtenerSaludGatewaySiat = () => invoke<GatewayHealthSiat>("health");
export const verificarServicioSiat = () => invoke<{ transaccion: boolean | null; codigoEstado: number | null; mensajes: Array<{ descripcion: string }> }>("verify-service");
export const probarFirmaDigitalSiat = () => invoke<{ ok: true; firma: true; xsd: true; nit: string; nitCoincidenciaTextual: boolean; eku: string }>("test-signature");
export type PilotPreviewSiat = {
  tipo: "FIXTURE_FISCAL_NO_COMERCIAL";
  ambiente: "PRUEBAS";
  codigoAmbiente: 2;
  emisor: { nit: string; actividad: string };
  cliente: { codigo: string; nombre: string; tipoDocumento: string; codigoTipoDocumento: number; documento: string };
  producto: { codigo: string; descripcion: string; actividad: string; codigoSin: string; unidadSin: string; cantidad: number; origen: "PENDIENTE"; homologacionPersistida: false };
  pago: { metodo: string; codigoSin: number };
  montos: { moneda: string; precio: number; subtotal: number; descuento: number; total: number; precioConfirmado: false };
  codigos: { cuisVigente: boolean; cufdVigente: boolean; cufdVence: string | null };
  certificadoFiscal: "EKU_PENDIENTE" | "EKU_APROBADO";
  advertencias: string[];
  tareasPendientes: number;
  puedeEmitir: false;
  numeroReservado: false;
  blockers: string[];
  previewHash: string;
  etapaPiloto?: number;
  control: { emisionHabilitada: boolean; autorizacionHabilitadaId: string | null; ekuFiscalAprobado: boolean; ekuTipoEvidencia: string | null; nitClienteVerificado: boolean; documentoListo: boolean };
  puedeConfirmar: boolean;
};
export const previsualizarFacturaPilotoSiat = (precio: number, descuento: number) => invoke<PilotPreviewSiat>("pilot-preview", { precio, descuento });
export const verificarNitClientePilotoSiat = () => invoke<{ resultado: "ACTIVO" | "INACTIVO" | "INEXISTENTE" | "ERROR_SERVICIO"; codigo: number | null; aprobado: boolean; yaVerificado: boolean }>("verify-pilot-client-nit");
export const aprobarCertificadoPilotoSiat = (confirmacionAdministrativa: string) => invoke<{ aprobado: boolean; certificadoSha256: string; transmisionHabilitada: false }>("approve-pilot-certificate", {
  tipoEvidencia: "CONFIRMACION_VERBAL_REPORTADA_POR_USUARIO", entidadConfirmadora: "SIN_REPORTADO_POR_USUARIO", confirmacionAdministrativa,
});
export const prepararAutorizacionPilotoSiat = (precio: number, descuento: number, previewHash: string) => invoke<{ authorizationId: string; estado: string; expiresAt: string; previewHash: string }>("pilot-prepare", { precio, descuento, previewHash });
export const habilitarAutorizacionPilotoSiat = (authorizationId: string, confirmacion: string) => invoke<{ authorizationId: string; habilitada: true; facturaEmitida: false }>("pilot-enable-authorization", { authorizationId, confirmacion });
export const emitirFacturaPilotoSiat = (authorizationId: string, confirmacion: string) => invoke<{ facturaId: string; estado: string }>("pilot-issue", { authorizationId, confirmacion });
export const solicitarCuisSiat = () => invoke<{ estado: "PROCESADA" | "EN_COLA"; worker: { processed: number; failures: string[] } }>("request-cuis");
export const solicitarCufdSiat = () => invoke<{ estado: "PROCESADA" | "EN_COLA" | "VIGENTE"; worker: { processed: number; failures: string[] } }>("request-cufd");
export const sincronizarSiat = () => invoke<{ estado: "SINCRONIZADO" | "SINCRONIZANDO" | "ERROR"; worker: { processed: number; failures: string[] } }>("sync");
export const prepararFacturaSiat = (ventaId: string) => invoke<{ facturaId: string | null; estado: string }>("prepare-invoice", { ventaId });
type SolicitudOperacionFiscal = { estado: string; worker?: { processed: number; failures: string[] } };
export const solicitarAnulacionSiat = (facturaId: string, motivo: number, idempotencia: string, noUtilizadaDdjj: boolean, sucursalOperacionId: string | null, puntoVentaOperacionId: string | null) => invoke<SolicitudOperacionFiscal>("cancel", { facturaId, motivo, idempotencia, noUtilizadaDdjj, sucursalOperacionId, puntoVentaOperacionId, confirmacion: true });
export const solicitarReversionSiat = (facturaId: string, idempotencia: string, sucursalOperacionId: string | null, puntoVentaOperacionId: string | null) => invoke<SolicitudOperacionFiscal>("reverse", { facturaId, idempotencia, sucursalOperacionId, puntoVentaOperacionId, confirmacion: true });

export type NotificacionFiscal9A = { operacion: string; canal: string; destinatario_mascara: string; estado: string; preparado_at: string; enviado_at: string | null; enviado_por: string | null; confirmado_at: string | null; confirmado_por: string | null; evidencia_tipo: string | null; envio_intentado_at: string | null };
export const obtenerCapacidades9A = () => invoke<{ cancelacion: boolean; reversion: boolean; correoAutomatico: boolean }>("9a-capabilities");
export const obtenerNotificaciones9A = (facturaId: string) => invoke<{ notificaciones: NotificacionFiscal9A[] }>("9a-notification-status", { facturaId });
export const guardarNotificacion9A = (input: { facturaId: string; operacion: "ANULACION" | "REVERSION"; canal: "CORREO" | "WHATSAPP"; destinatario: string; etapa: "PREPARAR" | "REGISTRAR_ENVIO_MANUAL" | "CONFIRMAR_ENTREGA_MANUAL"; evidencia?: string; fechaEnvio?: string }) => invoke<{ estado: string; entregaConfirmada: boolean }>("9a-notification", { ...input, confirmacion: true });
export const guardarRevision9A = (input: { facturaId: string; tipo: "RESPUESTA_ORIGINAL" | "CONSULTA_SIN" | "OTRA"; dictamen: "NO_CONCLUYENTE" | "EVIDENCIA_PARA_REVISION"; evidencia: string }) => invoke<{ revisionId: string; estadoFiscalModificado: false; reenvio: false }>("9a-review", { ...input, confirmacion: true });
export const enviarCorreo9A = (input: { facturaId: string; operacion: "ANULACION" | "REVERSION"; destinatario: string }) => invoke<{ estado: string; entregaConfirmada: false }>("9a-send-auto", { ...input, confirmacion: true });

export type VincularCafcVentaInput = {
  facturaId: string; eventoId: string; cafcId: string; agenteId: string; correlationId: string; idempotencyKey: string;
  ventaId: string | null; xmlGzipBase64: string; xmlSha256: string; originalBase64: string; originalSha256: string; confirmacion: true; originalRevisado: true;
};
export const vincularCafcVentaSiat = (input: VincularCafcVentaInput) => invoke<{ estado: "VINCULADA" | "PENDIENTE_CONCILIACION"; facturaId: string; motivo?: string }>("9b-link-manual-cafc", input);

export async function obtenerXmlFiscalComprimido(facturaId: string): Promise<Uint8Array> {
  const result = await invoke<{ url: string; expiresIn: number; documentAccess?: string }>("download", { facturaId, type: "XML" });
  if (result.documentAccess !== "ADMIN_VALIDATED_V1") throw new Error("La entrega segura de documentos requiere actualizar el gateway SIAT.");
  const response = await fetch(result.url, { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error("No se pudo recuperar el XML fiscal privado.");
  return new Uint8Array(await response.arrayBuffer());
}

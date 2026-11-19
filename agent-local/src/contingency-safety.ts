// Debe seguir bloqueado hasta validar condiciones, autorización y recuperación en piloto.
export const CONTINGENCIA_PILOTO_HABILITADA = false; // Valor por defecto documentado.
export const contingencyPilotEnabled = () => process.env.SIAT_CONTINGENCIA_PILOTO_HABILITADA === "true" && process.env.SIAT_CONTINGENCIA_AMBIENTE === "PRUEBAS";
export function assertContingencyPilotReady(): void {
  if (!contingencyPilotEnabled()) throw new Error("CONTINGENCIA_PENDIENTE_VALIDACION_Y_AUTORIZACION");
}
export function assertPilotAdministration(): void {
  if (process.env.SIAT_CONTINGENCIA_AMBIENTE !== "PRUEBAS") throw new Error("ADMINISTRACION_RESERVA_SOLO_PILOTO");
}
export function assertCafcEnabled(): void {
  throw new Error("CAFC_DESHABILITADO_PENDIENTE_AUTORIZACION");
}

export function assertOfflineCufd(event: Record<string, unknown>, cufd: Record<string, unknown>, at: string): void {
  const begin = Date.parse(String(event.fechaInicio ?? ""));
  const issued = Date.parse(at); const start = Date.parse(String(cufd.fecha_inicio ?? ""));
  const expiry = Date.parse(String(cufd.fecha_expiracion ?? cufd.fechaVigencia ?? ""));
  if (!event.cufdId || event.cufdId !== cufd.id || !Number.isFinite(begin) || !Number.isFinite(issued)
    || !Number.isFinite(start) || !Number.isFinite(expiry) || begin < start || begin >= expiry || issued < begin) throw new Error("CUFD_EVENTO_NO_VIGENTE");
  // La excepción de 72 horas requiere evidencia específica aún no implementada.
  if (issued >= expiry) throw new Error("EXTENSION_CUFD_REQUIERE_EVIDENCIA_ESPECIFICA");
}

export function offlineDocumentType(type: unknown): { code: number; exception: number | null } {
  const code = ({ CI: 1, CEX: 2, PASAPORTE: 3, OD: 4, NIT: 5 } as Record<string, number>)[String(type).toUpperCase()];
  if (!code) throw new Error("TIPO_DOCUMENTO_OFFLINE_NO_VALIDO");
  return { code, exception: code === 5 ? 1 : null };
}

export function assertManualTranscriptionAllowed(manual: unknown): void {
  if (manual) throw new Error("TRANSCRIPCION_CAFC_PENDIENTE_VALIDACION_ORIGINAL");
}

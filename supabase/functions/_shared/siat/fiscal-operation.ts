import type { SiatResponse } from "./types.ts";

// El SIN documenta estos códigos como impedimentos de reversión. No prueban el
// estado actual del documento y nunca deben usarse para cambiarlo automáticamente.
export function reversalProblemCodes(response: Pick<SiatResponse, "codigoEstado" | "mensajes">): number[] {
  const known = new Set([909, 981, 924, 3011, 3012]);
  return [...new Set([response.codigoEstado, ...response.mensajes.map((message) => message.codigo)]
    .filter((code): code is number => typeof code === "number" && known.has(code)))];
}

// Plazo indicado por el SIN: día nueve del mes siguiente a la emisión, hora de Bolivia.
export function assertFiscalOperationAllowed(invoice: Record<string, unknown>, payload: Record<string, unknown>, operation: "ANULAR" | "REVERTIR_ANULACION", now = Date.now()): void {
  if (["c2279bbb-e851-468b-afe6-8ebf0b436d28", "08dd889e-f2f7-4acb-be2e-2f911aae9919"].includes(String(invoice.id ?? "").toLowerCase())) throw new Error("FACTURA_PILOTO_ANTERIOR_PROTEGIDA");
  if (invoice.ambiente !== "PRUEBAS") throw new Error("OPERACION_SOLO_PILOTO");
  if (invoice.origen_fiscal !== "PILOTO") throw new Error("OPERACION_REQUIERE_FACTURA_PILOTO_AISLADA");
  if (payload.operacion !== operation || payload.confirmacionExpresa !== true || typeof payload.actor !== "string" || !payload.actor) throw new Error("OPERACION_REQUIERE_CONFIRMACION_ADMINISTRATIVA");
  if (operation === "ANULAR" && payload.declaracionNoUtilizadaDDJJ !== true) throw new Error("OPERACION_REQUIERE_DECLARACION_DDJJ");
  if (invoice.fecha_reversion) throw new Error("FACTURA_YA_REVERTIDA");
  const issued = Date.parse(String(invoice.fecha_emision ?? ""));
  if (!Number.isFinite(issued) || issued > now) throw new Error("FECHA_EMISION_INVALIDA");
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/La_Paz", year: "numeric", month: "numeric" }).formatToParts(new Date(issued));
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  // Bolivia UTC-4; the instant is the start of the tenth day of the following month.
  const cutoff = Date.UTC(year, month, 10, 4);
  if (!Number.isFinite(now) || now >= cutoff) throw new Error("PLAZO_OPERACION_VENCIDO");
}

export function assertCurrentFiscalCodes(scope: Record<string, unknown>, cuis: Record<string, unknown>, cufd: Record<string, unknown>, now = Date.now()): void {
  const sameScope = (value: Record<string, unknown>) => value.ambiente === scope.ambiente && value.sucursal_id === scope.sucursal_id && (value.punto_venta_id ?? null) === (scope.punto_venta_id ?? null);
  const future = (value: unknown) => Number.isFinite(Date.parse(String(value ?? ""))) && Date.parse(String(value)) > now;
  const start = Date.parse(String(cufd.fecha_inicio ?? ""));
  if (!Number.isFinite(now) || !sameScope(cuis) || cuis.estado !== "VIGENTE" || !String(cuis.codigo ?? "").trim() || !future(cuis.fecha_expiracion)) throw new Error("CUIS_NO_VIGENTE_O_NO_CORRESPONDE");
  if (!sameScope(cufd) || cufd.estado !== "VIGENTE" || !String(cufd.codigo ?? "").trim() || !cuis.id || cufd.cuis_id !== cuis.id || !Number.isFinite(start) || start > now || !future(cufd.fecha_expiracion)) throw new Error("CUFD_NO_VIGENTE_O_NO_CORRESPONDE");
}

export function assertEventFiscalCode(event: Record<string, unknown>, cufd: Record<string, unknown>, ambiente: unknown): void {
  const eventStart = Date.parse(String(event.fecha_inicio ?? "")); const eventEnd = Date.parse(String(event.fecha_fin ?? ""));
  const codeStart = Date.parse(String(cufd.fecha_inicio ?? "")); const codeEnd = Date.parse(String(cufd.fecha_expiracion ?? ""));
  if (!event.cufd_id || event.cufd_id !== cufd.id || !String(cufd.codigo ?? "").trim() || cufd.ambiente !== ambiente
    || cufd.sucursal_id !== event.sucursal_id || (cufd.punto_venta_id ?? null) !== (event.punto_venta_id ?? null)
    || !Number.isFinite(eventStart) || !Number.isFinite(eventEnd) || eventEnd < eventStart
    || !Number.isFinite(codeStart) || !Number.isFinite(codeEnd) || eventStart < codeStart || eventStart >= codeEnd) {
    throw new Error("CUFD_EVENTO_NO_CORRESPONDE_O_NO_ESTABA_VIGENTE");
  }
}

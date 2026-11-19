import type { VincularCafcVentaInput } from "./siat.gateway.service";

export type FormularioCafc = {
  ventaId: string; eventoId: string; cafcId: string; numeroFactura: number; fechaEmision: string; clienteId: string;
  metodoPago: string; tarjetaOfuscada: string | null; descuentoAdicional: number; totalOriginal: string; totalSujetoIva: string; leyenda: string;
  items: Array<{ productoId: string; codigoOriginal: string; descripcionOriginal: string; subtotalOriginal: string; cantidad: number; precioUnitario: number; descuento: number }>;
  originalRevisado: boolean; original: File | null;
};
type Prepared = Omit<VincularCafcVentaInput, "confirmacion">;
type Result = { estado: "VINCULADA" | "PENDIENTE_CONCILIACION"; facturaId: string; motivo?: string };
type Services = { preparar: (input: { formulario: Record<string, unknown>; originalBase64: string; originalSha256: string; originalRevisado: true; idempotencyKey: string; ventaId: string | null }) => Promise<Prepared>; vincular: (input: VincularCafcVentaInput) => Promise<Result> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pending = new Set<string>();
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, "0")).join("").toUpperCase();
const makeUuid = (hexValue: string) => `${hexValue.slice(0, 8)}-${hexValue.slice(8, 12)}-4${hexValue.slice(13, 16)}-8${hexValue.slice(17, 20)}-${hexValue.slice(20, 32)}`.toLowerCase();

/** No crea ventas ni realiza envíos fiscales. Las validaciones definitivas corresponden al agente y a la RPC. */
export async function transcribirCafc(form: FormularioCafc, services: Services): Promise<Result> {
  if (!uuid.test(form.ventaId)) throw new Error("PENDIENTE: selecciona una venta original existente mediante su identificador.");
  if (!uuid.test(form.eventoId) || !uuid.test(form.cafcId)) throw new Error("PENDIENTE: identifica el evento cerrado y el CAFC autorizado.");
  if (!Number.isSafeInteger(form.numeroFactura) || form.numeroFactura < 1 || !form.fechaEmision || !form.clienteId || !form.items.length || !form.metodoPago || !form.leyenda.trim() || form.totalOriginal.trim() === "" || form.totalSujetoIva.trim() === "") throw new Error("PENDIENTE: completa número, fecha, cliente, detalle, pago, importes y leyenda del original.");
  if (form.metodoPago === "TARJETA" && !/^\d{4}00000000\d{4}$/.test(form.tarjetaOfuscada ?? "")) throw new Error("PENDIENTE: indica solo los primeros y últimos cuatro dígitos de la tarjeta.");
  if (form.items.some(item => !item.codigoOriginal.trim() || !item.descripcionOriginal.trim() || !item.subtotalOriginal.trim())) throw new Error("PENDIENTE: transcribe el código, descripción y subtotal originales de cada producto.");
  if (!form.originalRevisado || !form.original || !["application/pdf", "image/jpeg", "image/png"].includes(form.original.type) || form.original.size === 0 || form.original.size > 8_000_000) throw new Error("PENDIENTE: adjunta el original PDF, JPEG o PNG y confirma su revisión.");
  const identity = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`CAFC-V1:${form.cafcId.toLowerCase()}:${form.numeroFactura}`)));
  const key = `cafc:${identity}`;
  if (pending.has(key)) throw new Error("PENDIENTE: ya se está procesando este comprobante.");
  pending.add(key);
  try {
    const bytes = new Uint8Array(await form.original.arrayBuffer());
    const originalSha256 = hex(await crypto.subtle.digest("SHA-256", bytes));
    let binary = ""; for (let i = 0; i < bytes.length; i += 16_384) binary += String.fromCharCode(...bytes.subarray(i, i + 16_384));
    const ventaId = form.ventaId;
    const formulario = { eventoId: form.eventoId, cafcId: form.cafcId, numeroFactura: form.numeroFactura, fechaEmision: form.fechaEmision,
      clienteId: form.clienteId, metodoPago: form.metodoPago, tarjetaOfuscada: form.tarjetaOfuscada, descuentoAdicional: form.descuentoAdicional,
      totalOriginal: form.totalOriginal, totalSujetoIva: form.totalSujetoIva, leyenda: form.leyenda, items: form.items,
      facturaId: makeUuid(identity.slice(0, 32)), correlationId: makeUuid(identity.slice(32, 64)) };
    const prepared = await services.preparar({ formulario, originalBase64: btoa(binary), originalSha256, originalRevisado: true, idempotencyKey: key, ventaId });
    if (prepared.cafcId !== form.cafcId || prepared.eventoId !== form.eventoId || prepared.idempotencyKey !== key || prepared.ventaId !== ventaId || prepared.originalSha256 !== originalSha256 || prepared.facturaId !== formulario.facturaId || prepared.correlationId !== formulario.correlationId) throw new Error("PENDIENTE: la respuesta del agente no corresponde al comprobante solicitado.");
    return await services.vincular({ ...prepared, confirmacion: true });
  } finally { pending.delete(key); }
}

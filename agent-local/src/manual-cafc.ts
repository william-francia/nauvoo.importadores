import Decimal from "decimal.js";
import { createHash } from "node:crypto";
import { generateCuf } from "../../supabase/functions/_shared/siat/cuf.ts";
import { generateInvoiceXml } from "../../supabase/functions/_shared/siat/invoice-xml.ts";
import { certificateDerFromPem, validateSignatureCredentials } from "../../supabase/functions/_shared/siat/signature-credentials.ts";
import { signInvoiceXml, verifyInvoiceSignature } from "../../supabase/functions/_shared/siat/xmldsig.ts";
import { validateElectronicInvoiceXml } from "../../supabase/functions/_shared/siat/xsd.ts";
import type { InvoiceSnapshot } from "../../supabase/functions/_shared/siat/types.ts";

type Row = Record<string, unknown>;
const required = (value: unknown, label: string) => { const text = String(value ?? "").trim(); if (!text) throw new Error(`CAFC_${label}_REQUERIDO`); return text; };
const date = (value: unknown) => Date.parse(String(value ?? ""));
const money = (value: unknown) => { try { const n = new Decimal(String(value)); if (!n.isFinite() || n.isNegative()) throw new Error(); return n; } catch { throw new Error("CAFC_IMPORTE_INVALIDO"); } };
const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex").toUpperCase();
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Row).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
};

/** Preparación aislada: no crea ventas, no consume inventario y no envía al SIN. */
export function prepareManualCafcXml(input: {
  snapshot: InvoiceSnapshot; event: Row; cufd: Row; range: Row; originalBytes: Uint8Array; originalSha256: string;
  originalReviewed: boolean; issuerNit: string; now: Date; privateKeyPem: string; certificatePem: string; xsd: string; signatureXsd: string;
}): { xml: string; cuf: string; originalSha256: string; fingerprint: string } {
  const { snapshot: s, event: e, cufd: c, range: r } = input;
  const start = date(e.fecha_inicio), end = date(e.fecha_fin), issued = date(s.fechaEmision), now = input.now.getTime();
  const cufdStart = date(c.fecha_inicio), cufdEnd = date(c.fecha_expiracion), rangeStart = date(r.vigente_desde), rangeEnd = date(r.vigente_hasta);
  if (!input.originalReviewed || !input.originalBytes.length || input.originalBytes.length > 8_000_000 || !/^[A-F0-9]{64}$/.test(input.originalSha256)
    || digest(input.originalBytes) !== input.originalSha256) throw new Error("CAFC_ORIGINAL_SIN_EVIDENCIA");
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(s.fechaEmision) || !["5", "6", "7"].includes(String(e.tipo_evento_codigo)) || !Number.isFinite(start) || !Number.isFinite(end) || end < start
    || !Number.isFinite(issued) || issued < start || issued > end || !Number.isFinite(now) || now < end || now > end + 72 * 3_600_000) throw new Error("CAFC_FECHA_O_EVENTO_INVALIDO");
  if (!e.cufd_id || e.cufd_id !== c.id || !e.cafc_id || e.cafc_id !== r.id || c.sucursal_id !== e.sucursal_id || r.sucursal_id !== e.sucursal_id
    || (c.punto_venta_id ?? null) !== (e.punto_venta_id ?? null) || (r.punto_venta_id ?? null) !== (e.punto_venta_id ?? null)
    || c.ambiente !== "PRUEBAS" || !Number.isFinite(cufdStart) || !Number.isFinite(cufdEnd) || start < cufdStart || start >= cufdEnd
    || r.estado !== "VIGENTE" || !Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd) || issued < rangeStart || issued > rangeEnd) throw new Error("CAFC_AUTORIZACION_O_CUFD_INVALIDO");
  if (s.nit !== required(input.issuerNit, "NIT_EMISOR") || e.codigo_sucursal == null || !Number.isInteger(Number(e.codigo_sucursal)) || s.codigoSucursal !== Number(e.codigo_sucursal)
    || (s.codigoPuntoVenta ?? 0) !== Number(e.codigo_punto_venta ?? 0) || s.modalidad !== "ELECTRONICA" || s.documentoSector !== 1 || s.cufd !== required(c.codigo, "CUFD") || s.totales.cafc !== required(r.autorizacion, "AUTORIZACION")
    || !/^\d+$/.test(s.numeroFactura) || BigInt(s.numeroFactura) < BigInt(required(r.rango_desde, "RANGO")) || BigInt(s.numeroFactura) > BigInt(required(r.rango_hasta, "RANGO"))) throw new Error("CAFC_NUMERO_O_DOCUMENTO_INVALIDO");
  for (const [name, value] of Object.entries({ nit: s.nit, razonSocial: s.razonSocial, municipio: s.municipio, direccion: s.direccion, cliente: s.cliente.nombreRazonSocial, documento: s.cliente.numeroDocumento, codigoCliente: s.cliente.codigoCliente, leyenda: s.leyenda, usuario: s.usuario })) required(value, name.toUpperCase());
  if (!s.detalle.length || s.detalle.length > 500 || !Number.isInteger(s.pago.codigoMetodoPago) || s.pago.codigoMetodoPago < 1
    || ![1, 2, 3, 4, 5].includes(s.cliente.codigoTipoDocumentoIdentidad)) throw new Error("CAFC_DETALLE_O_PAGO_INVALIDO");
  if (s.cliente.codigoTipoDocumentoIdentidad === 5 ? s.totales.codigoExcepcion !== 1 : ![null, undefined, 0].includes(s.totales.codigoExcepcion)) throw new Error("CAFC_EXCEPCION_DOCUMENTO_INVALIDA");
  let sum = new Decimal(0);
  for (const line of s.detalle) {
    for (const value of [line.actividadEconomica, line.codigoProductoSin, line.codigoProducto, line.descripcion, line.unidadMedidaSin]) required(value, "DETALLE");
    const qty = money(line.cantidad), price = money(line.precioUnitario), discount = money(line.descuento ?? 0), subtotal = money(line.subtotal);
    if (!qty.isPositive() || !qty.mul(price).minus(discount).toDecimalPlaces(2).eq(subtotal)) throw new Error("CAFC_SUBTOTAL_NO_COINCIDE");
    sum = sum.plus(subtotal);
  }
  if (!sum.minus(money(s.totales.descuentoAdicional ?? 0)).eq(money(s.totales.montoTotal)) || !money(s.totales.montoTotal).isPositive()) throw new Error("CAFC_TOTAL_NO_COINCIDE");
  const cuf = generateCuf({ nit: s.nit, fechaEmision: s.fechaEmision, codigoSucursal: s.codigoSucursal, modalidad: 1, tipoEmision: 2, tipoFactura: s.tipoFactura,
    documentoSector: s.documentoSector, numeroFactura: s.numeroFactura, codigoPuntoVenta: s.codigoPuntoVenta, codigoControl: required(c.codigo_control, "CONTROL") });
  const corrected = { ...s, cuf };
  validateSignatureCredentials(input.privateKeyPem, input.certificatePem);
  const xml = signInvoiceXml(generateInvoiceXml(corrected), input.privateKeyPem, input.certificatePem);
  validateElectronicInvoiceXml(xml, input.xsd, input.signatureXsd); verifyInvoiceSignature(xml, input.certificatePem);
  return { xml, cuf, originalSha256: input.originalSha256, fingerprint: digest(stable({ snapshot: corrected, eventId: e.id, cufdId: c.id, cafcId: r.id, originalSha256: input.originalSha256, certificateSha256: digest(certificateDerFromPem(input.certificatePem)) })) };
}

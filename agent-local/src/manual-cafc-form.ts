import Decimal from "decimal.js";
import { offlineDocumentType } from "./contingency-safety.ts";
import type { BootstrapBundle, LocalSession } from "./types.ts";
import type { InvoiceSnapshot } from "../../supabase/functions/_shared/siat/types.ts";

type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const required = (value: unknown, code: string): string => { const text = String(value ?? "").trim(); if (!text) throw new Error(`CAFC_${code}_REQUERIDO`); return text; };
const amount = (value: unknown, code: string) => { try { const n = new Decimal(String(value)); if (!n.isFinite() || n.isNegative()) throw new Error(); return n; } catch { throw new Error(`CAFC_${code}_INVALIDO`); } };

/** El formulario proporciona datos del comprobante; los códigos fiscales provienen del aprovisionamiento. */
export function snapshotManualCafc(draft: Row, bundle: BootstrapBundle, event: Row, session: LocalSession): InvoiceSnapshot {
  if (draft.eventoId !== event.id || draft.cafcId !== event.cafcId) throw new Error("CAFC_EVENTO_O_RANGO_NO_COINCIDE");
  const cufd = row(event.cufd), config = bundle.config, branch = bundle.branch, point = bundle.point ?? {};
  const range = bundle.cafc.find(item => item.id === event.cafcId);
  const client = bundle.clients.find(item => item.id === draft.clienteId);
  if (!range || !client) throw new Error("CAFC_CLIENTE_O_RANGO_NO_DISPONIBLE");
  const payment = bundle.payments.find(item => item.metodo_interno === draft.metodoPago);
  if (!payment) throw new Error("CAFC_PAGO_NO_HOMOLOGADO");
  if (draft.metodoPago === "TARJETA" && !/^\d{4}00000000\d{4}$/.test(String(draft.tarjetaOfuscada ?? ""))) throw new Error("CAFC_TARJETA_NO_OFUSCADA");
  if (draft.metodoPago !== "TARJETA" && draft.tarjetaOfuscada) throw new Error("CAFC_TARJETA_NO_CORRESPONDE");
  const doc = offlineDocumentType(client.tipo_documento);
  const items = Array.isArray(draft.items) ? draft.items.map(row) : [];
  if (!items.length || items.length > 500) throw new Error("CAFC_DETALLE_REQUERIDO");
  const details = items.map(item => {
    const product = bundle.products.find(p => p.id === item.productoId);
    const hom = bundle.homologations.find(h => h.producto_id === item.productoId && h.estado === "HOMOLOGADO");
    if (!product || !hom) throw new Error("CAFC_PRODUCTO_SIN_HOMOLOGACION");
    const qty = amount(item.cantidad, "CANTIDAD"), price = amount(item.precioUnitario, "PRECIO"), discount = amount(item.descuento, "DESCUENTO");
    const subtotal = qty.mul(price).minus(discount);
    if (!qty.isPositive() || subtotal.isNegative() || qty.decimalPlaces() > 3 || price.decimalPlaces() > 2 || discount.decimalPlaces() > 2) throw new Error("CAFC_DETALLE_INVALIDO");
    if (!amount(item.subtotalOriginal, "SUBTOTAL_ORIGINAL").eq(subtotal.toDecimalPlaces(2))) throw new Error("CAFC_SUBTOTAL_ORIGINAL_NO_COINCIDE");
    return { actividadEconomica: required(hom.actividad_economica, "ACTIVIDAD"), codigoProductoSin: required(hom.codigo_producto_sin, "PRODUCTO_SIN"),
      codigoProducto: required(item.codigoOriginal, "CODIGO_ORIGINAL"), descripcion: required(item.descripcionOriginal, "DESCRIPCION_ORIGINAL"), cantidad: qty.toFixed(3),
      unidadMedidaSin: required(hom.unidad_medida_sin, "UNIDAD"), precioUnitario: price.toFixed(2), descuento: discount.toFixed(2), subtotal: subtotal.toFixed(2) };
  });
  const discount = amount(draft.descuentoAdicional, "DESCUENTO"), total = details.reduce((sum, item) => sum.plus(item.subtotal), new Decimal(0)).minus(discount);
  const declared = amount(draft.totalOriginal, "TOTAL_ORIGINAL"), subject = amount(draft.totalSujetoIva, "TOTAL_IVA");
  if (!total.isPositive() || !total.eq(declared) || subject.gt(total)) throw new Error("CAFC_TOTAL_ORIGINAL_NO_COINCIDE");
  const fecha = required(draft.fechaEmision, "FECHA");
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(fecha) || !Number.isFinite(Date.parse(`${fecha}-04:00`))) throw new Error("CAFC_FECHA_INVALIDA");
  if (config.modalidad !== "ELECTRONICA" || Number(config.documento_sector) !== 1 || Number(config.tipo_factura) !== 1) throw new Error("CAFC_CONFIGURACION_NO_COMPATIBLE");
  return { id: required(draft.facturaId, "FACTURA"), correlationId: required(draft.correlationId, "CORRELACION"), nit: required(config.nit, "NIT"),
    razonSocial: required(config.razon_social, "EMISOR"), municipio: required(config.municipio, "MUNICIPIO"), telefono: String(config.telefono ?? "") || null,
    numeroFactura: required(draft.numeroFactura, "NUMERO"), cuf: "", cufd: required(cufd.codigo, "CUFD"), codigoSucursal: Number(branch.codigo),
    direccion: required(cufd.direccion, "DIRECCION"), codigoPuntoVenta: Number(point.codigo ?? 0), fechaEmision: `${fecha}-04:00`, modalidad: "ELECTRONICA", documentoSector: 1, tipoFactura: 1,
    cliente: { nombreRazonSocial: required(client.nombre_razon_social, "CLIENTE"), codigoTipoDocumentoIdentidad: doc.code, numeroDocumento: required(client.numero_documento, "DOCUMENTO"), complemento: String(client.complemento ?? "") || null, codigoCliente: required(client.codigo_cliente, "CODIGO_CLIENTE") },
    pago: { codigoMetodoPago: Number(payment.codigo_metodo_pago), numeroTarjeta: String(draft.tarjetaOfuscada ?? "") || null, codigoMoneda: 1, tipoCambio: "1.00" },
    totales: { montoTotal: total.toFixed(2), montoTotalSujetoIva: subject.toFixed(2), montoTotalMoneda: total.toFixed(2), descuentoAdicional: discount.toFixed(2), montoGiftCard: null, codigoExcepcion: doc.exception, cafc: required(range.autorizacion, "AUTORIZACION") },
    leyenda: required(draft.leyenda, "LEYENDA"), usuario: required(session.userName, "USUARIO"), detalle: details };
}

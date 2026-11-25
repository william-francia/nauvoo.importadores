import { DOMParser } from "@xmldom/xmldom";
import { Decimal } from "decimal.js";
import { gunzipBytes, sha256Hex } from "./encoding.ts";
import { siatDateTime } from "./invoice-xml.ts";
import type { InvoiceSnapshot } from "./types.ts";

export type PersistedInvoiceIdentity = {
  id: string; ambiente: string; estadoFiscal: string; codigoEstado: number | null;
  transaccion: boolean | null; codigoRecepcion: string | null; cuf: string | null;
  numeroFactura: string; cliente: string; documento: string; total: number; fechaEmision: string; sucursal: string; puntoVenta: string;
  xmlHash: string | null; xmlFirmado: boolean;
};

export async function originalSignedXml(gzip: Uint8Array, expectedHash: string | null): Promise<Uint8Array> {
  if (!expectedHash || !/^[A-F0-9]{64}$/i.test(expectedHash) || await sha256Hex(gzip) !== expectedHash.toUpperCase()) {
    throw new Error("El hash del XML almacenado no coincide con el archivo enviado al SIN.");
  }
  return gunzipBytes(gzip);
}

export function snapshotFromSignedXml(bytes: Uint8Array, expected: PersistedInvoiceIdentity): InvoiceSnapshot {
  if (expected.ambiente !== "PRUEBAS" || !["VALIDADA", "ANULADA", "REVERTIDA"].includes(expected.estadoFiscal) || expected.codigoEstado !== 908
    || expected.transaccion !== true || !expected.codigoRecepcion || !expected.xmlFirmado) {
    throw new Error("La representación requiere una factura piloto validada y firmada.");
  }
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("El XML fiscal contiene una declaración no permitida.");
  const doc = new DOMParser({ onError: () => { throw new Error("XML fiscal electrónico inválido."); } }).parseFromString(xml, "text/xml");
  if (doc.getElementsByTagName("parsererror").length || doc.documentElement?.tagName !== "facturaElectronicaCompraVenta") throw new Error("XML fiscal electrónico inválido.");
  const root = doc.documentElement;
  const signatures = doc.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature");
  if (signatures.length !== 1 || signatures.item(0)?.parentNode !== root) throw new Error("El XML fiscal no contiene una firma XMLDSig válida en su estructura.");
  type XmlElement = typeof root;
  const direct = (parent: XmlElement, name: string) => Array.from(parent.childNodes).filter((node) => node.nodeType === 1 && (node as XmlElement).tagName === name) as XmlElement[];
  const header = direct(root, "cabecera");
  if (header.length !== 1) throw new Error("Cabecera fiscal inválida.");
  const read = (parent: XmlElement, name: string, required = true): string => {
    const nodes = direct(parent, name);
    if (nodes.length !== 1) throw new Error(`Campo fiscal ${name} ausente o duplicado.`);
    const value = nodes[0].textContent?.trim() ?? "";
    if (required && !value) throw new Error(`Campo fiscal ${name} vacío.`);
    return value;
  };
  const h = header[0];
  const get = (name: string, required = true) => read(h, name, required);
  const number = (value: string, name: string) => {
    if (!/^\d+$/.test(value)) throw new Error(`Campo fiscal ${name} inválido.`);
    return Number(value);
  };
  const money = (value: string) => { try { const n = new Decimal(value); if (!n.isFinite() || n.isNegative()) throw new Error(); return n; } catch { throw new Error("Importe fiscal inválido."); } };
  const cuf = get("cuf"), numeroFactura = get("numeroFactura"), documento = get("numeroDocumento"), fiscalDate = get("fechaEmision");
  const total = get("montoTotal");
  if (cuf !== expected.cuf || numeroFactura !== expected.numeroFactura || documento !== expected.documento
    || get("nombreRazonSocial", false) !== expected.cliente || get("codigoSucursal") !== expected.sucursal
    || (get("codigoPuntoVenta", false) || "0") !== expected.puntoVenta
    || !money(total).eq(expected.total) || fiscalDate !== siatDateTime(expected.fechaEmision)) {
    throw new Error("El XML fiscal no coincide con la factura persistida.");
  }
  const detailNodes = direct(root, "detalle");
  if (!detailNodes.length) throw new Error("El XML fiscal no contiene detalle.");
  const detalle = detailNodes.map((line) => {
    const cantidad = read(line, "cantidad"), precioUnitario = read(line, "precioUnitario"), descuento = read(line, "montoDescuento", false), subtotal = read(line, "subTotal");
    if (!money(cantidad).mul(money(precioUnitario)).minus(money(descuento || "0")).toDecimalPlaces(2).eq(money(subtotal))) throw new Error("El subtotal del XML fiscal es inconsistente.");
    return { actividadEconomica: read(line, "actividadEconomica"), codigoProductoSin: read(line, "codigoProductoSin"), codigoProducto: read(line, "codigoProducto"),
      descripcion: read(line, "descripcion"), cantidad, unidadMedidaSin: read(line, "unidadMedida"), precioUnitario, descuento: descuento || null, subtotal,
      numeroSerie: read(line, "numeroSerie", false) || null, numeroImei: read(line, "numeroImei", false) || null };
  });
  const descuentoAdicional = get("descuentoAdicional", false);
  if (!detalle.reduce((sum, item) => sum.plus(money(item.subtotal)), new Decimal(0)).minus(money(descuentoAdicional || "0")).eq(money(total))) throw new Error("El total del XML fiscal es inconsistente.");
  const point = get("codigoPuntoVenta", false);
  return {
    id: expected.id, correlationId: expected.id, nit: get("nitEmisor"), razonSocial: get("razonSocialEmisor"), municipio: get("municipio"), telefono: get("telefono", false) || null,
    numeroFactura, cuf, cufd: get("cufd"), codigoSucursal: number(get("codigoSucursal"), "codigoSucursal"), direccion: get("direccion"),
    codigoPuntoVenta: point ? number(point, "codigoPuntoVenta") : null, fechaEmision: expected.fechaEmision, modalidad: "ELECTRONICA", documentoSector: number(get("codigoDocumentoSector"), "codigoDocumentoSector"), tipoFactura: 1,
    cliente: { nombreRazonSocial: get("nombreRazonSocial", false) || null, codigoTipoDocumentoIdentidad: number(get("codigoTipoDocumentoIdentidad"), "codigoTipoDocumentoIdentidad"), numeroDocumento: documento, complemento: get("complemento", false) || null, codigoCliente: get("codigoCliente") },
    pago: { codigoMetodoPago: number(get("codigoMetodoPago"), "codigoMetodoPago"), numeroTarjeta: get("numeroTarjeta", false) || null, codigoMoneda: number(get("codigoMoneda"), "codigoMoneda"), tipoCambio: get("tipoCambio") },
    totales: { montoTotal: total, montoTotalSujetoIva: get("montoTotalSujetoIva"), montoTotalMoneda: get("montoTotalMoneda"), montoGiftCard: get("montoGiftCard", false) || null, descuentoAdicional: descuentoAdicional || null },
    leyenda: get("leyenda"), usuario: get("usuario"), detalle,
  };
}

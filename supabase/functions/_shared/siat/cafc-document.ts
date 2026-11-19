import { DOMParser } from "@xmldom/xmldom";
import { verifyInvoiceSignature } from "./xmldsig.ts";
import { validateElectronicInvoiceXml } from "./xsd.ts";

/** Extrae exclusivamente datos del XML firmado; no confía en snapshots enviados por el cliente. */
export function verifiedCafcDocument(xml: string, certificate: string, xsd: string, signatureXsd: string): Record<string, unknown> {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("CAFC_XML_NO_PERMITIDO");
  validateElectronicInvoiceXml(xml, xsd, signatureXsd); verifyInvoiceSignature(xml, certificate);
  const document = new DOMParser({ onError: () => { throw new Error("CAFC_XML_INVALIDO"); } }).parseFromString(xml, "text/xml");
  const root = document.documentElement;
  if (!root || root.tagName !== "facturaElectronicaCompraVenta") throw new Error("CAFC_XML_INVALIDO");
  const elements = (parent: typeof root, name: string) => Array.from(parent.childNodes).filter((item) => item.nodeType === 1 && (item as typeof root).tagName === name) as Array<typeof root>;
  const headers = elements(root, "cabecera"); if (headers.length !== 1) throw new Error("CAFC_CABECERA_INVALIDA");
  const read = (parent: typeof root, name: string, optional = false) => {
    const values = elements(parent, name); if (values.length !== 1) throw new Error(`CAFC_CAMPO_${name}_INVALIDO`);
    const value = (values[0]?.textContent ?? "").trim(); if (!optional && !value) throw new Error(`CAFC_CAMPO_${name}_VACIO`); return value || null;
  };
  const h = headers[0]!; const get = (name: string, optional = false) => read(h, name, optional);
  const localDate = get("fechaEmision");
  if (!localDate || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/.test(localDate) || !Number.isFinite(Date.parse(`${localDate}-04:00`))) throw new Error("CAFC_FECHA_INVALIDA");
  if (get("codigoDocumentoSector") !== "1") throw new Error("CAFC_SECTOR_NO_SOPORTADO");
  const detalle = elements(root, "detalle").map((line) => ({
    actividadEconomica: read(line, "actividadEconomica"), codigoProductoSin: read(line, "codigoProductoSin"), codigoProducto: read(line, "codigoProducto"),
    descripcion: read(line, "descripcion"), cantidad: read(line, "cantidad"), unidadMedidaSin: read(line, "unidadMedida"),
    precioUnitario: read(line, "precioUnitario"), descuento: read(line, "montoDescuento", true), subtotal: read(line, "subTotal"),
  }));
  if (!detalle.length || detalle.length > 500) throw new Error("CAFC_DETALLE_INVALIDO");
  const tipoDocumento = get("codigoTipoDocumentoIdentidad"); const excepcion = get("codigoExcepcion", true);
  if (tipoDocumento === "5" ? excepcion !== "1" : excepcion !== null && excepcion !== "0") throw new Error("CAFC_EXCEPCION_INVALIDA");
  return {
    nit: get("nitEmisor"), numeroFactura: get("numeroFactura"), cuf: get("cuf"), cufd: get("cufd"), cafc: get("cafc"),
    codigoSucursal: get("codigoSucursal"), codigoPuntoVenta: get("codigoPuntoVenta", true) ?? "0", fechaEmision: new Date(`${localDate}-04:00`).toISOString(),
    nombreRazonSocial: get("nombreRazonSocial"), tipoDocumento, numeroDocumento: get("numeroDocumento"), complemento: get("complemento", true),
    codigoMetodoPago: get("codigoMetodoPago"), montoTotal: get("montoTotal"), descuentoAdicional: get("descuentoAdicional", true),
    clienteSnapshot: { nombreRazonSocial: get("nombreRazonSocial"), codigoTipoDocumentoIdentidad: tipoDocumento, numeroDocumento: get("numeroDocumento"), complemento: get("complemento", true), codigoCliente: get("codigoCliente") },
    detalleSnapshot: detalle,
    totalesSnapshot: { montoTotal: get("montoTotal"), montoTotalSujetoIva: get("montoTotalSujetoIva"), montoTotalMoneda: get("montoTotalMoneda"), descuentoAdicional: get("descuentoAdicional", true), codigoExcepcion: excepcion, cafc: get("cafc") },
    pagoSnapshot: { codigoMetodoPago: get("codigoMetodoPago"), numeroTarjeta: get("numeroTarjeta", true), codigoMoneda: get("codigoMoneda"), tipoCambio: get("tipoCambio") },
  };
}

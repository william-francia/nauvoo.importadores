import { formatMoney, formatQuantity } from "./money.ts";
import type { InvoiceSnapshot } from "./types.ts";

const escapeXml = (value: string | number) => String(value)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&apos;");

const element = (name: string, value: string | number | null | undefined) => value == null || value === ""
  ? `<${name} xsi:nil="true"/>`
  : `<${name}>${escapeXml(value)}</${name}>`;

const siatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("La fecha de emisión del snapshot no es válida.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/La_Paz", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}.${String(date.getUTCMilliseconds()).padStart(3, "0")}`;
};

export function generateInvoiceXml(snapshot: InvoiceSnapshot): string {
  if (snapshot.documentoSector !== 1) throw new Error("Solo el documento sector Compra y Venta (1) cuenta con XSD oficial incorporado en esta fase.");
  if (!snapshot.detalle.length || snapshot.detalle.length > 500) throw new Error("La factura debe contener entre 1 y 500 detalles.");
  const root = snapshot.modalidad === "ELECTRONICA" ? "facturaElectronicaCompraVenta" : "facturaComputarizadaCompraVenta";
  const header = [
    element("nitEmisor", snapshot.nit), element("razonSocialEmisor", snapshot.razonSocial),
    element("municipio", snapshot.municipio), element("telefono", snapshot.telefono),
    element("numeroFactura", snapshot.numeroFactura), element("cuf", snapshot.cuf), element("cufd", snapshot.cufd),
    element("codigoSucursal", snapshot.codigoSucursal), element("direccion", snapshot.direccion),
    element("codigoPuntoVenta", snapshot.codigoPuntoVenta), element("fechaEmision", siatDateTime(snapshot.fechaEmision)),
    element("nombreRazonSocial", snapshot.cliente.nombreRazonSocial),
    element("codigoTipoDocumentoIdentidad", snapshot.cliente.codigoTipoDocumentoIdentidad),
    element("numeroDocumento", snapshot.cliente.numeroDocumento), element("complemento", snapshot.cliente.complemento),
    element("codigoCliente", snapshot.cliente.codigoCliente), element("codigoMetodoPago", snapshot.pago.codigoMetodoPago),
    element("numeroTarjeta", snapshot.pago.numeroTarjeta), element("montoTotal", formatMoney(snapshot.totales.montoTotal)),
    element("montoTotalSujetoIva", formatMoney(snapshot.totales.montoTotalSujetoIva)),
    element("codigoMoneda", snapshot.pago.codigoMoneda), element("tipoCambio", formatMoney(snapshot.pago.tipoCambio)),
    element("montoTotalMoneda", formatMoney(snapshot.totales.montoTotalMoneda)),
    element("montoGiftCard", snapshot.totales.montoGiftCard == null ? null : formatMoney(snapshot.totales.montoGiftCard)),
    element("descuentoAdicional", snapshot.totales.descuentoAdicional == null ? null : formatMoney(snapshot.totales.descuentoAdicional)),
    element("codigoExcepcion", snapshot.totales.codigoExcepcion), element("cafc", snapshot.totales.cafc),
    element("leyenda", snapshot.leyenda), element("usuario", snapshot.usuario),
    element("codigoDocumentoSector", snapshot.documentoSector),
  ].join("");
  const details = snapshot.detalle.map((line) => `<detalle>${[
    element("actividadEconomica", line.actividadEconomica), element("codigoProductoSin", line.codigoProductoSin),
    element("codigoProducto", line.codigoProducto), element("descripcion", line.descripcion),
    element("cantidad", formatQuantity(line.cantidad)), element("unidadMedida", line.unidadMedidaSin),
    element("precioUnitario", formatMoney(line.precioUnitario)),
    element("montoDescuento", line.descuento == null ? null : formatMoney(line.descuento)),
    element("subTotal", formatMoney(line.subtotal)), element("numeroSerie", line.numeroSerie), element("numeroImei", line.numeroImei),
  ].join("")}</detalle>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${root} xsi:noNamespaceSchemaLocation="${root}.xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><cabecera>${header}</cabecera>${details}</${root}>`;
}

export { escapeXml, siatDateTime };

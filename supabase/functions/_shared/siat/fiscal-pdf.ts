import { Decimal } from "decimal.js";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import QRCode from "qrcode";
import type { InvoiceSnapshot } from "./types.ts";
import { NAUVOO_LOGO_JPEG_BASE64 } from "./brand-logo.ts";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const BLACK = rgb(0, 0, 0);
const BORDER = rgb(0.46, 0.46, 0.46);
const HEADER = rgb(0.93, 0.93, 0.93);
const money = (value: string | null | undefined) => new Decimal(value || 0).toFixed(2);

function wrapByWidth(value: string, font: PDFFont, size: number, width: number): string[] {
  const chunks = String(value).trim().split(/\s+/).filter(Boolean).flatMap((word) => {
    const result: string[] = []; let part = "";
    for (const character of word) {
      if (part && font.widthOfTextAtSize(part + character, size) > width) { result.push(part); part = character; }
      else part += character;
    }
    if (part) result.push(part);
    return result;
  });
  const lines: string[] = []; let line = "";
  for (const part of chunks) {
    const candidate = line ? `${line} ${part}` : part;
    if (line && font.widthOfTextAtSize(candidate, size) > width) { lines.push(line); line = part; }
    else line = candidate;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

const formatDate = (value: string) => new Intl.DateTimeFormat("es-BO", {
  timeZone: "America/La_Paz", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
}).format(new Date(value)).replace(",", "");

const quantity = (value: string) => {
  const fixed = new Decimal(value).toFixed(3);
  return fixed.endsWith("0") ? fixed.slice(0, -1) : fixed;
};

const UNITS = ["", "UN", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE"];
const SPECIAL = ["DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE", "VEINTE", "VEINTIÚN", "VEINTIDÓS", "VEINTITRÉS", "VEINTICUATRO", "VEINTICINCO", "VEINTISÉIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE"];
const TENS = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const HUNDREDS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

function underThousand(value: number): string {
  if (value === 100) return "CIEN";
  const parts: string[] = [];
  if (value >= 100) parts.push(HUNDREDS[Math.floor(value / 100)]);
  const rest = value % 100;
  if (rest >= 10 && rest < 30) parts.push(SPECIAL[rest - 10]);
  else if (rest >= 30) parts.push(TENS[Math.floor(rest / 10)] + (rest % 10 ? ` Y ${UNITS[rest % 10]}` : ""));
  else if (rest) parts.push(UNITS[rest]);
  return parts.join(" ");
}

function underMillion(value: number): string {
  const thousands = Math.floor(value / 1000), rest = value % 1000;
  return [thousands ? thousands === 1 ? "MIL" : `${underThousand(thousands)} MIL` : "", rest ? underThousand(rest) : ""].filter(Boolean).join(" ");
}

export function amountInWords(value: string): string {
  const amount = new Decimal(value);
  if (!amount.isFinite() || amount.isNegative() || amount.gte("1000000000000000000")) throw new Error("Importe fuera de rango para representación fiscal.");
  const [integer, cents] = amount.toFixed(2).split(".");
  let remaining = BigInt(integer);
  const billones = Number(remaining / 1000000000000n); remaining %= 1000000000000n;
  const millones = Number(remaining / 1000000n); remaining %= 1000000n;
  const rest = Number(remaining);
  const words = [billones ? billones === 1 ? "UN BILLÓN" : `${underMillion(billones)} BILLONES` : "",
    millones ? millones === 1 ? "UN MILLÓN" : `${underMillion(millones)} MILLONES` : "", rest ? underMillion(rest) : ""].filter(Boolean).join(" ") || "CERO";
  return `${words} CON ${cents}/100 BOLIVIANOS`;
}

type PdfOptions = { format?: "carta" | "rollo"; widthMm?: number; logoBytes?: Uint8Array };

export async function generateFiscalPdf(snapshot: InvoiceSnapshot, qrContent: string, options: PdfOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const qrUrl = await QRCode.toDataURL(qrContent, { errorCorrectionLevel: "M", margin: 2, width: 400 });
  const qr = await doc.embedPng(Uint8Array.from(atob(qrUrl.split(",")[1]), (char) => char.charCodeAt(0)));
  const logo = options.logoBytes ? await doc.embedPng(options.logoBytes)
    : await doc.embedJpg(Uint8Array.from(atob(NAUVOO_LOGO_JPEG_BASE64), (char) => char.charCodeAt(0)));
  if (options.format === "rollo") return generateRollPdf(doc, font, bold, qr, logo, snapshot, options.widthMm ?? 80);

  let page!: PDFPage; let y = 0;
  const addPage = () => { page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]); y = PAGE_HEIGHT - 30; };
  const text = (value: string, x: number, atY: number, size = 8, strong = false, align: "left" | "right" | "center" = "left") => {
    const face = strong ? bold : font; const measured = face.widthOfTextAtSize(value, size);
    page.drawText(value, { x: align === "right" ? x - measured : align === "center" ? x - measured / 2 : x, y: atY, size, font: face, color: BLACK });
  };
  const centeredParagraph = (value: string, center: number, width: number, size = 7, strong = false, leading = 9) => {
    for (const line of wrapByWidth(value, strong ? bold : font, size, width)) { text(line, center, y, size, strong, "center"); y -= leading; }
  };
  const line = (x1: number, y1: number, x2: number, y2: number) => page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.65, color: BORDER });
  addPage();

  if (logo) {
    const width = 118, height = width * logo.height / logo.width;
    page.drawImage(logo, { x: 135 - width / 2, y: PAGE_HEIGHT - 22 - height, width, height });
    y = PAGE_HEIGHT - Math.max(74, 27 + height);
  } else y = PAGE_HEIGHT - 45;
  centeredParagraph(snapshot.razonSocial, 135, 210, 8, true);
  centeredParagraph(snapshot.codigoSucursal === 0 ? "CASA MATRIZ" : `SUCURSAL Nro ${snapshot.codigoSucursal}`, 135, 210, 7.5, true);
  centeredParagraph(`Nro de Punto de Venta ${snapshot.codigoPuntoVenta ?? 0}`, 135, 210, 7.5);
  centeredParagraph(snapshot.direccion, 135, 210, 7.5);
  if (snapshot.telefono) centeredParagraph(`Teléfono: ${snapshot.telefono}`, 135, 210, 7.5);
  centeredParagraph(snapshot.municipio, 135, 210, 7.5);
  const leftEnd = y;
  const fiscal = [["NIT", snapshot.nit], ["FACTURA N°", snapshot.numeroFactura], ["COD. AUTORIZACIÓN", snapshot.cuf]];
  let fiscalY = PAGE_HEIGHT - 37;
  for (const [label, value] of fiscal) {
    text(label, 357, fiscalY, 8, true);
    const parts = wrapByWidth(value, font, 8, 112);
    parts.forEach((part, index) => text(part, 467, fiscalY - index * 10, 8));
    fiscalY -= Math.max(14.5, parts.length * 10);
  }
  y = Math.min(leftEnd - 5, fiscalY - 8, PAGE_HEIGHT - 171);
  text("FACTURA", PAGE_WIDTH / 2, y, 13, true, "center"); y -= 13;
  text("(Con derecho a Crédito Fiscal)", PAGE_WIDTH / 2, y, 9, false, "center"); y -= 24;
  text("Fecha:", 35, y, 7.5, true); text(formatDate(snapshot.fechaEmision), 125, y, 7.5);
  text("NIT/CI/CEX", 393, y, 7.5, true);
  text(`${snapshot.cliente.numeroDocumento}${snapshot.cliente.complemento ? `-${snapshot.cliente.complemento}` : ""}`, 449, y, 7.5);
  y -= 14;
  text("Nombre/Razón Social:", 35, y, 7.5, true);
  const customerLines = wrapByWidth(snapshot.cliente.nombreRazonSocial ?? "S/N", font, 7.5, 250);
  customerLines.forEach((part, index) => text(part, 125, y - index * 10, 7.5));
  text("Cod. Cliente", 393, y, 7.5, true); text(snapshot.cliente.codigoCliente, 449, y, 7.5);
  y -= Math.max(1, customerLines.length) * 10 + 3;
  text(`Método de pago: código SIN ${snapshot.pago.codigoMetodoPago}`, 35, y, 7);
  y -= 15;

  const positions = [30, 95, 149, 219, 355, 424, 493, 584];
  const labels = [["CÓDIGO", "PRODUCTO /", "SERVICIO"], ["CANTIDAD"], ["UNIDAD DE", "MEDIDA"], ["DESCRIPCIÓN"], ["PRECIO", "UNITARIO"], ["DESCUENTO"], ["SUB TOTAL"]];
  const tableHeader = () => {
    const height = 34;
    page.drawRectangle({ x: positions[0], y: y - height, width: positions[7] - positions[0], height, color: HEADER, borderColor: BORDER, borderWidth: 0.65 });
    labels.forEach((label, index) => {
      const mid = (positions[index] + positions[index + 1]) / 2;
      const firstY = y - (height - label.length * 8) / 2 - 6;
      label.forEach((part, row) => text(part, mid, firstY - row * 8, 7, true, "center"));
      if (index) line(positions[index], y, positions[index], y - height);
    });
    y -= height;
  };
  tableHeader();
  for (const item of snapshot.detalle) {
    const description = [item.descripcion, item.numeroSerie ? `Serie: ${item.numeroSerie}` : "", item.numeroImei ? `IMEI: ${item.numeroImei}` : ""].filter(Boolean).join(" ");
    const values = [item.codigoProducto, quantity(item.cantidad), item.unidadDescripcion || item.unidadMedidaSin, description, money(item.precioUnitario), money(item.descuento), money(item.subtotal)];
    const rows = values.map((value, i) => wrapByWidth(value, font, 7.5, positions[i + 1] - positions[i] - 8));
    const count = Math.max(...rows.map((r) => r.length));
    for (let offset = 0; offset < count;) {
      if (y < 190) { addPage(); tableHeader(); }
      const chunk = Math.min(count - offset, Math.max(1, Math.floor((y - 175 - 5) / 10)));
      const height = Math.max(15, chunk * 10 + 5);
      page.drawRectangle({ x: positions[0], y: y - height, width: positions[7] - positions[0], height, borderColor: BORDER, borderWidth: 0.65 });
      rows.forEach((parts, i) => {
        if (i) line(positions[i], y, positions[i], y - height);
        parts.slice(offset, offset + chunk).forEach((part, n) => text(part, [1, 4, 5, 6].includes(i) ? positions[i + 1] - 4 : positions[i] + 4, y - 10 - n * 10, 7.5, false, [1, 4, 5, 6].includes(i) ? "right" : "left"));
      });
      y -= height; offset += chunk;
    }
  }

  const subtotal = snapshot.detalle.reduce((sum, item) => sum.plus(item.subtotal), new Decimal(0));
  const totalRows = [["SUB-TOTAL Bs.-", subtotal.toFixed(2)], ["DESCUENTO Bs.-", money(snapshot.totales.descuentoAdicional)], ["TOTAL Bs.-", money(snapshot.totales.montoTotal)]];
  if (new Decimal(snapshot.totales.montoGiftCard || 0).gt(0)) totalRows.push(["MONTO GIFT CARD Bs.-", money(snapshot.totales.montoGiftCard)]);
  totalRows.push([snapshot.pago.codigoMoneda === 1 ? "MONTO A PAGAR Bs.-" : `TOTAL MONEDA CÓD. ${snapshot.pago.codigoMoneda}`, money(snapshot.totales.montoTotalMoneda)], ["IMPORTE BASE CRÉDITO FISCAL Bs.-", money(snapshot.totales.montoTotalSujetoIva)]);
  const words = wrapByWidth(`Son: ${amountInWords(snapshot.totales.montoTotal)}`, font, 7.5, 305);
  const totalHeight = Math.max(totalRows.length * 15, words.length * 10 + 10);
  if (y - totalHeight < 155) addPage();
  const totalTop = y;
  words.forEach((part, index) => text(part, 35, totalTop - 12 - index * 10, 7.5));
  totalRows.forEach(([label, value], index) => {
    const top = totalTop - index * 15;
    page.drawRectangle({ x: 355, y: top - 15, width: 229, height: 15, borderColor: BORDER, borderWidth: 0.65 });
    line(493, top, 493, top - 15);
    text(label, 489, top - 10.5, 7, index >= totalRows.length - 2, "right");
    text(value, 580, top - 10.5, 7.5, index >= totalRows.length - 2, "right");
  });
  y = totalTop - totalHeight - 20;

  const legal = "ESTA FACTURA CONTRIBUYE AL DESARROLLO DEL PAÍS, EL USO ILÍCITO SERÁ SANCIONADO PENALMENTE DE ACUERDO A LEY";
  const note = "Este documento es la Representación Gráfica de un Documento Fiscal Digital emitido en una modalidad de facturación en línea.";
  const legalLines = wrapByWidth(legal, font, 7, 450);
  const legendLines = wrapByWidth(snapshot.leyenda, font, 7, 450);
  const noteLines = wrapByWidth(note, font, 7, 450);
  const footerHeight = Math.max(88, (legalLines.length + legendLines.length + noteLines.length) * 9 + 28);
  if (y - footerHeight < 35) { addPage(); y -= 10; }
  const qrTop = y + 4;
  for (const parts of [legalLines, legendLines, noteLines]) {
    for (const part of parts) { text(part, 258, y, 7, false, "center"); y -= 9; }
    y -= 7;
  }
  page.drawImage(qr, { x: 497, y: qrTop - 87, width: 87, height: 87 });
  const pages = doc.getPages();
  pages.forEach((current, index) => {
    current.drawText(`Usuario: ${snapshot.usuario}`, { x: 30, y: 20, size: 8, font, color: BLACK });
    const pageLabel = `${index + 1}/${pages.length}`;
    current.drawText(pageLabel, { x: 584 - font.widthOfTextAtSize(pageLabel, 8), y: 20, size: 8, font, color: BLACK });
  });
  return doc.save();
}

async function generateRollPdf(doc: PDFDocument, font: PDFFont, bold: PDFFont, qr: PDFImage, logo: PDFImage | null, snapshot: InvoiceSnapshot, widthMm: number): Promise<Uint8Array> {
  if (!Number.isFinite(widthMm) || widthMm < 58 || widthMm > 100) throw new Error("El ancho de rollo debe estar entre 58 y 100 mm.");
  const width = widthMm * 72 / 25.4, margin = 10, contentWidth = width - margin * 2;
  type Row = { text?: string; strong?: boolean; center?: boolean; size?: number; gap: number; qr?: boolean; logo?: boolean; rule?: boolean };
  const rows: Row[] = [];
  const add = (value: string, strong = false, size = 8, center = false) => {
    for (const part of wrapByWidth(value, strong ? bold : font, size, contentWidth)) rows.push({ text: part, strong, size, center, gap: size + 4 });
  };
  const rule = () => rows.push({ rule: true, gap: 8 });
  const logoWidth = Math.min(118, contentWidth), logoHeight = logo ? logoWidth * logo.height / logo.width : 0;
  if (logo) rows.push({ logo: true, gap: logoHeight + 5 });
  add(snapshot.razonSocial, true, 9, true);
  add(snapshot.codigoSucursal === 0 ? "CASA MATRIZ" : `SUCURSAL Nro ${snapshot.codigoSucursal}`, true, 8, true);
  add(`Nro de Punto de Venta ${snapshot.codigoPuntoVenta ?? 0}`, false, 8, true);
  add(snapshot.direccion, false, 8, true);
  if (snapshot.telefono) add(`Teléfono: ${snapshot.telefono}`, false, 8, true);
  add(snapshot.municipio, false, 8, true);
  rule(); add(`NIT: ${snapshot.nit}`, true); add(`FACTURA N°: ${snapshot.numeroFactura}`, true); add(`COD. AUTORIZACIÓN: ${snapshot.cuf}`);
  rule(); add("FACTURA", true, 10, true); add("(Con derecho a Crédito Fiscal)", false, 8, true);
  add(`Fecha: ${formatDate(snapshot.fechaEmision)}`);
  add(`Nombre/Razón Social: ${snapshot.cliente.nombreRazonSocial ?? "S/N"}`);
  add(`NIT/CI/CEX: ${snapshot.cliente.numeroDocumento}${snapshot.cliente.complemento ? `-${snapshot.cliente.complemento}` : ""}`);
  add(`Cod. Cliente: ${snapshot.cliente.codigoCliente}`); add(`Método de pago SIN: ${snapshot.pago.codigoMetodoPago}`); rule();
  for (const item of snapshot.detalle) {
    add(`${item.codigoProducto} - ${item.descripcion}`, true);
    if (item.numeroSerie) add(`Serie: ${item.numeroSerie}`);
    if (item.numeroImei) add(`IMEI: ${item.numeroImei}`);
    add(`Cantidad: ${quantity(item.cantidad)}  Unidad: ${item.unidadDescripcion || item.unidadMedidaSin}`);
    add(`Precio unitario: Bs ${money(item.precioUnitario)}  Descuento: Bs ${money(item.descuento)}`);
    add(`SUB TOTAL: Bs ${money(item.subtotal)}`, true); rule();
  }
  const subtotal = snapshot.detalle.reduce((sum, item) => sum.plus(item.subtotal), new Decimal(0));
  add(`Son: ${amountInWords(snapshot.totales.montoTotal)}`);
  add(`SUB-TOTAL Bs.- ${subtotal.toFixed(2)}`); add(`DESCUENTO Bs.- ${money(snapshot.totales.descuentoAdicional)}`);
  add(`TOTAL Bs.- ${money(snapshot.totales.montoTotal)}`, true);
  if (new Decimal(snapshot.totales.montoGiftCard || 0).gt(0)) add(`MONTO GIFT CARD Bs.- ${money(snapshot.totales.montoGiftCard)}`);
  add(snapshot.pago.codigoMoneda === 1 ? `MONTO A PAGAR Bs.- ${money(snapshot.totales.montoTotalMoneda)}` : `TOTAL MONEDA CÓD. ${snapshot.pago.codigoMoneda}: ${money(snapshot.totales.montoTotalMoneda)}`, true);
  add(`IMPORTE BASE CRÉDITO FISCAL Bs.- ${money(snapshot.totales.montoTotalSujetoIva)}`, true); rule();
  add("ESTA FACTURA CONTRIBUYE AL DESARROLLO DEL PAÍS, EL USO ILÍCITO SERÁ SANCIONADO PENALMENTE DE ACUERDO A LEY", false, 7, true);
  add(snapshot.leyenda, false, 7, true);
  add("Este documento es la Representación Gráfica de un Documento Fiscal Digital emitido en una modalidad de facturación en línea.", false, 7, true);
  rows.push({ qr: true, gap: 94 }); add(`Usuario: ${snapshot.usuario}`, false, 7);
  const groups: Row[][] = [[]]; let height = margin * 2;
  for (const row of rows) {
    if (height + row.gap > 14000) { groups.push([]); height = margin * 2; }
    groups[groups.length - 1].push(row); height += row.gap;
  }
  for (const group of groups) {
    const pageHeight = margin * 2 + group.reduce((sum, row) => sum + row.gap, 0);
    const page = doc.addPage([width, pageHeight]); let y = pageHeight - margin;
    for (const row of group) {
      if (row.qr) page.drawImage(qr, { x: (width - 87) / 2, y: y - 87, width: 87, height: 87 });
      else if (row.logo && logo) page.drawImage(logo, { x: (width - logoWidth) / 2, y: y - logoHeight, width: logoWidth, height: logoHeight });
      else if (row.rule) page.drawLine({ start: { x: margin, y: y - 3 }, end: { x: width - margin, y: y - 3 }, thickness: 0.5, color: BORDER });
      else if (row.text) {
        const face = row.strong ? bold : font, size = row.size ?? 8;
        const x = row.center ? (width - face.widthOfTextAtSize(row.text, size)) / 2 : margin;
        page.drawText(row.text, { x, y: y - size, size, font: face, color: BLACK });
      }
      y -= row.gap;
    }
  }
  return doc.save();
}

import { Decimal } from "decimal.js";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import QRCode from "qrcode";
import type { InvoiceSnapshot } from "./types.ts";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 36;
const TEXT = rgb(0.08, 0.12, 0.2);
const MUTED = rgb(0.32, 0.37, 0.45);
const LINE = rgb(0.76, 0.79, 0.83);
const LIGHT = rgb(0.95, 0.96, 0.98);

const wrapByWidth = (text: string, font: PDFFont, size: number, maxWidth: number) => {
  const words = String(text).trim().split(/\s+/).filter(Boolean).flatMap((word) => {
    if (font.widthOfTextAtSize(word, size) <= maxWidth) return [word];
    const chunks: string[] = [];
    let chunk = "";
    for (const character of word) {
      if (font.widthOfTextAtSize(chunk + character, size) > maxWidth && chunk) { chunks.push(chunk); chunk = character; }
      else chunk += character;
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  });
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) current = candidate;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
};

const formatDate = (value: string) => new Intl.DateTimeFormat("es-BO", {
  timeZone: "America/La_Paz",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
}).format(new Date(value));

const money = (value: string | null | undefined) => new Decimal(value || 0).toFixed(2);

export async function generateFiscalPdf(snapshot: InvoiceSnapshot, qrContent: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const qrDataUrl = await QRCode.toDataURL(qrContent, { errorCorrectionLevel: "M", margin: 1, width: 320 });
  const qr = await doc.embedPng(Uint8Array.from(atob(qrDataUrl.split(",")[1]), (char) => char.charCodeAt(0)));

  let page!: PDFPage;
  let y = 0;
  const addPage = () => {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  };
  addPage();

  const text = (value: string, x: number, currentY: number, size = 8, strong = false, color = TEXT) => {
    page.drawText(value, { x, y: currentY, size, font: strong ? bold : font, color });
  };
  const paragraph = (value: string, x: number, maxWidth: number, size = 8, strong = false, gap = 3) => {
    for (const line of wrapByWidth(value, strong ? bold : font, size, maxWidth)) {
      text(line, x, y, size, strong);
      y -= size + gap;
    }
  };
  const horizontal = (currentY: number, startX = MARGIN, endX = PAGE_WIDTH - MARGIN) => {
    page.drawLine({ start: { x: startX, y: currentY }, end: { x: endX, y: currentY }, thickness: 0.6, color: LINE });
  };

  text(snapshot.razonSocial.toUpperCase(), MARGIN, y, 14, true);
  y -= 17;
  paragraph(`SUCURSAL N. ${snapshot.codigoSucursal}${snapshot.codigoPuntoVenta == null ? "" : ` - PUNTO DE VENTA N. ${snapshot.codigoPuntoVenta}`}`, MARGIN, 285, 8, true);
  paragraph(snapshot.direccion.toUpperCase(), MARGIN, 285, 8);
  paragraph(`${snapshot.municipio.toUpperCase()}${snapshot.telefono ? ` - TEL. ${snapshot.telefono}` : ""}`, MARGIN, 285, 8);

  const fiscalX = 355;
  text(`NIT: ${snapshot.nit}`, fiscalX, PAGE_HEIGHT - MARGIN, 10, true);
  text(`FACTURA N.: ${snapshot.numeroFactura}`, fiscalX, PAGE_HEIGHT - MARGIN - 17, 10, true);
  text("CÓD. AUTORIZACIÓN:", fiscalX, PAGE_HEIGHT - MARGIN - 34, 8, true);
  wrapByWidth(snapshot.cuf, bold, 7, 200).forEach((line, index) => text(line, fiscalX, PAGE_HEIGHT - MARGIN - 47 - (index * 10), 7, true));

  y = Math.min(y, PAGE_HEIGHT - 130);
  horizontal(y);
  y -= 22;
  const invoiceTitle = "FACTURA";
  text(invoiceTitle, (PAGE_WIDTH - bold.widthOfTextAtSize(invoiceTitle, 16)) / 2, y, 16, true);
  y -= 16;
  const creditTitle = "(Con Derecho a Crédito Fiscal)";
  text(creditTitle, (PAGE_WIDTH - font.widthOfTextAtSize(creditTitle, 9)) / 2, y, 9);
  y -= 20;

  text(`Fecha: ${formatDate(snapshot.fechaEmision)}`, MARGIN, y, 8, true);
  text(`NIT/CI/CEX: ${snapshot.cliente.numeroDocumento}${snapshot.cliente.complemento ? `-${snapshot.cliente.complemento}` : ""}`, 325, y, 8, true);
  y -= 14;
  paragraph(`Nombre/Razón Social: ${snapshot.cliente.nombreRazonSocial ?? "S/N"}`, MARGIN, 320, 8, true);
  text(`Cod. Cliente: ${snapshot.cliente.codigoCliente}`, 325, y + 11, 8, true);
  y -= 4;

  const columns = [
    { label: "CÓDIGO", x: 38 },
    { label: "CANT.", x: 102 },
    { label: "UNIDAD", x: 147 },
    { label: "DESCRIPCIÓN", x: 194 },
    { label: "P. UNIT.", x: 364 },
    { label: "DESCUENTO", x: 424 },
    { label: "SUBTOTAL", x: 488 },
  ];
  const tableHeader = () => {
    page.drawRectangle({ x: MARGIN, y: y - 16, width: PAGE_WIDTH - (MARGIN * 2), height: 18, color: LIGHT });
    columns.forEach((column) => text(column.label, column.x, y - 10, 6.2, true));
    y -= 19;
    horizontal(y);
    y -= 5;
  };
  tableHeader();

  snapshot.detalle.forEach((line) => {
    const description = wrapByWidth(line.descripcion, font, 7, 162);
    const rowHeight = Math.max(19, description.length * 9 + 7);
    if (y - rowHeight < 185) { addPage(); tableHeader(); }
    text(line.codigoProducto, columns[0].x, y - 9, 7);
    text(line.cantidad, columns[1].x, y - 9, 7);
    text(line.unidadMedidaSin, columns[2].x, y - 9, 7);
    description.forEach((part, index) => text(part, columns[3].x, y - 9 - (index * 9), 7));
    text(money(line.precioUnitario), columns[4].x, y - 9, 7);
    text(money(line.descuento), columns[5].x, y - 9, 7);
    text(money(line.subtotal), columns[6].x, y - 9, 7);
    y -= rowHeight;
    horizontal(y);
  });

  if (y < 245) addPage();
  y -= 12;
  const totalsX = 355;
  const valuesX = 500;
  const detailSubtotal = snapshot.detalle.reduce((sum, item) => sum.plus(item.subtotal), new Decimal(0));
  const additionalDiscount = new Decimal(snapshot.totales.descuentoAdicional || 0);
  const totalRows = [
    ["SUBTOTAL Bs", detailSubtotal.plus(additionalDiscount).toFixed(2)],
    ["DESCUENTO ADICIONAL Bs", additionalDiscount.toFixed(2)],
    ["TOTAL Bs", money(snapshot.totales.montoTotal)],
    ["MONTO GIFT CARD Bs", money(snapshot.totales.montoGiftCard)],
    ["MONTO A PAGAR Bs", money(snapshot.totales.montoTotalMoneda)],
    ["IMPORTE BASE CRÉDITO FISCAL", money(snapshot.totales.montoTotalSujetoIva)],
  ];
  totalRows.forEach(([label, value], index) => {
    const strong = index >= 2;
    text(label, totalsX, y, 8, strong);
    text(value, valuesX, y, 8, strong);
    y -= 14;
  });
  y -= 7;
  paragraph("ESTA FACTURA CONTRIBUYE AL DESARROLLO DEL PAÍS, EL USO ILÍCITO SERÁ SANCIONADO PENALMENTE DE ACUERDO A LEY", MARGIN, 365, 7, true, 2);
  paragraph(snapshot.leyenda, MARGIN, 365, 7, false, 2);

  const qrSize = 92;
  const qrY = Math.max(46, y - qrSize - 3);
  page.drawImage(qr, { x: PAGE_WIDTH - MARGIN - qrSize, y: qrY, width: qrSize, height: qrSize });
  text("QR de consulta SIN", PAGE_WIDTH - MARGIN - qrSize, qrY - 10, 6, false, MUTED);
  y = Math.min(y - 8, qrY + 20);
  paragraph(`CUF: ${snapshot.cuf}`, MARGIN, 365, 6.5, false, 2);
  paragraph("Este documento es la Representación Gráfica de un Documento Fiscal Digital emitido en una modalidad de facturación en línea", MARGIN, 365, 7, true, 2);
  paragraph("(Factura Compra Venta)", MARGIN, 365, 7, false, 2);

  const pages = doc.getPages();
  pages.forEach((currentPage, index) => {
    const label = `${index + 1}/${pages.length}`;
    currentPage.drawText(label, { x: (PAGE_WIDTH - font.widthOfTextAtSize(label, 7)) / 2, y: 20, size: 7, font, color: MUTED });
  });
  return doc.save();
}

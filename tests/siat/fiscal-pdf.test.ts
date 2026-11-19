import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { amountInWords, generateFiscalPdf } from "../../supabase/functions/_shared/siat/fiscal-pdf.ts";
import { generateInvoiceXml } from "../../supabase/functions/_shared/siat/invoice-xml.ts";
import { originalSignedXml, snapshotFromSignedXml } from "../../supabase/functions/_shared/siat/fiscal-document.ts";
import { assertFiscalDocumentAccess } from "../../supabase/functions/_shared/siat/document-access.ts";
import { gzipBytes, sha256Hex } from "../../supabase/functions/_shared/siat/encoding.ts";
import { officialQrUrl } from "../../supabase/functions/_shared/siat/qr.ts";
import { PDFDocument } from "pdf-lib";
import type { InvoiceSnapshot } from "../../supabase/functions/_shared/siat/types.ts";

const snapshot: InvoiceSnapshot = {
  id: "preview",
  correlationId: "preview-correlation",
  nit: "123456789",
  razonSocial: "Nauvoo Importadores S.R.L.",
  municipio: "La Paz",
  telefono: "22110000",
  numeroFactura: "184",
  cuf: "8727F63A15F8976591FDDE5B387C5D015A29E06A1A19E23EF34124CD",
  cufd: "CUFD-PRUEBAS",
  codigoSucursal: 0,
  direccion: "Av. de prueba N. 123, Zona Central",
  codigoPuntoVenta: 0,
  fechaEmision: "2026-09-17T15:10:00-04:00",
  modalidad: "COMPUTARIZADA",
  documentoSector: 1,
  tipoFactura: 1,
  cliente: {
    nombreRazonSocial: "Cliente de prueba S.R.L.",
    codigoTipoDocumentoIdentidad: 5,
    numeroDocumento: "987654321",
    complemento: null,
    codigoCliente: "CLI-001",
  },
  pago: { codigoMetodoPago: 1, numeroTarjeta: null, codigoMoneda: 1, tipoCambio: "1" },
  totales: {
    montoTotal: "7050.00",
    montoTotalSujetoIva: "7050.00",
    montoTotalMoneda: "7050.00",
    montoGiftCard: "0",
    descuentoAdicional: "0",
  },
  leyenda: "Ley N. 453: El proveedor debe brindar atención sin discriminación, con respeto, calidez y cordialidad a los usuarios y consumidores.",
  usuario: "administrador",
  detalle: [
    { actividadEconomica: "465100", codigoProductoSin: "99100", codigoProducto: "P001", descripcion: "Laptop Lenovo ThinkPad E14", cantidad: "1", unidadMedidaSin: "58", precioUnitario: "6500", descuento: "0", subtotal: "6500" },
    { actividadEconomica: "465100", codigoProductoSin: "99100", codigoProducto: "A002", descripcion: "Mouse inalámbrico Logitech", cantidad: "2", unidadMedidaSin: "58", precioUnitario: "150", descuento: "0", subtotal: "300" },
    { actividadEconomica: "620100", codigoProductoSin: "99100", codigoProducto: "S001", descripcion: "Servicio de instalación y configuración", cantidad: "1", unidadMedidaSin: "62", precioUnitario: "250", descuento: "0", subtotal: "250" },
  ],
};

describe("representación gráfica fiscal", () => {
  it.each([
    ["0.01", "CERO CON 01/100 BOLIVIANOS"], ["5", "CINCO CON 00/100 BOLIVIANOS"],
    ["21.35", "VEINTIÚN CON 35/100 BOLIVIANOS"], ["100", "CIEN CON 00/100 BOLIVIANOS"],
    ["1001", "MIL UN CON 00/100 BOLIVIANOS"], ["1000001", "UN MILLÓN UN CON 00/100 BOLIVIANOS"],
  ])("expresa %s bolivianos correctamente en letras", (amount, expected) => {
    expect(amountInWords(amount)).toBe(expected);
  });
  it("genera un PDF válido con el QR oficial", async () => {
    const pdf = await generateFiscalPdf(snapshot, `https://pilotosiat.impuestos.gob.bo/consulta/QR?nit=${snapshot.nit}&cuf=${snapshot.cuf}&numero=${snapshot.numeroFactura}&t=2`);
    expect(new TextDecoder().decode(pdf.slice(0, 4))).toBe("%PDF");
    expect(pdf.byteLength).toBeGreaterThan(10_000);
    if (process.env.SIAT_WRITE_PDF_PREVIEW === "1") {
      mkdirSync("tmp/pdfs", { recursive: true });
      writeFileSync("tmp/pdfs/factura-fiscal-preview.pdf", pdf);
    }
  });
  it("genera carta y rollo configurables con las medidas correctas", async () => {
    const qr = officialQrUrl("PRUEBAS", snapshot.nit, snapshot.cuf, snapshot.numeroFactura);
    const logoBytes = new Uint8Array(readFileSync(new URL("../../src/assets/logo.png", import.meta.url)));
    const cartaBytes = await generateFiscalPdf(snapshot, qr, { logoBytes });
    const rolloBytes = await generateFiscalPdf(snapshot, qr, { format: "rollo", widthMm: 80, logoBytes });
    const narrowBytes = await generateFiscalPdf(snapshot, qr, { format: "rollo", widthMm: 58, logoBytes });
    const carta = await PDFDocument.load(cartaBytes);
    const rollo = await PDFDocument.load(rolloBytes);
    const narrow = await PDFDocument.load(narrowBytes);
    expect(carta.getPage(0).getSize()).toEqual({ width: 612, height: 792 });
    expect(rollo.getPage(0).getWidth()).toBeCloseTo(80 * 72 / 25.4, 4);
    expect(narrow.getPage(0).getWidth()).toBeCloseTo(58 * 72 / 25.4, 4);
    if (process.env.SIAT_WRITE_PDF_PREVIEW === "1") {
      mkdirSync("tmp/pdfs", { recursive: true });
      writeFileSync("tmp/pdfs/factura-carta-prueba.pdf", cartaBytes);
      writeFileSync("tmp/pdfs/factura-rollo-80-prueba.pdf", rolloBytes);
      writeFileSync("tmp/pdfs/factura-rollo-58-prueba.pdf", narrowBytes);
    }
    await expect(generateFiscalPdf(snapshot, qr, { format: "rollo", widthMm: 40 })).rejects.toThrow("ancho");
  });
  it("pagina detalles extensos sin omitir la tabla ni el cierre", async () => {
    const detail = Array.from({ length: 48 }, (_, index) => ({
      ...snapshot.detalle[0], codigoProducto: `COD-${index}`, descripcion: `Detalle ${index} ${"descripción extensa ".repeat(6)}`,
    }));
    const long = { ...snapshot, detalle: detail, totales: { ...snapshot.totales, montoTotal: "312000.00", montoTotalMoneda: "312000.00", montoTotalSujetoIva: "312000.00" } };
    const qr = officialQrUrl("PRUEBAS", long.nit, long.cuf, long.numeroFactura);
    const bytes = await generateFiscalPdf(long, qr);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
    if (process.env.SIAT_WRITE_PDF_PREVIEW === "1") writeFileSync("tmp/pdfs/factura-extensa-prueba.pdf", bytes);
  });
  it("recupera los bytes originales firmados y construye la representación con precios históricos", async () => {
    const xml = generateInvoiceXml({ ...snapshot, modalidad: "ELECTRONICA" }).replace("</facturaElectronicaCompraVenta>", '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignatureValue>TEST</ds:SignatureValue></ds:Signature></facturaElectronicaCompraVenta>');
    const original = new TextEncoder().encode(xml);
    const compressed = await gzipBytes(original);
    const expected = { id: snapshot.id, ambiente: "PRUEBAS", estadoFiscal: "VALIDADA", codigoEstado: 908, transaccion: true, codigoRecepcion: "RECEPCION_TEST", cuf: snapshot.cuf, numeroFactura: snapshot.numeroFactura, cliente: snapshot.cliente.nombreRazonSocial!, documento: snapshot.cliente.numeroDocumento, sucursal: "0", puntoVenta: "0", total: 7050, fechaEmision: snapshot.fechaEmision, xmlHash: await sha256Hex(compressed), xmlFirmado: true };
    const bytes = await originalSignedXml(compressed, expected.xmlHash);
    expect(bytes).toEqual(original);
    const fiscal = snapshotFromSignedXml(bytes, expected);
    expect(fiscal.detalle[0]).toMatchObject({ precioUnitario: "6500.00", subtotal: "6500.00" });
    expect(fiscal.cliente.numeroDocumento).toBe(snapshot.cliente.numeroDocumento);
    await expect(originalSignedXml(compressed, "A".repeat(64))).rejects.toThrow("hash");
    expect(() => snapshotFromSignedXml(bytes, { ...expected, cuf: "OTRO" })).toThrow("no coincide");
    expect(() => snapshotFromSignedXml(bytes, { ...expected, total: 1 })).toThrow("no coincide");
    expect(() => snapshotFromSignedXml(bytes, { ...expected, estadoFiscal: "SIN_RESPUESTA" })).toThrow("validada");
  });
  it("limita la entrega al administrador y a documentos validados", () => {
    const invoice = { ambiente: "PRUEBAS", estado_fiscal: "VALIDADA", codigo_estado: 908, transaccion: true, codigo_recepcion: "TEST", cuf: "CUF", numero_factura: 2, xml_firmado: true, xml_hash: "hash", xml_storage_path: "private" };
    expect(() => assertFiscalDocumentAccess("administrador", invoice)).not.toThrow();
    expect(() => assertFiscalDocumentAccess("vendedor", invoice)).toThrow("administración");
    expect(() => assertFiscalDocumentAccess("administrador", { ...invoice, codigo_estado: 902 })).toThrow("validado");
    expect(() => assertFiscalDocumentAccess("administrador", { ...invoice, ambiente: "PRODUCCION" })).toThrow("validado");
  });
  it("usa el QR piloto oficial para carta y rollo y mantiene bloqueada la ruta productiva", () => {
    expect(officialQrUrl("PRUEBAS", snapshot.nit, snapshot.cuf, snapshot.numeroFactura, 1)).toBe(`https://pilotosiat.impuestos.gob.bo/consulta/QR?nit=${snapshot.nit}&cuf=${snapshot.cuf}&numero=${snapshot.numeroFactura}&t=1`);
    expect(() => officialQrUrl("PRODUCCION", snapshot.nit, snapshot.cuf, snapshot.numeroFactura)).toThrow();
  });
});

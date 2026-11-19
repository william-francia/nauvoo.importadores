import { beforeEach, describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import { gzipBytes, sha256Hex } from "../../supabase/functions/_shared/siat/encoding.ts";
import { generateInvoiceXml } from "../../supabase/functions/_shared/siat/invoice-xml.ts";
import type { InvoiceSnapshot } from "../../supabase/functions/_shared/siat/types.ts";
import type { FacturaSiatDetalle } from "../../src/features/facturas/types/siat.types";

const mocks = vi.hoisted(() => ({ download: vi.fn(), units: vi.fn() }));
vi.mock("../../src/features/facturas/services/siat.gateway.service", () => ({ obtenerXmlFiscalComprimido: mocks.download }));
vi.mock("../../src/features/facturas/services/siat.service", () => ({ listarUnidadesFacturaSiat: mocks.units }));
import { prepararDocumentoFiscal } from "../../src/features/facturas/services/documentos-fiscales.service";

const snapshot: InvoiceSnapshot = {
  id: "test-invoice", correlationId: "test", nit: "123456789", razonSocial: "Empresa de prueba", municipio: "La Paz", telefono: null,
  numeroFactura: "42", cuf: "CUFDEPRUEBA", cufd: "CUFDTEST", codigoSucursal: 0, codigoPuntoVenta: 0,
  direccion: "Calle de prueba", fechaEmision: "2026-10-29T15:00:00-04:00", modalidad: "ELECTRONICA", documentoSector: 1, tipoFactura: 1,
  cliente: { nombreRazonSocial: "Cliente de prueba", codigoTipoDocumentoIdentidad: 1, numeroDocumento: "1234567", complemento: null, codigoCliente: "C-1" },
  pago: { codigoMetodoPago: 1, numeroTarjeta: null, codigoMoneda: 1, tipoCambio: "1" },
  totales: { montoTotal: "10", montoTotalSujetoIva: "10", montoTotalMoneda: "10", descuentoAdicional: "0", montoGiftCard: null },
  leyenda: "Leyenda de prueba", usuario: "Prueba",
  detalle: [{ actividadEconomica: "123456", codigoProductoSin: "1234", codigoProducto: "A1", descripcion: "Artículo de prueba", cantidad: "2", unidadMedidaSin: "47", precioUnitario: "5", descuento: null, subtotal: "10" }],
};

async function fixture() {
  const xml = generateInvoiceXml(snapshot).replace("</facturaElectronicaCompraVenta>", '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignatureValue>TEST</ds:SignatureValue></ds:Signature></facturaElectronicaCompraVenta>');
  const original = new TextEncoder().encode(xml);
  const gzip = await gzipBytes(original);
  const invoice = { id: snapshot.id, ambiente: "PRUEBAS", estadoFiscal: "VALIDADA", codigoEstado: 908, transaccion: true,
    codigoRecepcion: "RECEPCION-TEST", cuf: snapshot.cuf, numeroFactura: snapshot.numeroFactura, cliente: snapshot.cliente.nombreRazonSocial,
    documento: snapshot.cliente.numeroDocumento, total: 10, fechaEmision: snapshot.fechaEmision, sucursal: "0", puntoVenta: "0",
    xmlHash: await sha256Hex(gzip), xmlFirmado: true } as FacturaSiatDetalle;
  mocks.download.mockResolvedValue(gzip);
  mocks.units.mockResolvedValue([{ codigo: "47", descripcion: "PIEZAS" }]);
  return { invoice, original };
}

beforeEach(() => vi.clearAllMocks());

describe("entrega de documentos fiscales", () => {
  it("entrega los bytes exactos del XML recibido y construye el enlace oficial", async () => {
    const { invoice, original } = await fixture();
    const xml = await prepararDocumentoFiscal(invoice, "XML");
    expect(xml.bytes).toEqual(original);
    expect(xml.filename).toBe("factura-42.xml");
    const link = await prepararDocumentoFiscal(invoice, "CONSULTA");
    expect(link.url).toBe("https://pilotosiat.impuestos.gob.bo/consulta/QR?nit=123456789&cuf=CUFDEPRUEBA&numero=42&t=2");
    expect(mocks.units).not.toHaveBeenCalled();
  });

  it("genera carta y rollo a partir del documento firmado y de las unidades oficiales", async () => {
    const { invoice } = await fixture();
    const carta = await prepararDocumentoFiscal(invoice, "PDF_CARTA");
    const rollo = await prepararDocumentoFiscal(invoice, "PDF_ROLLO", 58);
    expect((await PDFDocument.load(carta.bytes!)).getPage(0).getWidth()).toBe(612);
    expect((await PDFDocument.load(rollo.bytes!)).getPage(0).getWidth()).toBeCloseTo(58 * 72 / 25.4, 4);
    expect(mocks.units).toHaveBeenCalledTimes(2);
  });

  it("rechaza el archivo si su hash o la identidad persistida no coinciden", async () => {
    const { invoice } = await fixture();
    await expect(prepararDocumentoFiscal({ ...invoice, xmlHash: "A".repeat(64) }, "XML")).rejects.toThrow("hash");
    await expect(prepararDocumentoFiscal({ ...invoice, cuf: "OTRO" }, "PDF_CARTA")).rejects.toThrow("no coincide");
    await expect(prepararDocumentoFiscal({ ...invoice, estadoFiscal: "SIN_RESPUESTA" }, "XML")).rejects.toThrow("validada");
  });
});

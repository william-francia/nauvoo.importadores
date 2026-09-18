import { generateKeyPairSync } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cufNumericBase, decimalToHex, generateCuf, modulo11 } from "../../supabase/functions/_shared/siat/cuf.ts";
import { gzipBytes, sha256Hex } from "../../supabase/functions/_shared/siat/encoding.ts";
import { generateInvoiceXml } from "../../supabase/functions/_shared/siat/invoice-xml.ts";
import { formatMoney, invoiceTotal, lineSubtotal, maskCard } from "../../supabase/functions/_shared/siat/money.ts";
import { officialQrUrl } from "../../supabase/functions/_shared/siat/qr.ts";
import type { InvoiceSnapshot } from "../../supabase/functions/_shared/siat/types.ts";
import { signInvoiceXml, verifyInvoiceSignature } from "../../supabase/functions/_shared/siat/xmldsig.ts";
import { validateElectronicInvoiceXml, validateXmlAgainstXsd } from "../../supabase/functions/_shared/siat/xsd.ts";

const artifacts = new URL("../../supabase/functions/_shared/siat/artifacts/SIAT_VIGENTE/", import.meta.url);
const fixture = (modality: "COMPUTARIZADA" | "ELECTRONICA" = "COMPUTARIZADA"): InvoiceSnapshot => ({
  id: "00000000-0000-4000-8000-000000000001", correlationId: "00000000-0000-4000-8000-000000000002",
  nit: "123456789", razonSocial: "Nauvoo Importadores", municipio: "La Paz", telefono: "22110000",
  numeroFactura: "1", cuf: "8727F63A15F8976591FDDE5B387C5D015A29E06A1A19E23EF34124CD",
  cufd: "BQUE-QWERTY", codigoSucursal: 0, direccion: "Av. Principal 123", codigoPuntoVenta: 0,
  fechaEmision: "2019-01-13T20:37:21.231Z", modalidad: modality, documentoSector: 1, tipoFactura: 1,
  cliente: { nombreRazonSocial: "Cliente Prueba", codigoTipoDocumentoIdentidad: 1, numeroDocumento: "5115889", complemento: null, codigoCliente: "CLI-1" },
  pago: { codigoMetodoPago: 1, numeroTarjeta: null, codigoMoneda: 1, tipoCambio: "1" },
  totales: { montoTotal: "99", montoTotalSujetoIva: "99", montoTotalMoneda: "99", descuentoAdicional: "1" },
  leyenda: "Ley N° 453: el proveedor debe brindar información clara.", usuario: "pruebas",
  detalle: [{ actividadEconomica: "451010", codigoProductoSin: "49111", codigoProducto: "P-1", descripcion: "Producto de prueba", cantidad: "1", unidadMedidaSin: "1", precioUnitario: "100", descuento: "0", subtotal: "100", numeroSerie: null, numeroImei: null }],
});

describe("dinero decimal", () => {
  it("redondea sin errores binarios y centraliza totales", () => {
    expect(formatMoney("10.005")).toBe("10.01");
    expect(lineSubtotal("0.1", "0.2").toFixed(2)).toBe("0.02");
    expect(invoiceTotal([{ quantity: "3", price: "33.3333", discount: "0" }], "0").toFixed(2)).toBe("100.00");
    expect(maskCard("4111111111111234")).toBe("4111000000001234");
  });
});

describe("CUF oficial", () => {
  const input = { nit: "123456789", fechaEmision: "2019-01-13T20:37:21.231Z", codigoSucursal: 0, modalidad: 1 as const, tipoEmision: 1 as const, tipoFactura: 1, documentoSector: 1, numeroFactura: 1, codigoPuntoVenta: 0 };
  it("aplica módulo 11, base 16 y el vector oficial", () => {
    const base = cufNumericBase(input);
    expect(base).toHaveLength(53);
    expect(decimalToHex(`${base}${modulo11(base)}`)).toBe("8727F63A15F8976591FDDE5B387C5D015A29E06A1");
    expect(generateCuf({ ...input, codigoControl: "A19E23EF34124CD" })).toBe("8727F63A15F8976591FDDE5B387C5D015A29E06A1A19E23EF34124CD");
  });
});

describe("documento fiscal", () => {
  it("genera XML ordenado y lo valida contra el XSD oficial", () => {
    const xml = generateInvoiceXml(fixture());
    const xsd = readFileSync(new URL("facturaComputarizadaCompraVenta.xsd", artifacts), "utf8");
    expect(validateXmlAgainstXsd(xml, xsd)).toBe(true);
    expect(() => validateXmlAgainstXsd(xml.replace("<montoTotal>99.00</montoTotal>", "<montoTotal>-1</montoTotal>"), xsd)).toThrow(/XML inválido/);
  });

  it("firma con RSA-SHA256, verifica XMLDSig y SignatureSchema", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    const signed = signInvoiceXml(generateInvoiceXml(fixture("ELECTRONICA")), privateKey, publicKey);
    expect(verifyInvoiceSignature(signed, publicKey)).toBe(true);
    const xsd = readFileSync(new URL("facturaElectronicaCompraVenta.xsd", artifacts), "utf8");
    const signature = readFileSync(new URL("SignatureSchema.xsd", artifacts), "utf8");
    expect(validateElectronicInvoiceXml(signed, xsd, signature)).toBe(true);
  });

  it("comprime los bytes definitivos y calcula SHA-256", async () => {
    const xml = generateInvoiceXml(fixture()); const gzip = await gzipBytes(xml);
    expect(gunzipSync(gzip).toString("utf8")).toBe(xml);
    expect(await sha256Hex(gzip)).toMatch(/^[A-F0-9]{64}$/);
  });

  it("genera la URL QR oficial del ambiente piloto", () => {
    expect(officialQrUrl("PRUEBAS", "123", "ABC", "7")).toBe("https://pilotosiat.impuestos.gob.bo/consulta/QR?nit=123&cuf=ABC&numero=7&t=2");
    expect(() => officialQrUrl("PRODUCCION", "123", "ABC", "7")).toThrow(/PENDIENTE_DE_VERIFICACION_OFICIAL/);
  });
});

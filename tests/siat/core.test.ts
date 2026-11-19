import { createHash, KeyObject, X509Certificate } from "node:crypto";
import { execFileSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cufNumericBase, decimalToHex, generateCuf, modulo11 } from "../../supabase/functions/_shared/siat/cuf.ts";
import { gzipBytes, sha256Hex } from "../../supabase/functions/_shared/siat/encoding.ts";
import { generateInvoiceXml } from "../../supabase/functions/_shared/siat/invoice-xml.ts";
import { formatMoney, invoiceTotal, lineSubtotal, maskCard } from "../../supabase/functions/_shared/siat/money.ts";
import { officialQrUrl } from "../../supabase/functions/_shared/siat/qr.ts";
import type { InvoiceSnapshot } from "../../supabase/functions/_shared/siat/types.ts";
import { signInvoiceXml, validateInvoiceSignatureProfile, verifyInvoiceSignature } from "../../supabase/functions/_shared/siat/xmldsig.ts";
import { validateElectronicInvoiceXml, validateUnsignedElectronicInvoiceXml, validateXmlAgainstXsd } from "../../supabase/functions/_shared/siat/xsd.ts";
import { validateSignatureCredentials } from "../../supabase/functions/_shared/siat/signature-credentials.ts";
import { assertSignatureTestAdmin, testSignatureIsolated } from "../../supabase/functions/_shared/siat/signature-test.ts";
import { errorMessage } from "../../supabase/functions/_shared/siat/engine.ts";

const artifacts = new URL("../../supabase/functions/_shared/siat/artifacts/SIAT_VIGENTE/", import.meta.url);

function temporaryTestCertificate(addExtensions: string[] = []) {
  const candidates = [process.env.OPENSSL_BIN, "openssl", "C:\\Program Files\\Git\\usr\\bin\\openssl.exe", "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe"].filter((value): value is string => Boolean(value));
  const openssl = candidates.find((candidate) => {
    try { execFileSync(candidate, ["version"], { stdio: "ignore" }); return true; } catch { return false; }
  });
  if (!openssl) throw new Error("OpenSSL es necesario para generar el certificado X.509 efímero de pruebas.");
  const temporaryPrefix = join(tmpdir(), "siat-xmldsig-");
  const directory = mkdtempSync(temporaryPrefix);
  const privateKeyPath = join(directory, "private-key.pem");
  const certificatePath = join(directory, "certificate.pem");
  execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=SIAT Local Test", "-keyout", privateKeyPath, "-out", certificatePath, ...addExtensions.flatMap((item) => ["-addext", item])], { stdio: "ignore", env: { ...process.env, MSYS2_ARG_CONV_EXCL: "*" } });
  return {
    privateKey: readFileSync(privateKeyPath, "utf8"),
    certificate: readFileSync(certificatePath, "utf8"),
    dispose: () => {
      if (!directory.startsWith(temporaryPrefix)) throw new Error("Directorio temporal XMLDSig fuera del alcance permitido.");
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

const fixture = (modality: "COMPUTARIZADA" | "ELECTRONICA" = "COMPUTARIZADA"): InvoiceSnapshot => ({
  id: "00000000-0000-4000-8000-000000000001", correlationId: "00000000-0000-4000-8000-000000000002",
  nit: "123456789", razonSocial: "Nauvoo Importadores", municipio: "La Paz", telefono: "22110000",
  numeroFactura: "1", cuf: "8727F63A15F8976591FDDE5B387C5D015A29E06A1A19E23EF34124CD",
  cufd: "BQUE-QWERTY", codigoSucursal: 0, direccion: "Av. Principal 123", codigoPuntoVenta: 0,
  fechaEmision: "2019-01-13T20:37:21.231Z", modalidad: modality, documentoSector: 1, tipoFactura: 1,
  cliente: { nombreRazonSocial: "Cliente Prueba", codigoTipoDocumentoIdentidad: 1, numeroDocumento: "5115889", complemento: null, codigoCliente: "CLI-1" },
  pago: { codigoMetodoPago: 1, numeroTarjeta: null, codigoMoneda: 1, tipoCambio: "1" },
  totales: { montoTotal: "99", montoTotalSujetoIva: "99", montoTotalMoneda: "99", descuentoAdicional: "1" },
  leyenda: "Ley N° 453: Puedes acceder a la reclamación cuando tus derechos han sido vulnerados.", usuario: "pruebas",
  detalle: [{ actividadEconomica: "4752100", codigoProductoSin: "1001903", codigoProducto: "FIXTURE-1", descripcion: "herramientas de mano tales como alicates, destornilladores.", cantidad: "1", unidadMedidaSin: "47", precioUnitario: "100", descuento: "0", subtotal: "100", numeroSerie: null, numeroImei: null }],
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

  it("completa los campos fiscales del piloto sin usar un CUFD real", () => {
    const base = cufNumericBase({ nit: "1234567", fechaEmision: "2026-10-02T12:34:56.789-04:00", codigoSucursal: 0, modalidad: 1, tipoEmision: 1, tipoFactura: 1, documentoSector: 1, numeroFactura: 1, codigoPuntoVenta: 0 });
    expect(base).toBe("00000012345672026100212345678900001110100000000010000");
    expect(generateCuf({ nit: "1234567", fechaEmision: "2026-10-02T12:34:56.789-04:00", codigoSucursal: 0, modalidad: 1, tipoEmision: 1, tipoFactura: 1, documentoSector: 1, numeroFactura: 1, codigoPuntoVenta: 0, codigoControl: "CONTROLPRUEBA" })).toMatch(/CONTROLPRUEBA$/);
  });
});

describe("documento fiscal", () => {
  it("valida y verifica sin KeyObject.equals, X509Certificate.raw ni Buffer global de Node", () => {
    const credentials = temporaryTestCertificate();
    const equals = vi.spyOn(KeyObject.prototype, "equals").mockImplementation(() => { throw new Error("Not implemented"); });
    const raw = vi.spyOn(X509Certificate.prototype, "raw", "get").mockImplementation(() => { throw new Error("Not implemented"); });
    const bufferDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer");
    let verified: boolean;
    try {
      Reflect.deleteProperty(globalThis, "Buffer");
      validateSignatureCredentials(credentials.privateKey, credentials.certificate);
      // Node packages need their global; Deno supplies it separately in npm scope.
      if (bufferDescriptor) Object.defineProperty(globalThis, "Buffer", bufferDescriptor);
      const signed = signInvoiceXml(generateInvoiceXml(fixture("ELECTRONICA")), credentials.privateKey, credentials.certificate);
      verified = verifyInvoiceSignature(signed, credentials.certificate);
    } finally {
      if (bufferDescriptor) Object.defineProperty(globalThis, "Buffer", bufferDescriptor);
      equals.mockRestore(); raw.mockRestore(); credentials.dispose();
    }
    expect(verified).toBe(true);
  });

  it("valida PEM, vigencia, par RSA y exige revisión manual del NIT", () => {
    const first = temporaryTestCertificate(); const second = temporaryTestCertificate();
    try {
      expect(validateSignatureCredentials(first.privateKey, first.certificate).nit).toBe("NIT_VERIFICACION_MANUAL");
      expect(validateSignatureCredentials(first.privateKey.replaceAll("\n", "\r\n"), first.certificate.replaceAll("\n", "\r\n")).nit).toBe("NIT_VERIFICACION_MANUAL");
      expect(() => validateSignatureCredentials(undefined, undefined)).toThrow("FIRMA_DIGITAL_NO_CONFIGURADA");
      expect(() => validateSignatureCredentials("invalid", first.certificate)).toThrow("FIRMA_CLAVE_FORMATO_INVALIDO");
      expect(() => validateSignatureCredentials(first.privateKey, "invalid")).toThrow("FIRMA_CERTIFICADO_FORMATO_INVALIDO");
      expect(() => validateSignatureCredentials(first.privateKey.replaceAll("\n", "\\n"), first.certificate)).toThrow("FIRMA_CLAVE_SALTOS_LITERALES");
      expect(() => validateSignatureCredentials(first.privateKey, first.certificate.replaceAll("\n", "\\n"))).toThrow("FIRMA_CERTIFICADO_SALTOS_LITERALES");
      expect(() => validateSignatureCredentials(`"${first.privateKey}"`, first.certificate)).toThrow("FIRMA_CLAVE_FORMATO_INVALIDO");
      expect(() => validateSignatureCredentials(first.privateKey, `\uFEFF${first.certificate}`)).toThrow("FIRMA_CERTIFICADO_FORMATO_INVALIDO");
      expect(() => validateSignatureCredentials(first.privateKey.replace(/([A-Za-z0-9+/])/, "!"), first.certificate)).toThrow("FIRMA_CLAVE_FORMATO_INVALIDO");
      expect(() => validateSignatureCredentials(first.privateKey.replace(/(-----BEGIN PRIVATE KEY-----\n)[^\n]+/, "$1!!!"), first.certificate)).toThrow("FIRMA_CLAVE_IMPORTACION_FALLIDA");
      expect(() => validateSignatureCredentials(first.privateKey, first.certificate.replace(/(-----BEGIN CERTIFICATE-----\n)[^\n]+/, "$1!!!"))).toThrow("FIRMA_CERTIFICADO_IMPORTACION_FALLIDA");
      expect(() => validateSignatureCredentials(first.privateKey, second.certificate)).toThrow("FIRMA_CLAVE_NO_CORRESPONDE");
      expect(() => validateSignatureCredentials(first.privateKey, first.certificate, new Date("2000-01-01"))).toThrow("FIRMA_CERTIFICADO_NO_VIGENTE");
      expect(() => validateSignatureCredentials(first.privateKey, first.certificate, new Date("2100-01-01"))).toThrow("FIRMA_CERTIFICADO_NO_VIGENTE");
    } finally { first.dispose(); second.dispose(); }
  });

  it("aplica KeyUsage y señala EKU para revisión manual", () => {
    const invalidUse = temporaryTestCertificate(["keyUsage=critical,keyEncipherment"]);
    const extendedUse = temporaryTestCertificate(["keyUsage=critical,digitalSignature", "extendedKeyUsage=serverAuth"]);
    try {
      expect(() => validateSignatureCredentials(invalidUse.privateKey, invalidUse.certificate)).toThrow("FIRMA_USO_NO_PERMITIDO");
      expect(validateSignatureCredentials(extendedUse.privateKey, extendedUse.certificate).eku).toBe("EKU_VERIFICACION_MANUAL");
    } finally { invalidUse.dispose(); extendedUse.dispose(); }
  });

  it("rechaza KeyInfo ajeno y limita la prueba aislada a administradores sin red fiscal", async () => {
    const first = temporaryTestCertificate(); const second = temporaryTestCertificate();
    try {
      expect(() => assertSignatureTestAdmin("vendedor")).toThrow("FIRMA_ACCESO_DENEGADO");
      expect(() => assertSignatureTestAdmin("administrador")).not.toThrow();
      const readArtifact = vi.fn(async (name: string) => readFileSync(new URL(name, artifacts), "utf8"));
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      try {
        const result = await testSignatureIsolated(first.privateKey, first.certificate, readArtifact);
        expect(result).toMatchObject({ ok: true, firma: true, xsd: true, nit: "NIT_VERIFICACION_MANUAL" });
        expect(readArtifact).toHaveBeenCalledTimes(2);
        expect(fetchSpy).not.toHaveBeenCalled();
      } finally { fetchSpy.mockRestore(); }
      const signed = signInvoiceXml(generateInvoiceXml(fixture("ELECTRONICA")), first.privateKey, first.certificate);
      const otherBase64 = second.certificate.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s/g, "");
      const altered = signed.replace(/(<X509Certificate>)[\s\S]*?(<\/X509Certificate>)/, `$1${otherBase64}$2`);
      expect(() => verifyInvoiceSignature(altered, first.certificate)).toThrow("FIRMA_KEYINFO_NO_CORRESPONDE");
    } finally { first.dispose(); second.dispose(); }
  });

  it("el worker oculta material PEM en errores", () => {
    const message = errorMessage(new Error("falló -----BEGIN PRIVATE KEY-----\nsecreto\n-----END PRIVATE KEY-----"));
    expect(message).toContain("[REDACTED]");
    expect(message).not.toContain("secreto");
  });
  it("conserva los artefactos XSD oficiales registrados en el manifiesto", () => {
    const manifest = JSON.parse(readFileSync(new URL("MANIFEST.json", artifacts), "utf8")) as { artefactos: Array<{ nombre: string; sha256: string }> };
    for (const name of ["facturaElectronicaCompraVenta.xsd", "SignatureSchema.xsd"]) {
      const expected = manifest.artefactos.find((item) => item.nombre === name)?.sha256;
      const repositoryBytes = readFileSync(new URL(name, artifacts));
      const officialBytes = name === "SignatureSchema.xsd" && repositoryBytes.at(-1) === 0x0a ? repositoryBytes.subarray(0, -1) : repositoryBytes;
      const actual = createHash("sha256").update(officialBytes).digest("hex").toUpperCase();
      expect(actual, name).toBe(expected);
    }
  });

  it("genera XML ordenado y lo valida contra el XSD oficial", () => {
    const xml = generateInvoiceXml(fixture());
    const xsd = readFileSync(new URL("facturaComputarizadaCompraVenta.xsd", artifacts), "utf8");
    expect(validateXmlAgainstXsd(xml, xsd)).toBe(true);
    expect(() => validateXmlAgainstXsd(xml.replace("<montoTotal>99.00</montoTotal>", "<montoTotal>-1</montoTotal>"), xsd)).toThrow(/XML inválido/);
  });

  it("valida el XML electrónico sin firma y todos sus campos obligatorios", () => {
    const xsd = readFileSync(new URL("facturaElectronicaCompraVenta.xsd", artifacts), "utf8");
    const xml = generateInvoiceXml(fixture("ELECTRONICA"));
    expect(validateUnsignedElectronicInvoiceXml(xml, xsd)).toBe(true);
    for (const field of ["nitEmisor", "razonSocialEmisor", "numeroFactura", "cuf", "cufd", "fechaEmision", "codigoTipoDocumentoIdentidad", "codigoMetodoPago", "montoTotal", "montoTotalSujetoIva", "codigoMoneda", "leyenda", "codigoDocumentoSector", "actividadEconomica", "codigoProductoSin", "unidadMedida", "subTotal"]) expect(xml).toContain(`<${field}`);
  });

  it("firma con X.509 efímero, verifica XMLDSig y detecta manipulación", () => {
    const credentials = temporaryTestCertificate();
    const xsd = readFileSync(new URL("facturaElectronicaCompraVenta.xsd", artifacts), "utf8");
    const signature = readFileSync(new URL("SignatureSchema.xsd", artifacts), "utf8");
    try {
      const unsigned = generateInvoiceXml(fixture("ELECTRONICA"));
      const signed = signInvoiceXml(unsigned, credentials.privateKey, credentials.certificate);
      expect(validateInvoiceSignatureProfile(signed)).toBe(true);
      expect(verifyInvoiceSignature(signed, credentials.certificate)).toBe(true);
      expect(validateElectronicInvoiceXml(signed, xsd, signature)).toBe(true);
      const tampered = signed.replace("<precioUnitario>100.00</precioUnitario>", "<precioUnitario>101.00</precioUnitario>");
      expect(() => verifyInvoiceSignature(tampered, credentials.certificate)).toThrow(/Firma XMLDSig inválida/);
    } finally {
      credentials.dispose();
    }
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

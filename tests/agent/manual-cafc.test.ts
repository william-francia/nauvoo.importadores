import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareManualCafcXml } from "../../agent-local/src/manual-cafc.ts";
import { verifyInvoiceSignature } from "../../supabase/functions/_shared/siat/xmldsig.ts";
import { verifiedCafcDocument } from "../../supabase/functions/_shared/siat/cafc-document.ts";
import type { InvoiceSnapshot } from "../../supabase/functions/_shared/siat/types.ts";

const evidence = new TextEncoder().encode("comprobante sintético local");
const snapshot: InvoiceSnapshot = {
  id: "test", correlationId: "test", nit: "123456789", razonSocial: "Emisor de prueba", municipio: "La Paz", telefono: null,
  numeroFactura: "54", cuf: "", cufd: "CUFD-TEST", codigoSucursal: 0, codigoPuntoVenta: 0, direccion: "Dirección prueba",
  fechaEmision: "2026-11-01T13:00:00.000Z", modalidad: "ELECTRONICA", documentoSector: 1, tipoFactura: 1,
  cliente: { nombreRazonSocial: "Cliente prueba", codigoTipoDocumentoIdentidad: 1, numeroDocumento: "12345", complemento: null, codigoCliente: "CLI-TEST" },
  pago: { codigoMetodoPago: 1, numeroTarjeta: null, codigoMoneda: 1, tipoCambio: "1" },
  totales: { montoTotal: "5", montoTotalSujetoIva: "5", montoTotalMoneda: "5", descuentoAdicional: "0", cafc: "CAFC-TEST", codigoExcepcion: null },
  leyenda: "Ley N° 453: Leyenda de prueba", usuario: "Operador", detalle: [{ actividadEconomica: "4752100", codigoProductoSin: "1003451", codigoProducto: "p", descripcion: "Artículo", cantidad: "1", unidadMedidaSin: "47", precioUnitario: "5", descuento: "0", subtotal: "5" }],
};
const event = { id: "event", tipo_evento_codigo: 5, fecha_inicio: "2026-11-01T12:00:00Z", fecha_fin: "2026-11-01T14:00:00Z", cufd_id: "cufd", cafc_id: "range", sucursal_id: "suc", punto_venta_id: null, codigo_sucursal: 0, codigo_punto_venta: 0 };
const cufd = { id: "cufd", codigo: "CUFD-TEST", codigo_control: "ABCD", ambiente: "PRUEBAS", sucursal_id: "suc", punto_venta_id: null, fecha_inicio: "2026-11-01T00:00:00Z", fecha_expiracion: "2026-11-02T00:00:00Z" };
const range = { id: "range", autorizacion: "CAFC-TEST", rango_desde: 50, rango_hasta: 60, estado: "VIGENTE", sucursal_id: "suc", punto_venta_id: null, vigente_desde: "2026-10-01T00:00:00Z", vigente_hasta: "2026-12-01T00:00:00Z" };
const artifacts = new URL("../../supabase/functions/_shared/siat/artifacts/SIAT_VIGENTE/", import.meta.url);
const base = { snapshot, event, cufd, range, issuerNit: "123456789", originalBytes: evidence, originalSha256: createHash("sha256").update(evidence).digest("hex").toUpperCase(), originalReviewed: true, now: new Date("2026-11-02T12:00:00Z"), privateKeyPem: "", certificatePem: "", xsd: "", signatureXsd: "" };

describe("preparación CAFC aislada", () => {
  it("rechaza originales ausentes, fechas falsas y rangos o sucursales ajenos antes de firmar", () => {
    expect(() => prepareManualCafcXml({ ...base, originalReviewed: false })).toThrow("ORIGINAL");
    expect(() => prepareManualCafcXml({ ...base, event: { ...event, tipo_evento_codigo: 1 } })).toThrow("FECHA_O_EVENTO");
    expect(() => prepareManualCafcXml({ ...base, snapshot: { ...snapshot, fechaEmision: "2026-11-02T13:00:00Z" } })).toThrow("FECHA_O_EVENTO");
    expect(() => prepareManualCafcXml({ ...base, range: { ...range, sucursal_id: "otra" } })).toThrow("AUTORIZACION_O_CUFD");
    expect(() => prepareManualCafcXml({ ...base, snapshot: { ...snapshot, numeroFactura: "61" } })).toThrow("NUMERO_O_DOCUMENTO");
    expect(() => prepareManualCafcXml({ ...base, snapshot: { ...snapshot, totales: { ...snapshot.totales, montoTotal: "6" } } })).toThrow("TOTAL_NO_COINCIDE");
  });
  it("firma y valida un XML sintético conservando los datos del original", () => {
    const candidates = ["openssl", "C:\\Program Files\\Git\\usr\\bin\\openssl.exe", "C:\\Program Files\\Git\\mingw64\\bin\\openssl.exe"];
    const openssl = candidates.find((item) => { try { execFileSync(item, ["version"], { stdio: "ignore" }); return true; } catch { return false; } });
    if (!openssl) throw new Error("OpenSSL no está disponible para la prueba efímera.");
    const prefix = join(tmpdir(), "nuvoo-cafc-test-"); const dir = mkdtempSync(prefix);
    if (!dir.startsWith(prefix)) throw new Error("Directorio temporal fuera de alcance");
    try {
      const keyPath = join(dir, "key.pem"), certPath = join(dir, "cert.pem");
      execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=Prueba CAFC", "-keyout", keyPath, "-out", certPath], { stdio: "ignore", env: { ...process.env, MSYS2_ARG_CONV_EXCL: "*" } });
      const privateKeyPem = readFileSync(keyPath, "utf8"), certificatePem = readFileSync(certPath, "utf8");
      const result = prepareManualCafcXml({ ...base, privateKeyPem, certificatePem, xsd: readFileSync(new URL("facturaElectronicaCompraVenta.xsd", artifacts), "utf8"), signatureXsd: readFileSync(new URL("SignatureSchema.xsd", artifacts), "utf8") });
      expect(result.xml).toContain("<numeroFactura>54</numeroFactura>"); expect(result.xml).toContain("<cafc>CAFC-TEST</cafc>");
      expect(result.xml).toContain("<fechaEmision>2026-11-01T09:00:00.000</fechaEmision>");
      expect(result.xml).toContain("<nombreRazonSocial>Cliente prueba</nombreRazonSocial>"); expect(verifyInvoiceSignature(result.xml, certificatePem)).toBe(true);
      expect(result.fingerprint).toMatch(/^[A-F0-9]{64}$/);
      const repeated = prepareManualCafcXml({ ...base, privateKeyPem, certificatePem, xsd: readFileSync(new URL("facturaElectronicaCompraVenta.xsd", artifacts), "utf8"), signatureXsd: readFileSync(new URL("SignatureSchema.xsd", artifacts), "utf8") });
      expect(repeated.fingerprint).toBe(result.fingerprint); expect(repeated.cuf).toBe(result.cuf);
      const parsed = verifiedCafcDocument(result.xml, certificatePem, readFileSync(new URL("facturaElectronicaCompraVenta.xsd", artifacts), "utf8"), readFileSync(new URL("SignatureSchema.xsd", artifacts), "utf8"));
      expect(parsed).toMatchObject({ numeroFactura: "54", cuf: result.cuf, nombreRazonSocial: "Cliente prueba", fechaEmision: "2026-11-01T13:00:00.000Z" });
      expect(() => verifiedCafcDocument(result.xml.replace("Cliente prueba", "Cliente alterado"), certificatePem, readFileSync(new URL("facturaElectronicaCompraVenta.xsd", artifacts), "utf8"), readFileSync(new URL("SignatureSchema.xsd", artifacts), "utf8"))).toThrow();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

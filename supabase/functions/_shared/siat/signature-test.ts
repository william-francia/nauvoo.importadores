import { generateInvoiceXml } from "./invoice-xml.ts";
import { validateSignatureCredentials } from "./signature-credentials.ts";
import { signInvoiceXml, verifyInvoiceSignature } from "./xmldsig.ts";
import { validateElectronicInvoiceXml, validateUnsignedElectronicInvoiceXml } from "./xsd.ts";
import type { InvoiceSnapshot } from "./types.ts";

export function assertSignatureTestAdmin(role: string): void {
  if (role.toLowerCase() !== "administrador") throw new Error("FIRMA_ACCESO_DENEGADO");
}

const fixture: InvoiceSnapshot = {
  id: "00000000-0000-4000-8000-000000000001", correlationId: "00000000-0000-4000-8000-000000000002",
  nit: "72229012", razonSocial: "PRUEBA LOCAL", municipio: "La Paz", telefono: null,
  numeroFactura: "1", cuf: "8727F63A15F8976591FDDE5B387C5D015A29E06A1A19E23EF34124CD",
  cufd: "CUFD-DE-PRUEBA-NO-FISCAL", codigoSucursal: 0, direccion: "PRUEBA LOCAL", codigoPuntoVenta: 0,
  fechaEmision: "2019-01-13T20:37:21.231Z", modalidad: "ELECTRONICA", documentoSector: 1, tipoFactura: 1,
  cliente: { nombreRazonSocial: "PRUEBA LOCAL", codigoTipoDocumentoIdentidad: 1, numeroDocumento: "1234567", complemento: null, codigoCliente: "PRUEBA" },
  pago: { codigoMetodoPago: 1, numeroTarjeta: null, codigoMoneda: 1, tipoCambio: "1" },
  totales: { montoTotal: "99", montoTotalSujetoIva: "99", montoTotalMoneda: "99", descuentoAdicional: "1" },
  leyenda: "Prueba local sin validez fiscal", usuario: "prueba",
  detalle: [{ actividadEconomica: "4752100", codigoProductoSin: "1001903", codigoProducto: "PRUEBA", descripcion: "Prueba local", cantidad: "1", unidadMedidaSin: "47", precioUnitario: "100", descuento: "0", subtotal: "100", numeroSerie: null, numeroImei: null }],
};

export async function testSignatureIsolated(privateKeyPem: string | undefined, certificatePem: string | undefined, readArtifact: (name: string) => Promise<string>) {
  const credentials = validateSignatureCredentials(privateKeyPem, certificatePem);
  const [invoiceXsd, signatureXsd] = await Promise.all([readArtifact("facturaElectronicaCompraVenta.xsd"), readArtifact("SignatureSchema.xsd")]);
  const unsigned = generateInvoiceXml(fixture);
  validateUnsignedElectronicInvoiceXml(unsigned, invoiceXsd);
  const signed = signInvoiceXml(unsigned, privateKeyPem!, certificatePem!);
  verifyInvoiceSignature(signed, certificatePem!);
  validateElectronicInvoiceXml(signed, invoiceXsd, signatureXsd);
  return { ok: true as const, firma: true as const, xsd: true as const, nit: credentials.nit, nitCoincidenciaTextual: credentials.nitCoincidenciaTextual, eku: credentials.eku };
}

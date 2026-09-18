import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateFiscalPdf } from "../../supabase/functions/_shared/siat/fiscal-pdf.ts";
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
  it("genera un PDF válido con el QR oficial", async () => {
    const pdf = await generateFiscalPdf(snapshot, `https://pilotosiat.impuestos.gob.bo/consulta/QR?nit=${snapshot.nit}&cuf=${snapshot.cuf}&numero=${snapshot.numeroFactura}&t=2`);
    expect(new TextDecoder().decode(pdf.slice(0, 4))).toBe("%PDF");
    expect(pdf.byteLength).toBeGreaterThan(10_000);
    if (process.env.SIAT_WRITE_PDF_PREVIEW === "1") {
      mkdirSync("tmp/pdfs", { recursive: true });
      writeFileSync("tmp/pdfs/factura-fiscal-preview.pdf", pdf);
    }
  });
});

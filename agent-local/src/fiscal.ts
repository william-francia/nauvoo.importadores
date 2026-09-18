import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Decimal from "decimal.js";
import type { AgentConfig } from "./config.ts";
import type { AgentStore } from "./store.ts";
import type { LocalInvoice, LocalSession, OfflineSaleInput, BootstrapBundle } from "./types.ts";
import { generateCuf } from "../../supabase/functions/_shared/siat/cuf.ts";
import { generateInvoiceXml } from "../../supabase/functions/_shared/siat/invoice-xml.ts";
import { generateFiscalPdf } from "../../supabase/functions/_shared/siat/fiscal-pdf.ts";
import { officialQrUrl } from "../../supabase/functions/_shared/siat/qr.ts";
import { signInvoiceXml } from "../../supabase/functions/_shared/siat/xmldsig.ts";
import { validateElectronicInvoiceXml, validateXmlAgainstXsd } from "../../supabase/functions/_shared/siat/xsd.ts";
import type { InvoiceSnapshot } from "../../supabase/functions/_shared/siat/types.ts";
import { sha256 } from "./security.ts";

const value = (row: Record<string, unknown>, ...keys: string[]) => { for (const key of keys) if (row[key] != null) return row[key]; return null; };
const required = (row: Record<string, unknown>, label: string, ...keys: string[]) => { const result = String(value(row, ...keys) ?? "").trim(); if (!result) throw new Error(`${label} no disponible en el agente.`); return result; };
const number = (row: Record<string, unknown>, label: string, ...keys: string[]) => { const result = Number(value(row, ...keys)); if (!Number.isFinite(result)) throw new Error(`${label} inválido.`); return result; };
const normalizeDocumentType = (type: unknown) => ({ CI: 1, CEX: 2, PASAPORTE: 3, OD: 4, NIT: 5 }[String(type).toUpperCase()] ?? 1);

export class FiscalIssuer {
  constructor(private readonly config: AgentConfig, private readonly store: AgentStore) {}
  async issue(input: OfflineSaleInput, session: LocalSession): Promise<LocalInvoice> {
    if (!/^[A-Za-z0-9:_-]{16,160}$/.test(input.idempotencyKey)) throw new Error("Clave de idempotencia inválida.");
    if (!input.items.length || input.items.length > 500) throw new Error("La venta debe contener entre 1 y 500 detalles.");
    return this.store.createInvoice(async ({ bundle, event, number: invoiceNumber, products, client }) => {
      const config = bundle.config; const cufd = event.cufd as Record<string, unknown> ?? bundle.cufd;
      const branch = bundle.branch; const point = bundle.point ?? {};
      const modality = String(config.modalidad ?? "COMPUTARIZADA") as "COMPUTARIZADA" | "ELECTRONICA";
      const emittedAt = new Date().toISOString(); const cafcRange = input.manualCafc ? bundle.cafc.find(row => String(row.id) === input.manualCafc?.rangeId) : null;
      this.validateFiscalWindow(bundle, cufd, emittedAt);
      const id = crypto.randomUUID(); const correlationId = crypto.randomUUID();
      const controlCode = required(cufd, "Código de control CUFD", "codigo_control", "codigoControl");
      const nit = required(config, "NIT", "nit"); const branchCode = number(branch, "Sucursal", "codigo");
      const pointCode = value(point, "codigo") == null ? null : number(point, "Punto de venta", "codigo");
      const documentSector = number(config, "Documento sector", "documento_sector", "documentoSector");
      const invoiceType = number(config, "Tipo de factura", "tipo_factura", "tipoFactura");
      const cuf = generateCuf({ nit, fechaEmision: emittedAt, codigoSucursal: branchCode, modalidad: modality === "ELECTRONICA" ? 1 : 2, tipoEmision: 2, tipoFactura: invoiceType, documentoSector: documentSector, numeroFactura: invoiceNumber, codigoPuntoVenta: pointCode, codigoControl: controlCode });
      const paymentMap = bundle.payments.find(row => String(row.metodo_interno) === input.metodoPago);
      if (!paymentMap) throw new Error("El método de pago no tiene homologación SIAT local.");
      const details = input.items.map((item, index) => {
        const product = products[index]; if (!product) throw new Error("Producto local inconsistente.");
        const homologation = product.homologacion as Record<string, unknown> | null;
        if (!homologation || homologation.estado !== "HOMOLOGADO") throw new Error(`Producto ${product.codigo_interno ?? product.nombre} sin homologación SIAT vigente.`);
        const quantity = new Decimal(item.cantidad); const price = new Decimal(item.precioUnitario); const discount = new Decimal(item.descuento ?? 0);
        if (!quantity.isPositive() || price.isNegative() || discount.isNegative()) throw new Error("Cantidad, precio o descuento inválidos.");
        const subtotal = quantity.mul(price).minus(discount); if (subtotal.isNegative()) throw new Error("El descuento de línea supera su importe.");
        return { actividadEconomica: required(homologation, "Actividad económica", "actividad_economica"), codigoProductoSin: required(homologation, "Producto SIN", "codigo_producto_sin"), codigoProducto: required(product, "Código interno", "codigo_interno"), descripcion: required(product, "Descripción", "nombre"), cantidad: quantity.toFixed(3), unidadMedidaSin: required(homologation, "Unidad SIN", "unidad_medida_sin"), precioUnitario: price.toFixed(2), descuento: discount.isZero() ? null : discount.toFixed(2), subtotal: subtotal.toFixed(2), numeroSerie: null, numeroImei: null };
      });
      const beforeExtra = details.reduce((sum, item) => sum.plus(item.subtotal), new Decimal(0)); const total = beforeExtra.minus(input.descuentoAdicional);
      if (!total.isPositive()) throw new Error("El total fiscal debe ser mayor a cero.");
      const legend = bundle.legends[0]?.descripcion;
      if (!legend) throw new Error("No existe leyenda oficial sincronizada.");
      const snapshot: InvoiceSnapshot = {
        id, correlationId, nit, razonSocial: required(config, "Razón social", "razon_social", "razonSocial"), municipio: required(config, "Municipio", "municipio"), telefono: String(config.telefono ?? "") || null,
        numeroFactura: String(invoiceNumber), cuf, cufd: required(cufd, "CUFD", "codigo"), codigoSucursal: branchCode,
        direccion: required(cufd, "Dirección fiscal", "direccion"), codigoPuntoVenta: pointCode, fechaEmision: emittedAt, modalidad: modality, documentoSector: documentSector, tipoFactura: invoiceType,
        cliente: { nombreRazonSocial: required(client, "Razón social del cliente", "nombre_razon_social"), codigoTipoDocumentoIdentidad: normalizeDocumentType(client.tipo_documento), numeroDocumento: required(client, "Documento del cliente", "numero_documento"), complemento: String(client.complemento ?? "") || null, codigoCliente: String(client.codigo_cliente ?? client.id) },
        pago: { codigoMetodoPago: Number(paymentMap.codigo_metodo_pago), numeroTarjeta: input.tarjetaOfuscada, codigoMoneda: 1, tipoCambio: "1.00" },
        totales: { montoTotal: total.toFixed(2), montoTotalSujetoIva: total.toFixed(2), montoTotalMoneda: total.toFixed(2), descuentoAdicional: new Decimal(input.descuentoAdicional).toFixed(2), montoGiftCard: null, codigoExcepcion: null, cafc: cafcRange ? required(cafcRange, "Autorización CAFC", "autorizacion") : null },
        leyenda: String(legend), usuario: session.userName, detalle: details,
      };
      let xml = generateInvoiceXml(snapshot);
      const artifactRoot = join(process.cwd(), "supabase", "functions", "_shared", "siat", "artifacts", "SIAT_VIGENTE");
      const xsd = readFileSync(join(artifactRoot, modality === "ELECTRONICA" ? "facturaElectronicaCompraVenta.xsd" : "facturaComputarizadaCompraVenta.xsd"), "utf8");
      if (modality === "ELECTRONICA") {
        const key = process.env.SIAT_PRIVATE_KEY_PEM?.replaceAll("\\n", "\n") ?? ""; const certificate = process.env.SIAT_CERTIFICATE_PEM?.replaceAll("\\n", "\n") ?? "";
        xml = signInvoiceXml(xml, key, certificate); validateElectronicInvoiceXml(xml, xsd, readFileSync(join(artifactRoot, "SignatureSchema.xsd"), "utf8"));
      } else validateXmlAgainstXsd(xml, xsd);
      const compressed = gzipSync(Buffer.from(xml)); const pdf = await generateFiscalPdf(snapshot, officialQrUrl("PRUEBAS", nit, cuf, String(invoiceNumber)));
      const base = `${emittedAt.slice(0, 7)}/${id}/${cuf}`; const xmlPath = this.store.writeArtifact(`${base}.xml.gz`, compressed); const pdfPath = this.store.writeArtifact(`${base}.pdf`, pdf);
      let manualCafc: LocalInvoice["manualCafc"] = null;
      if (input.manualCafc && cafcRange) { if (!/^data:[\w/+.-]+;base64,/.test(input.manualCafc.evidenciaBase64)) throw new Error("La factura manual requiere evidencia digital del original."); const evidence = Buffer.from(input.manualCafc.evidenciaBase64.split(",")[1] ?? "", "base64"); if (!evidence.length || evidence.length > 8_000_000) throw new Error("Evidencia CAFC inválida o demasiado grande."); const evidencePath = this.store.writeArtifact(`${base}.evidencia`, evidence); manualCafc = { rangeId: input.manualCafc.rangeId, numero: input.manualCafc.numero, autorizacion: required(cafcRange, "Autorización CAFC", "autorizacion"), evidencePath }; }
      const localSnapshot = { ...snapshot, local: { clienteId: input.clienteId, metodoPago: input.metodoPago, observacion: input.observacion ?? null, descuentoVenta: input.descuentoAdicional, items: input.items.map((item, index) => ({ productoId: item.productoId, almacenId: item.almacenId, codigoProducto: details[index]?.codigoProducto, descripcion: details[index]?.descripcion, cantidad: item.cantidad, precioUnitario: item.precioUnitario, descuento: item.descuento })) } };
      const invoice: LocalInvoice = { id, idempotencyKey: input.idempotencyKey, correlationId, cajaId: input.cajaId, eventId: String(event.id), numeroFactura: invoiceNumber, cuf, fechaEmision: emittedAt, cliente: snapshot.cliente, total: total.toFixed(2), estado: "PENDIENTE", paqueteId: null, xmlPath, pdfPath, xmlHash: sha256(compressed), snapshot: localSnapshot as unknown as Record<string, unknown>, syncError: null, createdBy: session.userId, manualCafc };
      return { invoice, items: input.items.map(item => ({ productoId: item.productoId, almacenId: item.almacenId, cantidad: item.cantidad })) };
    }, { idempotencyKey: input.idempotencyKey, clienteId: input.clienteId, items: input.items as unknown as Array<Record<string, unknown>>, manualCafc: input.manualCafc ? { rangeId: input.manualCafc.rangeId, numero: input.manualCafc.numero } : undefined });
  }
  private validateFiscalWindow(bundle: BootstrapBundle, cufd: Record<string, unknown>, emittedAt: string) {
    const expiry = new Date(required(cufd, "Vigencia CUFD", "fecha_expiracion", "fechaVigencia")).getTime();
    const rule = bundle.rules.find(row => row.codigo === "MAX_EXTENSION_CUFD_CONTINGENCIA_HORAS");
    if (!rule) throw new Error("Regla versionada de extensión CUFD no aprovisionada.");
    const extension = Number(rule.valor);
    if (!Number.isFinite(extension) || extension <= 0) throw new Error("Regla versionada de extensión CUFD inválida.");
    if (new Date(emittedAt).getTime() > expiry + extension * 3_600_000) throw new Error("El CUFD del evento superó la extensión normativa versionada.");
  }
}

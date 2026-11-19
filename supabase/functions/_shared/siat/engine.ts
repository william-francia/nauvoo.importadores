import { Decimal } from "decimal.js";
import { generateCuf } from "./cuf.ts";
import { gzipBytes, gunzipBytes, sha256Hex } from "./encoding.ts";
import { generateFiscalPdf } from "./fiscal-pdf.ts";
import { assertCurrentFiscalCodes, assertEventFiscalCode, assertFiscalOperationAllowed, reversalProblemCodes } from "./fiscal-operation.ts";
import { generateInvoiceXml } from "./invoice-xml.ts";
import { siatDateTime } from "./invoice-xml.ts";
import { invoiceTotal } from "./money.ts";
import { officialQrUrl } from "./qr.ts";
import { SiatRepository } from "./repository.ts";
import { AmbiguousSiatError } from "./types.ts";
import { publicCertificateSha256 } from "./pilot-approval.ts";
import type { FiscalResponseCapture, InvoiceSnapshot, SiatAdapter, SiatContext, SiatResponse } from "./types.ts";
import { signInvoiceXml, verifyInvoiceSignature } from "./xmldsig.ts";
import { validateSignatureCredentials } from "./signature-credentials.ts";
import { sanitizeErrorMessage } from "./soap.ts";
import { validateElectronicInvoiceXml, validateUnsignedElectronicInvoiceXml, validateXmlAgainstXsd } from "./xsd.ts";
import { createTar } from "./tar.ts";
import { assertCompletePackageLinks, assertEventReadyForRegistration, assertRecoveryCufd } from "./contingency-controls.ts";

const XSD_HASH = {
  COMPUTARIZADA: "344ED2A4BE74C191637B7E918ED3DCE6D85B667CB98DA47A53FA4103683717D9",
  ELECTRONICA: "A3BB1D2E35C2D1E8C710AFBE9F1DA242A9F02BDD49F78C3D45DC4DBAFDA339CF",
} as const;

const catalogOperations = [
  ["ACTIVIDADES", "Actividades económicas", "sincronizarActividades"],
  ["ACTIVIDADES_DOCUMENTO_SECTOR", "Actividades por documento sector", "sincronizarListaActividadesDocumentoSector"],
  ["PRODUCTOS_SERVICIOS", "Productos y servicios", "sincronizarListaProductosServicios"],
  ["UNIDADES_MEDIDA", "Unidades de medida", "sincronizarParametricaUnidadMedida"],
  ["METODOS_PAGO", "Métodos de pago", "sincronizarParametricaTipoMetodoPago"],
  ["TIPOS_DOCUMENTO", "Tipos de documento", "sincronizarParametricaTipoDocumentoIdentidad"],
  ["MOTIVOS_ANULACION", "Motivos de anulación", "sincronizarParametricaMotivoAnulacion"],
  ["LEYENDAS_FACTURA", "Leyendas de factura", "sincronizarListaLeyendasFactura"],
  ["MENSAJES_SERVICIOS", "Mensajes de servicios", "sincronizarListaMensajesServicios"],
  ["EVENTOS_SIGNIFICATIVOS", "Eventos significativos", "sincronizarParametricaEventosSignificativos"],
  ["PAISES_ORIGEN", "Países de origen", "sincronizarParametricaPaisOrigen"],
  ["MONEDAS", "Tipos de moneda", "sincronizarParametricaTipoMoneda"],
  ["TIPOS_EMISION", "Tipos de emisión", "sincronizarParametricaTipoEmision"],
  ["TIPOS_FACTURA", "Tipos de factura", "sincronizarParametricaTiposFactura"],
  ["TIPOS_PUNTO_VENTA", "Tipos de punto de venta", "sincronizarParametricaTipoPuntoVenta"],
  ["DOCUMENTOS_SECTOR", "Documentos sector", "sincronizarParametricaTipoDocumentoSector"],
] as const;

const stringValue = (value: unknown, label: string) => {
  if (value == null || String(value).trim() === "") throw new Error(`${label} no está configurado.`);
  return String(value);
};
const numberValue = (value: unknown, label: string) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${label} no es válido.`);
  return parsed;
};
const objectValue = (value: unknown) => value && typeof value === "object" ? value as Record<string, unknown> : {};
const catalogItem = (catalogCode: string, raw: unknown) => {
  const item = objectValue(raw);
  if (catalogCode === "ACTIVIDADES_DOCUMENTO_SECTOR") {
    const actividad = String(item.codigoActividad ?? ""); const documento = String(item.codigoDocumentoSector ?? "");
    const claveNatural = actividad && documento ? `${actividad}:${documento}` : "";
    return { codigo: claveNatural, claveNatural, descripcion: String(item.tipoDocumentoSector ?? ""), metadatos: item };
  }
  if (catalogCode === "PRODUCTOS_SERVICIOS") {
    const actividad = String(item.codigoActividad ?? ""); const producto = String(item.codigoProducto ?? "");
    const nandina = Array.isArray(item.nandina) ? item.nandina.map(String).join("|") : String(item.nandina ?? "");
    return { codigo: producto, claveNatural: actividad && producto ? `${actividad}:${producto}:${nandina}` : "", descripcion: String(item.descripcionProducto ?? ""), metadatos: item };
  }
  if (catalogCode === "LEYENDAS_FACTURA") {
    const actividad = String(item.codigoActividad ?? ""); const descripcion = String(item.descripcionLeyenda ?? "");
    return { codigo: actividad, claveNatural: actividad && descripcion ? `${actividad}:${descripcion}` : "", descripcion, metadatos: item };
  }
  const codigo = item.codigoClasificador ?? item.codigoCaeb ?? item.codigoActividad ?? item.codigoProducto ?? item.codigo;
  const descripcion = item.descripcion ?? item.descripcionLeyenda ?? item.descripcionProducto ?? item.productoServicio ?? item.nombre;
  const codigoTexto = String(codigo ?? ""); const descripcionTexto = String(descripcion ?? "");
  const claveNatural = catalogCode === "UNIDADES_MEDIDA" ? `${codigoTexto}:${descripcionTexto}` : codigoTexto;
  return { codigo: codigoTexto, claveNatural, descripcion: descripcionTexto, metadatos: { ...item, actividadEconomica: item.codigoActividad ?? item.codigoCaeb ?? null } };
};
const arrayValue = (value: unknown) => Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
const errorMessage = (error: unknown) => sanitizeErrorMessage(error);

export type InvoiceReceptionOutcome = {
  state: "VALIDADA" | "OBSERVADA" | "SIN_RESPUESTA";
  accepted: boolean;
  observed: boolean;
  inconclusive: boolean;
};

export function classifyInvoiceReception(response: Pick<SiatResponse, "codigoEstado" | "codigoRecepcion" | "transaccion">): InvoiceReceptionOutcome {
  const accepted = response.codigoEstado === 908 && response.transaccion === true && Boolean(response.codigoRecepcion);
  const observed = response.codigoEstado === 904;
  return {
    state: accepted ? "VALIDADA" : observed ? "OBSERVADA" : "SIN_RESPUESTA",
    accepted,
    observed,
    inconclusive: !accepted && !observed,
  };
}

export function assertActiveInvoiceFiscalCodes(
  invoice: Record<string, unknown>,
  cuis: Record<string, unknown>,
  cufd: Record<string, unknown>,
  now = Date.now(),
): void {
  const invoicePoint = invoice.punto_venta_id ?? null;
  const cuisExpiry = cuis.fecha_expiracion == null ? null : Date.parse(String(cuis.fecha_expiracion));
  if (cuis.estado !== "VIGENTE" || cuisExpiry !== null && (!Number.isFinite(cuisExpiry) || cuisExpiry <= now)) {
    throw new Error("CUIS_NO_VIGENTE");
  }
  if (cuis.id !== invoice.cuis_id || cuis.codigo !== invoice.cuis || cuis.sucursal_id !== invoice.sucursal_id
    || (cuis.punto_venta_id ?? null) !== invoicePoint || cuis.ambiente !== invoice.ambiente) {
    throw new Error("CUIS_NO_CORRESPONDE");
  }

  const cufdStart = Date.parse(String(cufd.fecha_inicio ?? ""));
  const cufdExpiry = Date.parse(String(cufd.fecha_expiracion ?? ""));
  if (cufd.estado !== "VIGENTE" || !Number.isFinite(cufdStart) || !Number.isFinite(cufdExpiry) || cufdStart > now || cufdExpiry <= now) {
    throw new Error("CUFD_NO_VIGENTE");
  }
  if (cufd.id !== invoice.cufd_id || cufd.codigo !== invoice.cufd || cufd.cuis_id !== cuis.id
    || cufd.sucursal_id !== invoice.sucursal_id || (cufd.punto_venta_id ?? null) !== invoicePoint
    || cufd.ambiente !== invoice.ambiente) {
    throw new Error("CUFD_NO_CORRESPONDE");
  }
}

export class SiatEngine {
  constructor(
    private readonly repository: SiatRepository,
    private readonly adapter: SiatAdapter,
    private readonly secrets: { privateKeyPem?: string; certificatePem?: string },
    private readonly readArtifact: (name: string) => Promise<string>,
    private readonly prepareOperationEvidence?: (invoice: string, operation: "ANULACION" | "REVERSION", attempt: string) => Promise<FiscalResponseCapture>,
    private readonly contingencyEnabled = false,
  ) {}

  private context(config: Record<string, unknown>, extra: Partial<SiatContext> = {}): SiatContext {
    if (config.ambiente !== "PRUEBAS") throw new Error("Producción permanece bloqueada hasta contar con autorización oficial.");
    if (config.version_normativa !== "SIAT_VIGENTE") throw new Error("PENDIENTE_DE_VERIFICACION_OFICIAL: versión normativa no habilitada.");
    return {
      ambiente: "PRUEBAS", versionNormativa: "SIAT_VIGENTE",
      codigoSistema: stringValue(config.codigo_sistema, "Código de sistema"), nit: stringValue(config.nit, "NIT"),
      modalidad: config.modalidad === "ELECTRONICA" ? "ELECTRONICA" : "COMPUTARIZADA",
      codigoSucursal: numberValue(extra.codigoSucursal ?? 0, "Sucursal"), codigoPuntoVenta: extra.codigoPuntoVenta ?? null,
      cuis: String(extra.cuis ?? ""), cufd: extra.cufd, documentoSector: extra.documentoSector, tipoFactura: extra.tipoFactura,
    };
  }

  private invoiceContext(config: Record<string, unknown>, invoice: Record<string, unknown>): SiatContext {
    return this.context(config, {
      codigoSucursal: numberValue(invoice.codigo_sucursal, "Sucursal"), codigoPuntoVenta: invoice.punto_venta_id ? Number(invoice.codigo_punto_venta) : null,
      cuis: stringValue(invoice.cuis, "CUIS"), cufd: stringValue(invoice.cufd, "CUFD"),
      documentoSector: numberValue(invoice.documento_sector, "Documento sector"), tipoFactura: numberValue(invoice.tipo_factura, "Tipo factura"),
    });
  }

  private async currentInvoiceContext(config: Record<string, unknown>, invoice: Record<string, unknown>, operation: Record<string, unknown> = {}): Promise<SiatContext> {
    if (invoice.ambiente !== config.ambiente) throw new Error("AMBIENTE_FACTURA_NO_CORRESPONDE");
    const branchId = stringValue(operation.sucursalOperacionId ?? invoice.sucursal_id, "Sucursal");
    const pointId = operation.sucursalOperacionId ? (operation.puntoVentaOperacionId ? String(operation.puntoVentaOperacionId) : null) : (invoice.punto_venta_id ? String(invoice.punto_venta_id) : null);
    const branch = await this.repository.branch(branchId);
    if (branch.activo !== true) throw new Error("SUCURSAL_OPERACION_NO_HABILITADA");
    const point = pointId ? await this.repository.point(pointId) : null;
    if (point && (point.activo !== true || point.sucursal_id !== branchId)) throw new Error("PUNTO_VENTA_OPERACION_NO_HABILITADO");
    const scope = { ambiente: invoice.ambiente, sucursal_id: branchId, punto_venta_id: pointId };
    const codes = await this.repository.activeFiscalCodes(branchId, pointId, String(invoice.ambiente));
    assertCurrentFiscalCodes(scope, codes.cuis, codes.cufd);
    return { ...this.invoiceContext(config, invoice), codigoSucursal: numberValue(branch.codigo, "Sucursal"), codigoPuntoVenta: point ? numberValue(point.codigo, "Punto de venta") : null, cuis: String(codes.cuis.codigo), cufd: String(codes.cufd.codigo) };
  }

  private snapshot(invoice: Record<string, unknown>, config: Record<string, unknown>, branch: Record<string, unknown>, cufd: Record<string, unknown>, cuf: string): InvoiceSnapshot {
    const customer = objectValue(invoice.cliente_snapshot); const payment = objectValue(invoice.pago_snapshot); const totals = objectValue(invoice.totales_snapshot);
    const detail = arrayValue(invoice.detalle_snapshot);
    const computed = invoiceTotal(detail.map((line) => ({ quantity: stringValue(line.cantidad, "Cantidad"), price: stringValue(line.precioUnitario, "Precio"), discount: String(line.descuento ?? 0) })), String(totals.descuentoAdicional ?? 0));
    if (!computed.eq(new Decimal(stringValue(totals.montoTotal, "Monto total")))) throw new Error("Los totales del snapshot no coinciden con el detalle fiscal.");
    return {
      id: stringValue(invoice.id, "Factura"), correlationId: stringValue(invoice.correlation_id, "Correlación"),
      nit: stringValue(config.nit, "NIT"), razonSocial: stringValue(config.razon_social, "Razón social"),
      municipio: stringValue(branch.municipio ?? config.municipio, "Municipio"), telefono: config.telefono ? String(config.telefono) : null,
      numeroFactura: stringValue(invoice.numero_factura, "Número de factura"), cuf, cufd: stringValue(invoice.cufd, "CUFD"),
      codigoSucursal: numberValue(invoice.codigo_sucursal, "Sucursal"), direccion: stringValue(cufd.direccion ?? branch.direccion ?? config.domicilio, "Dirección"),
      codigoPuntoVenta: invoice.punto_venta_id ? Number(invoice.codigo_punto_venta) : null, fechaEmision: stringValue(invoice.fecha_emision, "Fecha de emisión"),
      modalidad: invoice.modalidad === "ELECTRONICA" ? "ELECTRONICA" : "COMPUTARIZADA",
      documentoSector: numberValue(invoice.documento_sector, "Documento sector"), tipoFactura: numberValue(invoice.tipo_factura, "Tipo factura"),
      cliente: {
        nombreRazonSocial: customer.nombreRazonSocial ? String(customer.nombreRazonSocial) : null,
        codigoTipoDocumentoIdentidad: numberValue(customer.codigoTipoDocumentoIdentidad, "Tipo de documento"),
        numeroDocumento: stringValue(customer.numeroDocumento, "Documento"), complemento: customer.complemento ? String(customer.complemento) : null,
        codigoCliente: stringValue(customer.codigoCliente, "Código de cliente"),
      },
      pago: { codigoMetodoPago: numberValue(payment.codigoMetodoPago, "Método de pago"), numeroTarjeta: payment.numeroTarjeta ? String(payment.numeroTarjeta) : null, codigoMoneda: numberValue(payment.codigoMoneda, "Moneda"), tipoCambio: stringValue(payment.tipoCambio, "Tipo de cambio") },
      totales: { montoTotal: stringValue(totals.montoTotal, "Monto total"), montoTotalSujetoIva: stringValue(totals.montoTotalSujetoIva, "Monto sujeto a IVA"), montoTotalMoneda: stringValue(totals.montoTotalMoneda, "Monto moneda"), montoGiftCard: totals.montoGiftCard == null ? null : String(totals.montoGiftCard), descuentoAdicional: totals.descuentoAdicional == null ? null : String(totals.descuentoAdicional), codigoExcepcion: totals.codigoExcepcion == null ? null : numberValue(totals.codigoExcepcion, "Código de excepción"), cafc: totals.cafc == null ? null : String(totals.cafc) },
      leyenda: stringValue(totals.leyenda, "Leyenda fiscal"), usuario: String(payment.usuario || "sistema").slice(0, 100),
      detalle: detail.map((line) => ({ actividadEconomica: stringValue(line.actividadEconomica, "Actividad económica"), codigoProductoSin: stringValue(line.codigoProductoSin, "Producto SIN"), codigoProducto: stringValue(line.codigoProducto, "Código producto"), descripcion: stringValue(line.descripcion, "Descripción"), cantidad: stringValue(line.cantidad, "Cantidad"), unidadMedidaSin: stringValue(line.unidadMedidaSin, "Unidad de medida"), precioUnitario: stringValue(line.precioUnitario, "Precio"), descuento: line.descuento == null ? null : String(line.descuento), subtotal: stringValue(line.subtotal, "Subtotal"), numeroSerie: line.numeroSerie == null ? null : String(line.numeroSerie), numeroImei: line.numeroImei == null ? null : String(line.numeroImei) })),
    };
  }

  private async persistRepresentation(invoiceId: string, snapshot: InvoiceSnapshot) {
    const qr = officialQrUrl("PRUEBAS", snapshot.nit, snapshot.cuf, snapshot.numeroFactura);
    const pdf = await generateFiscalPdf(snapshot, qr);
    const pdfPath = `${snapshot.fechaEmision.slice(0, 7)}/${invoiceId}/${snapshot.cuf}.pdf`;
    await this.repository.store(pdfPath, pdf, "application/pdf");
    return { qr_contenido: qr, pdf_storage_path: pdfPath, fecha_validacion: new Date().toISOString() };
  }

  async emit(job: Record<string, unknown>): Promise<void> {
    if (objectValue(job.payload).reenvioAutomaticoBloqueado === true) throw new Error("SIAT_REENVIO_BLOQUEADO");
    const invoiceId = stringValue(job.factura_id, "Factura"); const jobId = stringValue(job.id, "Outbox");
    const invoice = await this.repository.invoice(invoiceId);
    if (["VALIDADA", "ANULADA", "REVERTIDA"].includes(String(invoice.estado_fiscal))) { await this.repository.completeJob(jobId); return; }
    const config = await this.repository.configuration();
    if (invoice.origen_fiscal === "PILOTO") {
      const certificateHash = await publicCertificateSha256(this.secrets.certificatePem ?? "").catch(() => "");
      if (config.ambiente !== "PRUEBAS" || config.siat_habilitado !== false
        || !await this.repository.pilotEmissionAllowed(invoice, job, certificateHash)) throw new Error("PILOTO_EMISION_NO_AUTORIZADA");
    } else if (config.siat_habilitado !== true) throw new Error("SIAT_EMISION_NO_HABILITADA");
    if (["ENVIANDO", "SIN_RESPUESTA", "CONCILIANDO"].includes(String(invoice.estado_fiscal))) {
      await this.repository.enqueue(invoiceId, "CONCILIAR_FACTURA", `conciliar:${invoiceId}`, { facturaId: invoiceId }); await this.repository.completeJob(jobId); return;
    }
    const [branch, cuis, cufd] = await Promise.all([
      this.repository.branch(stringValue(invoice.sucursal_id, "Sucursal")),
      this.repository.cuis(stringValue(invoice.cuis_id, "CUIS")),
      this.repository.cufd(stringValue(invoice.cufd_id, "CUFD")),
    ]);
    assertActiveInvoiceFiscalCodes(invoice, cuis, cufd);
    const cuf = generateCuf({ nit: stringValue(config.nit, "NIT"), fechaEmision: stringValue(invoice.fecha_emision, "Fecha"), codigoSucursal: numberValue(invoice.codigo_sucursal, "Sucursal"), modalidad: invoice.modalidad === "ELECTRONICA" ? 1 : 2, tipoEmision: 1, tipoFactura: numberValue(invoice.tipo_factura, "Tipo factura"), documentoSector: numberValue(invoice.documento_sector, "Documento sector"), numeroFactura: stringValue(invoice.numero_factura, "Número factura"), codigoPuntoVenta: Number(invoice.codigo_punto_venta ?? 0), codigoControl: stringValue(cufd.codigo_control, "Código control CUFD") });
    const snapshot = this.snapshot(invoice, config, branch, cufd, cuf);
    await this.repository.updateInvoice(invoiceId, { estado_fiscal: "GENERANDO", cuf });
    let xml = generateInvoiceXml(snapshot); const electronic = snapshot.modalidad === "ELECTRONICA";
    const xsdName = electronic ? "facturaElectronicaCompraVenta.xsd" : "facturaComputarizadaCompraVenta.xsd";
    const xsd = await this.readArtifact(xsdName);
    if (electronic) {
      validateUnsignedElectronicInvoiceXml(xml, xsd);
      validateSignatureCredentials(this.secrets.privateKeyPem, this.secrets.certificatePem);
      xml = signInvoiceXml(xml, stringValue(this.secrets.privateKeyPem, "Clave privada"), stringValue(this.secrets.certificatePem, "Certificado"));
      if (!verifyInvoiceSignature(xml, stringValue(this.secrets.certificatePem, "Certificado"))) throw new Error("FIRMA_VERIFICACION_FALLIDA");
    }
    await this.repository.updateInvoice(invoiceId, { estado_fiscal: "VALIDANDO_XSD" });
    if (electronic) validateElectronicInvoiceXml(xml, xsd, await this.readArtifact("SignatureSchema.xsd")); else validateXmlAgainstXsd(xml, xsd);
    const compressed = await gzipBytes(xml); const hash = await sha256Hex(compressed); const xmlPath = `${snapshot.fechaEmision.slice(0, 7)}/${invoiceId}/${cuf}.xml.gz`;
    await this.repository.store(xmlPath, compressed, "application/gzip");
    await this.repository.updateInvoice(invoiceId, { estado_fiscal: "ENVIANDO", xml_documento: xml, xml_hash: hash, version_xsd: "23/08/2021", hash_xsd: XSD_HASH[snapshot.modalidad], xml_firmado: electronic, xml_storage_path: xmlPath, fecha_envio: new Date().toISOString(), cantidad_intentos: Number(invoice.cantidad_intentos ?? 0) + 1 });
    const attemptId = await this.repository.attempt({ outbox_id: jobId, factura_id: invoiceId, operacion: "RECEPCION_FACTURA", numero_intento: Number(job.intentos ?? 1), estado: "INICIADO", correlation_id: snapshot.correlationId, request_hash: hash });
    try {
      const response = await this.adapter.recepcionarFactura({ context: this.invoiceContext(config, invoice), cufd: snapshot.cufd, documentoSector: snapshot.documentoSector, tipoFactura: snapshot.tipoFactura, archivo: compressed, hashArchivo: hash, fechaEnvio: siatDateTime(new Date().toISOString()) });
      await this.handleReception(invoiceId, jobId, attemptId, snapshot, response);
    } catch (error) {
      if (error instanceof AmbiguousSiatError) {
        await this.repository.updateInvoice(invoiceId, { estado_fiscal: "SIN_RESPUESTA", ultimo_error_sanitizado: error.message });
        await this.repository.finishAttempt(attemptId, { estado: "AMBIGUO", error_sanitizado: error.message });
        await this.repository.enqueue(invoiceId, "CONCILIAR_FACTURA", `conciliar:${invoiceId}`, { facturaId: invoiceId });
        await this.repository.audit(invoiceId, "RESPUESTA_DESCONOCIDA", "ENVIANDO", "SIN_RESPUESTA", { correlationId: snapshot.correlationId });
        await this.repository.completeJob(jobId); return;
      }
      const message = errorMessage(error);
      if (/^SIAT_HTTP_\d+:|^SIAT_SOAP_FAULT:/.test(message)) {
        // Un Fault técnico no es un estado fiscal. Detener, nunca reenviar por backoff.
        await this.repository.updateInvoice(invoiceId, { estado_fiscal: "SIN_RESPUESTA", ultimo_error_sanitizado: message });
        await this.repository.finishAttempt(attemptId, { estado: "FALLIDO", error_sanitizado: message });
        await this.repository.audit(invoiceId, "ERROR_RECEPCION_SIN_ESTADO_FISCAL", "ENVIANDO", "SIN_RESPUESTA", { error: message, requiereConciliacion: true }, "FALLIDO");
        await this.repository.stopJob(jobId, message);
        return;
      }
      await this.repository.finishAttempt(attemptId, { estado: "REINTENTO", error_sanitizado: message });
      throw error;
    }
  }

  private async handleReception(invoiceId: string, jobId: string, attemptId: string, snapshot: InvoiceSnapshot, response: SiatResponse) {
    const outcome = classifyInvoiceReception(response);
    const { accepted, inconclusive, state } = outcome;
    const responseHash = await sha256Hex(new TextEncoder().encode(JSON.stringify(response.rawSanitizado)));
    const values: Record<string, unknown> = { estado_fiscal: state, codigo_recepcion: response.codigoRecepcion, codigo_estado: response.codigoEstado, codigo_descripcion: response.codigoDescripcion, transaccion: response.transaccion, mensajes_siat: response.mensajes, fecha_respuesta: new Date().toISOString(), ultimo_error_sanitizado: accepted ? null : response.mensajes.map((item) => item.descripcion).join("; ").slice(0, 500) };
    if (accepted) {
      Object.assign(values, await this.persistRepresentation(invoiceId, snapshot));
    }
    await this.repository.updateInvoice(invoiceId, values);
    await this.repository.finishAttempt(attemptId, { estado: accepted ? "EXITOSO" : inconclusive ? "AMBIGUO" : "FALLIDO", codigo_siat: response.codigoEstado, response_hash: responseHash, error_sanitizado: accepted ? null : String(values.ultimo_error_sanitizado) });
    await this.repository.audit(invoiceId, "RECEPCION_FACTURA", "ENVIANDO", state, { codigoRecepcion: response.codigoRecepcion, codigoEstado: response.codigoEstado });
    if (inconclusive) await this.repository.enqueue(invoiceId, "CONCILIAR_FACTURA", `conciliar:${invoiceId}`, { facturaId: invoiceId });
    await this.repository.completeJob(jobId);
  }

  async reconcile(job: Record<string, unknown>, options: { singleShot?: boolean; currentCufd?: Record<string, unknown> } = {}) {
    const invoiceId = stringValue(job.factura_id, "Factura"); const invoice = await this.repository.invoice(invoiceId); const config = await this.repository.configuration();
    if (!invoice.cuf) throw new Error("La factura no tiene CUF para conciliación.");
    if (options.singleShot) {
      // Operación dirigida sobre una tarea retenida: sin claim de cola ni recepción.
      const currentCufd = options.currentCufd;
      const now = Date.now();
      if (currentCufd && (currentCufd.estado !== "VIGENTE" || currentCufd.ambiente !== invoice.ambiente
        || currentCufd.sucursal_id !== invoice.sucursal_id || (currentCufd.punto_venta_id ?? null) !== (invoice.punto_venta_id ?? null)
        || currentCufd.cuis_id !== invoice.cuis_id || !String(currentCufd.codigo ?? "").trim()
        || !Number.isFinite(Date.parse(String(currentCufd.fecha_inicio ?? "")))
        || Date.parse(String(currentCufd.fecha_inicio)) > now
        || !Number.isFinite(Date.parse(String(currentCufd.fecha_expiracion ?? "")))
        || Date.parse(String(currentCufd.fecha_expiracion)) <= now)) throw new Error("CONCILIACION_CUFD_VIGENTE_NO_DISPONIBLE");
      const context = this.invoiceContext(config, invoice);
      if (currentCufd) context.cufd = String(currentCufd.codigo);
      const attemptId = await this.repository.attempt({ outbox_id: job.id, factura_id: invoiceId, operacion: "VERIFICACION_ESTADO_FACTURA", numero_intento: currentCufd ? 2 : 1, estado: "INICIADO", correlation_id: invoice.correlation_id });
      let response: SiatResponse;
      try {
        response = await this.adapter.verificarFactura(context, String(invoice.cuf), { retries: 0 });
      } catch (error) {
        const message = errorMessage(error);
        await this.repository.finishAttempt(attemptId, { estado: "AMBIGUO", error_sanitizado: message });
        await this.repository.updateInvoice(invoiceId, { estado_fiscal: "SIN_RESPUESTA", ultimo_error_sanitizado: message });
        await this.repository.audit(invoiceId, "CONCILIACION_UNICA_SIN_RESPUESTA", String(invoice.estado_fiscal), "SIN_RESPUESTA", { error: message }, "FALLIDO");
        return;
      }
      const state = response.codigoEstado === 908 && response.transaccion === true ? "VALIDADA"
        : response.codigoEstado === 904 ? "OBSERVADA" : "SIN_RESPUESTA";
      const responseHash = await sha256Hex(new TextEncoder().encode(JSON.stringify(response.rawSanitizado)));
      // Guardar la evidencia antes de cualquier representación u operación secundaria.
      await this.repository.finishAttempt(attemptId, { estado: state === "SIN_RESPUESTA" ? "AMBIGUO" : "EXITOSO", codigo_siat: response.codigoEstado, response_hash: responseHash });
      await this.repository.audit(invoiceId, currentCufd ? "CONCILIACION_CUFD_VIGENTE_UNICA" : "CONCILIACION_UNICA", String(invoice.estado_fiscal), state, { respuesta: response.rawSanitizado, codigoEstado: response.codigoEstado, transaccion: response.transaccion, cufdConsultaId: currentCufd?.id ?? invoice.cufd_id, cufdFacturaId: invoice.cufd_id });
      await this.repository.updateInvoice(invoiceId, { estado_fiscal: state, codigo_recepcion: response.codigoRecepcion ?? invoice.codigo_recepcion, codigo_estado: response.codigoEstado, codigo_descripcion: response.codigoDescripcion, mensajes_siat: response.mensajes, transaccion: response.transaccion, fecha_respuesta: new Date().toISOString(), ultimo_error_sanitizado: state === "SIN_RESPUESTA" ? "Consulta oficial sin estado fiscal concluyente; reenvío bloqueado." : null });
      return response;
    }
    await this.repository.updateInvoice(invoiceId, { estado_fiscal: "CONCILIANDO" });
    const response = await this.adapter.verificarFactura(this.invoiceContext(config, invoice), String(invoice.cuf));
    const description = `${response.codigoDescripcion ?? ""} ${response.mensajes.map((item) => item.descripcion).join(" ")}`.toUpperCase();
    const state = response.codigoEstado === 908 && response.transaccion === true ? "VALIDADA"
      : response.codigoEstado === 904 ? "OBSERVADA"
      : response.transaccion === false && description.includes("RECHAZ") ? "RECHAZADA"
      : null;
    if (!state) throw new Error("La consulta al SIN no devolvió un estado fiscal concluyente; se reintentará solo la verificación.");
    const values: Record<string, unknown> = { estado_fiscal: state, codigo_recepcion: response.codigoRecepcion ?? invoice.codigo_recepcion, codigo_estado: response.codigoEstado, codigo_descripcion: response.codigoDescripcion, mensajes_siat: response.mensajes, transaccion: response.transaccion, fecha_respuesta: new Date().toISOString(), ultimo_error_sanitizado: null };
    if (state === "VALIDADA" && !invoice.pdf_storage_path) {
      const [branch, cufd] = await Promise.all([
        this.repository.branch(stringValue(invoice.sucursal_id, "Sucursal")),
        this.repository.cufd(stringValue(invoice.cufd_id, "CUFD")),
      ]);
      Object.assign(values, await this.persistRepresentation(invoiceId, this.snapshot(invoice, config, branch, cufd, String(invoice.cuf))));
    }
    await this.repository.updateInvoice(invoiceId, values);
    await this.repository.audit(invoiceId, "CONCILIACION", "CONCILIANDO", state, { codigoEstado: response.codigoEstado }); await this.repository.completeJob(String(job.id));
  }

  async cancel(job: Record<string, unknown>) {
    const invoiceId = stringValue(job.factura_id, "Factura"); const invoice = await this.repository.invoice(invoiceId); const payload = objectValue(job.payload); const config = await this.repository.configuration();
    if (invoice.estado_fiscal !== "ANULACION_PENDIENTE") throw new Error("La factura no está pendiente de anulación.");
    assertFiscalOperationAllowed(invoice, payload, "ANULAR");
    const context = await this.currentInvoiceContext(config, invoice, payload); const cuf = stringValue(invoice.cuf, "CUF"); const motivo = numberValue(payload.motivo, "Motivo");
    const unknown = async (message: string, response?: SiatResponse) => {
      await this.repository.updateInvoice(invoiceId, { ultimo_error_sanitizado: message, ...(response ? { respuesta_anulacion: response.rawSanitizado, mensajes_siat: response.mensajes } : {}) });
      await this.repository.enqueue(invoiceId, "CONCILIAR_ANULACION", `conciliar_anulacion:${invoiceId}:${String(job.id)}`, { facturaId: invoiceId, sucursalOperacionId: payload.sucursalOperacionId ?? null, puntoVentaOperacionId: payload.puntoVentaOperacionId ?? null });
      await this.repository.audit(invoiceId, "ANULACION_RESPUESTA_DESCONOCIDA", "ANULACION_PENDIENTE", "ANULACION_PENDIENTE", {});
      await this.repository.completeJob(String(job.id)); return;
    };
    if (!this.prepareOperationEvidence) throw new Error("SOAP_EVIDENCIA_NO_CONFIGURADA");
    const capture = await this.prepareOperationEvidence(invoiceId, "ANULACION", stringValue(job.id, "Intento"));
    if (!await this.repository.markFiscalMutationStarted(job)) return unknown("Transmisión ya iniciada; requiere conciliación sin reenvío.");
    let response: SiatResponse;
    try { response = await this.adapter.anularFactura(context, cuf, motivo, capture); }
    catch (error) { return unknown(errorMessage(error)); }
    if (response.transaccion === false && response.codigoEstado === 906) {
      await this.repository.updateInvoice(invoiceId, { respuesta_anulacion: response.rawSanitizado, mensajes_siat: response.mensajes, ultimo_error_sanitizado: "Anulación rechazada por el SIN; requiere revisión administrativa." });
      await this.repository.audit(invoiceId, "ANULACION_RECHAZADA_REVISION", "ANULACION_PENDIENTE", "ANULACION_PENDIENTE", { codigoEstado: 906, respuesta: response.rawSanitizado }, "FALLIDO");
      await this.repository.stopJob(String(job.id), "ANULACION_RECHAZADA_REQUIERE_REVISION"); return;
    }
    if (response.transaccion !== true || response.codigoEstado !== 905) return unknown("Respuesta de anulación no concluyente; requiere conciliación.", response);
    const state = "ANULADA";
    await this.repository.updateInvoice(invoiceId, { estado_fiscal: state, respuesta_anulacion: response.rawSanitizado, mensajes_siat: response.mensajes });
    await this.repository.audit(invoiceId, "ANULACION", "ANULACION_PENDIENTE", state, { motivo: payload.motivo, codigoEstado: response.codigoEstado }); await this.repository.completeJob(String(job.id));
  }

  async reverse(job: Record<string, unknown>) {
    const invoiceId = stringValue(job.factura_id, "Factura"); const invoice = await this.repository.invoice(invoiceId); const config = await this.repository.configuration(); const payload = objectValue(job.payload);
    if (invoice.estado_fiscal !== "REVERSION_PENDIENTE") throw new Error("La factura no está pendiente de reversión.");
    assertFiscalOperationAllowed(invoice, payload, "REVERTIR_ANULACION");
    const context = await this.currentInvoiceContext(config, invoice, payload); const cuf = stringValue(invoice.cuf, "CUF");
    const unknown = async (message: string, response?: SiatResponse) => {
      await this.repository.updateInvoice(invoiceId, { ultimo_error_sanitizado: message, ...(response ? { respuesta_reversion: response.rawSanitizado, mensajes_siat: response.mensajes } : {}) });
      await this.repository.enqueue(invoiceId, "CONCILIAR_REVERSION", `conciliar_reversion:${invoiceId}:${String(job.id)}`, { facturaId: invoiceId, sucursalOperacionId: payload.sucursalOperacionId ?? null, puntoVentaOperacionId: payload.puntoVentaOperacionId ?? null });
      await this.repository.audit(invoiceId, "REVERSION_RESPUESTA_DESCONOCIDA", "REVERSION_PENDIENTE", "REVERSION_PENDIENTE", {});
      await this.repository.completeJob(String(job.id)); return;
    };
    if (!this.prepareOperationEvidence) throw new Error("SOAP_EVIDENCIA_NO_CONFIGURADA");
    const capture = await this.prepareOperationEvidence(invoiceId, "REVERSION", stringValue(job.id, "Intento"));
    if (!await this.repository.markFiscalMutationStarted(job)) return unknown("Transmisión ya iniciada; requiere conciliación sin reenvío.");
    let response: SiatResponse;
    try { response = await this.adapter.revertirAnulacion(context, cuf, capture); }
    catch (error) { return unknown(errorMessage(error)); }
    const problems = reversalProblemCodes(response);
    if (response.transaccion === false && response.codigoEstado !== 907 && problems.length) {
      await this.repository.updateInvoice(invoiceId, { respuesta_reversion: response.rawSanitizado, mensajes_siat: response.mensajes, ultimo_error_sanitizado: `Reversión rechazada por el SIN (${problems.join(", ")}); requiere revisión administrativa.` });
      await this.repository.audit(invoiceId, "REVERSION_RECHAZADA_REVISION", "REVERSION_PENDIENTE", "REVERSION_PENDIENTE", { codigoEstado: response.codigoEstado, codigosRespuesta: problems, respuesta: response.rawSanitizado }, "FALLIDO");
      await this.repository.stopJob(String(job.id), "REVERSION_RECHAZADA_REQUIERE_REVISION"); return;
    }
    if (response.transaccion !== true || response.codigoEstado !== 907 || problems.length) return unknown("Respuesta de reversión no concluyente; requiere conciliación.", response);
    const state = "REVERTIDA";
    await this.repository.updateInvoice(invoiceId, { estado_fiscal: state, fecha_reversion: response.transaccion ? new Date().toISOString() : null, respuesta_reversion: response.rawSanitizado, mensajes_siat: response.mensajes });
    await this.repository.audit(invoiceId, "REVERSION_ANULACION", "REVERSION_PENDIENTE", state, { codigoEstado: response.codigoEstado }); await this.repository.completeJob(String(job.id));
  }

  async reconcileFiscalOperation(job: Record<string, unknown>, operation: "ANULACION" | "REVERSION") {
    const invoiceId = stringValue(job.factura_id, "Factura"); const invoice = await this.repository.invoice(invoiceId); const config = await this.repository.configuration();
    const previous = operation === "ANULACION" ? "ANULACION_PENDIENTE" : "REVERSION_PENDIENTE";
    if (invoice.estado_fiscal !== previous) throw new Error("La factura ya no está pendiente de esta operación fiscal.");
    let response: SiatResponse;
    try { response = await this.adapter.verificarFactura(await this.currentInvoiceContext(config, invoice, objectValue(job.payload)), stringValue(invoice.cuf, "CUF"), { retries: 0 }); }
    catch (error) {
      await this.repository.audit(invoiceId, `CONCILIACION_${operation}_INCIERTA`, previous, previous, { error: errorMessage(error) }, "FALLIDO");
      await this.repository.stopJob(String(job.id), "CONCILIACION_REQUIERE_REVISION_ADMINISTRATIVA"); return;
    }
    // Los códigos 905/907 documentan la respuesta de mutación, no una correspondencia
    // comprobada para la respuesta de verificacionEstadoFactura. Conservar evidencia.
    await this.repository.audit(invoiceId, `CONCILIACION_${operation}_REVISION`, previous, previous,
      { codigoEstado: response.codigoEstado, transaccion: response.transaccion, respuesta: response.rawSanitizado }, "FALLIDO");
    await this.repository.stopJob(String(job.id), "CONCILIACION_REQUIERE_REVISION_ADMINISTRATIVA");
  }

  async registerEvent(job: Record<string, unknown>) {
    const payload = objectValue(job.payload); const eventId = stringValue(payload.eventoId, "Evento");
    const event = await this.repository.event(eventId); const config = await this.repository.configuration();
    if (event.codigo_recepcion) {
      await this.repository.enqueue(null, "GENERAR_PAQUETES_EVENTO", `generar_paquetes:${eventId}`, { eventoId: eventId });
      await this.repository.completeJob(String(job.id)); return;
    }
    const branch = await this.repository.branch(stringValue(event.sucursal_id, "Sucursal"));
    const point = event.punto_venta_id ? await this.repository.point(String(event.punto_venta_id)) : null;
    const oldCufd = await this.repository.cufd(stringValue(event.cufd_id, "CUFD del evento"));
    assertEventFiscalCode(event, oldCufd, config.ambiente);
    assertEventReadyForRegistration(event);
    let codes;
    try {
      codes = await this.repository.activeFiscalCodes(String(event.sucursal_id), event.punto_venta_id ? String(event.punto_venta_id) : null, String(config.ambiente));
      assertRecoveryCufd(event, codes.cufd);
    } catch (error) {
      if (!/CUFD_NUEVO_RECUPERACION_REQUERIDO|CUFD nuevo vigente no encontrado/.test(errorMessage(error))) throw error;
      const cuis = await this.repository.activeCuisForScope(String(event.sucursal_id), event.punto_venta_id ? String(event.punto_venta_id) : null, String(config.ambiente));
      if (!await this.repository.markRecoveryCufdStarted(String(job.id))) throw new Error("CUFD_RECUPERACION_INCIERTO_REVISION_MANUAL", { cause: error });
      // El marcador persiste antes de la solicitud: un timeout nunca crea otro CUFD automáticamente.
      const result = await this.adapter.solicitarCufd(this.context(config, {
        codigoSucursal: numberValue(branch.codigo, "Sucursal"), codigoPuntoVenta: point ? numberValue(point.codigo, "Punto de venta") : null,
        cuis: stringValue(cuis.codigo, "CUIS"),
      }));
      if (result.transaccion !== true || !result.codigo || !result.codigoControl || !Number.isFinite(Date.parse(result.fechaVigencia)) || Date.parse(result.fechaVigencia) <= Date.now()) throw new Error("CUFD_RECUPERACION_INCIERTO_REVISION_MANUAL", { cause: error });
      await this.repository.saveCufd({ ...config, sucursal_predeterminada_id: event.sucursal_id, punto_venta_predeterminado_id: event.punto_venta_id ?? null }, String(cuis.id), result);
      codes = await this.repository.activeFiscalCodes(String(event.sucursal_id), event.punto_venta_id ? String(event.punto_venta_id) : null, String(config.ambiente));
      assertRecoveryCufd(event, codes.cufd);
    }
    const context = this.context(config, {
      codigoSucursal: numberValue(branch.codigo, "Sucursal"), codigoPuntoVenta: point ? numberValue(point.codigo, "Punto de venta") : null,
      cuis: stringValue(codes.cuis.codigo, "CUIS"), cufd: stringValue(codes.cufd.codigo, "CUFD nuevo"),
    });
    const input = {
        context, codigoEvento: numberValue(event.tipo_evento_codigo, "Tipo de evento"),
        descripcion: stringValue(event.descripcion, "Descripción del evento"),
        fechaInicioEvento: siatDateTime(stringValue(event.fecha_inicio, "Inicio del evento")),
        fechaFinEvento: siatDateTime(stringValue(event.fecha_fin, "Fin del evento")),
        cufdEvento: stringValue(oldCufd.codigo, "CUFD del evento"),
    };
    const unknown = async (message: string, response?: SiatResponse) => {
      await this.repository.updateEvent(eventId, { estado: "SIN_RESPUESTA", ultimo_error_sanitizado: message, ...(response ? { respuesta_siat: response.rawSanitizado } : {}) });
      await this.repository.enqueue(null, "CONCILIAR_EVENTO", `conciliar_evento:${eventId}`, { eventoId: eventId });
      await this.repository.auditEntity("siat_eventos_significativos", eventId, "EVENTO_RESPUESTA_DESCONOCIDA", "ENVIANDO", "SIN_RESPUESTA", {});
      await this.repository.completeJob(String(job.id));
    };
    if (!await this.repository.markFiscalMutationStarted(job)) return unknown("Transmisión ya iniciada; requiere conciliación sin reenvío.");
    await this.repository.updateEvent(eventId, { estado: "ENVIANDO", cufd_envio_id: codes.cufd.id, ultimo_error_sanitizado: null });
    let response: SiatResponse;
    try { response = await this.adapter.registrarEvento(input); }
    catch (error) { return unknown(errorMessage(error)); }
    if (response.transaccion !== true || !response.codigoRecepcion) return unknown("Respuesta del evento no concluyente; requiere conciliación.", response);
    await this.repository.updateEvent(eventId, { estado: "ENVIADO", codigo_recepcion: response.codigoRecepcion, respuesta_siat: response.rawSanitizado, ultimo_error_sanitizado: null });
    await this.repository.auditEntity("siat_eventos_significativos", eventId, "REGISTRO_EVENTO_SIN", "ENVIANDO", "ENVIADO", { codigoRecepcion: response.codigoRecepcion });
    await this.repository.enqueue(null, "GENERAR_PAQUETES_EVENTO", `generar_paquetes:${eventId}`, { eventoId: eventId });
    await this.repository.completeJob(String(job.id));
  }

  async reconcileEvent(job: Record<string, unknown>) {
    const eventId = stringValue(objectValue(job.payload).eventoId, "Evento"); const event = await this.repository.event(eventId);
    const config = await this.repository.configuration(); const branch = await this.repository.branch(stringValue(event.sucursal_id, "Sucursal"));
    const point = event.punto_venta_id ? await this.repository.point(String(event.punto_venta_id)) : null;
    const codes = await this.repository.activeFiscalCodes(String(event.sucursal_id), event.punto_venta_id ? String(event.punto_venta_id) : null, String(config.ambiente));
    const context = this.context(config, { codigoSucursal: numberValue(branch.codigo, "Sucursal"), codigoPuntoVenta: point ? numberValue(point.codigo, "Punto de venta") : null, cuis: stringValue(codes.cuis.codigo, "CUIS"), cufd: stringValue(codes.cufd.codigo, "CUFD") });
    await this.repository.updateEvent(eventId, { estado: "CONCILIANDO" });
    const result = await this.adapter.consultarEventos(context, siatDateTime(stringValue(event.fecha_inicio, "Inicio del evento")).slice(0, 10));
    const expectedCode = String(event.tipo_evento_codigo); const expectedDescription = String(event.descripcion).trim().toUpperCase();
    const matches = result.eventos.map(objectValue).filter((item) => String(item.codigoEvento ?? item.codigo ?? "") === expectedCode && String(item.descripcion ?? "").trim().toUpperCase() === expectedDescription
      && String(item.fechaHoraInicioEvento ?? "") === siatDateTime(String(event.fecha_inicio))
      && String(item.fechaHoraFinEvento ?? "") === siatDateTime(String(event.fecha_fin)));
    const found = result.response.transaccion === true && matches.length === 1 ? matches[0] : undefined;
    const reception = found ? String(found.codigoRecepcion ?? found.codigoRecepcionEvento ?? "") : "";
    if (!found || !reception) throw new Error("La consulta oficial todavía no confirma el evento; no se repetirá su registro.");
    await this.repository.updateEvent(eventId, { estado: "ENVIADO", codigo_recepcion: reception, respuesta_siat: result.response.rawSanitizado, ultimo_error_sanitizado: null, cufd_envio_id: codes.cufd.id });
    await this.repository.enqueue(null, "GENERAR_PAQUETES_EVENTO", `generar_paquetes:${eventId}`, { eventoId: eventId });
    await this.repository.auditEntity("siat_eventos_significativos", eventId, "CONCILIACION_EVENTO", "CONCILIANDO", "ENVIADO", { codigoRecepcion: reception });
    await this.repository.completeJob(String(job.id));
  }

  async buildEventPackages(job: Record<string, unknown>) {
    const eventId = stringValue(objectValue(job.payload).eventoId, "Evento"); const invoices = await this.repository.offlineInvoices(eventId);
    if (!invoices.length) { await this.repository.completeJob(String(job.id)); return; }
    const groups = new Map<string, Array<Record<string, unknown>>>();
    for (const invoice of invoices) {
      const key = [invoice.documento_sector, invoice.sucursal_id, invoice.punto_venta_id ?? "", invoice.cufd_id, invoice.modalidad, invoice.cafc_id ?? ""].join("|");
      groups.set(key, [...(groups.get(key) ?? []), invoice]);
    }
    // La RPC exige ENVIADO y bloquea el evento mientras asigna facturas.
    for (const values of groups.values()) {
      for (let index = 0; index < values.length; index += 500) {
        const chunk = values.slice(index, index + 500);
        const documents = await Promise.all(chunk.map(async (invoice, position) => {
          const compressedXml = await this.repository.download(stringValue(invoice.xml_storage_path, "XML fiscal privado"));
          const expectedHash = stringValue(invoice.xml_hash, "Hash XML").toUpperCase();
          if (await sha256Hex(compressedXml) !== expectedHash) throw new Error("XML_OFFLINE_HASH_NO_COINCIDE");
          return { name: `${String(position + 1).padStart(3, "0")}_${stringValue(invoice.cuf, "CUF")}.xml`, content: await gunzipBytes(compressedXml) };
        }));
        const tar = createTar(documents);
        const compressed = await gzipBytes(tar); const hash = await sha256Hex(compressed);
        const path = `${String(chunk[0].fecha_emision).slice(0, 7)}/eventos/${eventId}/paquetes/${hash}.tar.gz`;
        await this.repository.store(path, compressed, "application/gzip");
        await this.repository.createPackage(eventId, chunk.map((invoice) => String(invoice.id)), hash, path);
      }
    }
    await this.repository.updateEvent(eventId, { estado: "VALIDANDO" });
    await this.repository.completeJob(String(job.id));
  }

  async sendPackage(job: Record<string, unknown>) {
    const packageId = stringValue(objectValue(job.payload).paqueteId, "Paquete"); const fiscalPackage = await this.repository.package(packageId);
    if (fiscalPackage.codigo_recepcion) {
      await this.repository.enqueue(null, "VALIDAR_PAQUETE", `validar_paquete:${packageId}`, { paqueteId: packageId });
      await this.repository.completeJob(String(job.id)); return;
    }
    const event = await this.repository.event(stringValue(fiscalPackage.evento_id, "Evento")); const config = await this.repository.configuration();
    if (!event.cufd_id || event.cufd_id !== fiscalPackage.cufd_evento_id || (event.cafc_id ?? null) !== (fiscalPackage.cafc_id ?? null)) throw new Error("PAQUETE_EVENTO_CUFD_O_CAFC_NO_CORRESPONDE");
    const branch = await this.repository.branch(stringValue(fiscalPackage.sucursal_id, "Sucursal")); const point = fiscalPackage.punto_venta_id ? await this.repository.point(String(fiscalPackage.punto_venta_id)) : null;
    const codes = await this.repository.activeFiscalCodes(String(fiscalPackage.sucursal_id), fiscalPackage.punto_venta_id ? String(fiscalPackage.punto_venta_id) : null, String(config.ambiente));
    assertRecoveryCufd(event, codes.cufd);
    const context = this.context(config, { codigoSucursal: numberValue(branch.codigo, "Sucursal"), codigoPuntoVenta: point ? numberValue(point.codigo, "Punto de venta") : null, cuis: stringValue(codes.cuis.codigo, "CUIS"), cufd: stringValue(codes.cufd.codigo, "CUFD"), documentoSector: numberValue(fiscalPackage.documento_sector, "Documento sector"), tipoFactura: numberValue(config.tipo_factura, "Tipo factura") });
    assertEventReadyForRegistration(event);
    const bytes = await this.repository.download(stringValue(fiscalPackage.storage_path, "Archivo del paquete"));
    if (await sha256Hex(bytes) !== stringValue(fiscalPackage.archivo_hash, "Hash").toUpperCase()) throw new Error("PAQUETE_HASH_NO_COINCIDE");
    const cafc = fiscalPackage.cafc_id ? await this.repository.cafc(String(fiscalPackage.cafc_id)) : null;
    const input = { context, cufd: stringValue(codes.cufd.codigo, "CUFD"), documentoSector: numberValue(fiscalPackage.documento_sector, "Documento sector"), tipoFactura: numberValue(config.tipo_factura, "Tipo factura"), archivo: bytes, hashArchivo: stringValue(fiscalPackage.archivo_hash, "Hash"), fechaEnvio: siatDateTime(new Date().toISOString()), cafc: cafc ? stringValue(cafc.autorizacion, "CAFC") : null, cantidadFacturas: numberValue(fiscalPackage.cantidad_facturas, "Cantidad"), codigoEvento: stringValue(event.codigo_recepcion, "Código de evento") };
    const unknown = async (message: string, response?: SiatResponse) => {
      await this.repository.updatePackage(packageId, { estado: "SIN_RESPUESTA", ultimo_error: message, ...(response ? { respuesta_siat: response.rawSanitizado, mensajes_siat: response.mensajes } : {}) });
      await this.repository.auditEntity("siat_paquetes", packageId, "PAQUETE_RESPUESTA_DESCONOCIDA", "ENVIADO", "SIN_RESPUESTA", {});
      await this.repository.completeJob(String(job.id));
    };
    if (!await this.repository.markFiscalMutationStarted(job)) return unknown("Transmisión ya iniciada; revisión manual sin reenvío.");
    await this.repository.updatePackage(packageId, { estado: "ENVIADO", intentos: Number(fiscalPackage.intentos ?? 0) + 1, fecha_envio: new Date().toISOString() });
    let response: SiatResponse;
    try { response = await this.adapter.recepcionarPaquete(input); }
    catch (error) { return unknown(errorMessage(error)); }
    if (response.transaccion !== true || response.codigoEstado !== 901 || !response.codigoRecepcion) return unknown("Respuesta de paquete no concluyente; revisión manual sin reenvío.", response);
    await this.repository.updatePackage(packageId, { estado: "RECEPCIONADO", codigo_recepcion: response.codigoRecepcion, respuesta_siat: response.rawSanitizado, mensajes_siat: response.mensajes });
    await this.repository.enqueue(null, "VALIDAR_PAQUETE", `validar_paquete:${packageId}`, { paqueteId: packageId });
    await this.repository.completeJob(String(job.id));
  }

  async validatePackage(job: Record<string, unknown>) {
    const packageId = stringValue(objectValue(job.payload).paqueteId, "Paquete"); const fiscalPackage = await this.repository.package(packageId);
    const reception = stringValue(fiscalPackage.codigo_recepcion, "Código de recepción del paquete"); const config = await this.repository.configuration();
    const branch = await this.repository.branch(stringValue(fiscalPackage.sucursal_id, "Sucursal")); const point = fiscalPackage.punto_venta_id ? await this.repository.point(String(fiscalPackage.punto_venta_id)) : null;
    const codes = await this.repository.activeFiscalCodes(String(fiscalPackage.sucursal_id), fiscalPackage.punto_venta_id ? String(fiscalPackage.punto_venta_id) : null, String(config.ambiente));
    const context = this.context(config, { codigoSucursal: numberValue(branch.codigo, "Sucursal"), codigoPuntoVenta: point ? numberValue(point.codigo, "Punto de venta") : null, cuis: stringValue(codes.cuis.codigo, "CUIS"), cufd: stringValue(codes.cufd.codigo, "CUFD"), documentoSector: numberValue(fiscalPackage.documento_sector, "Documento sector"), tipoFactura: numberValue(config.tipo_factura, "Tipo factura") });
    await this.repository.updatePackage(packageId, { estado: "VALIDANDO" });
    const response = await this.adapter.validarPaquete(context, reception);
    if (response.codigoEstado === 901) throw new Error("Paquete pendiente de validación oficial (901).");
    if ((response.codigoEstado !== 908 && response.codigoEstado !== 904) || (response.codigoEstado === 908 && response.transaccion !== true)) throw new Error(response.mensajes.map((item) => item.descripcion).join("; ") || "Estado de paquete no concluyente.");
    const valid = response.codigoEstado === 908;
    if (valid) {
      if (response.mensajes.some((item) => item.numeroArchivo != null || item.numeroDetalle != null)) throw new Error("PAQUETE_908_CON_RESULTADOS_INDIVIDUALES_REQUIERE_REVISION");
      assertCompletePackageLinks(fiscalPackage.cantidad_facturas, await this.repository.packageInvoices(packageId));
    }
    await this.repository.updatePackage(packageId, { estado: valid ? "VALIDADO" : "OBSERVADO", fecha_validacion: new Date().toISOString(), respuesta_siat: response.rawSanitizado, mensajes_siat: response.mensajes, ultimo_error: valid ? null : response.mensajes.map((item) => item.descripcion).join("; ").slice(0, 500) });
    // 904 describe el paquete y puede identificar solo algunas facturas: no inferir
    // que cada documento está observado o validado sin consulta individual.
    if (valid) await this.repository.finishPackage(packageId, "VALIDADA", response.mensajes);
    else {
      const links = await this.repository.packageInvoices(packageId);
      for (const link of links) {
        const facturaId = stringValue(link.factura.id, "Factura del paquete");
        await this.repository.enqueue(facturaId, "CONCILIAR_FACTURA_PAQUETE", `conciliar_paquete:${packageId}:${facturaId}`, { paqueteId: packageId });
      }
    }
    await this.repository.auditEntity("siat_paquetes", packageId, "VALIDACION_PAQUETE", "VALIDANDO", valid ? "VALIDADO" : "OBSERVADO", { codigoEstado: response.codigoEstado, codigoRecepcion: reception }, valid ? "EXITOSO" : "OBSERVADO");
    await this.repository.refreshEventFromPackages(String(fiscalPackage.evento_id));
    await this.repository.completeJob(String(job.id));
  }

  async reconcilePackageInvoice(job: Record<string, unknown>) {
    const invoiceId = stringValue(job.factura_id, "Factura");
    const packageId = stringValue(objectValue(job.payload).paqueteId, "Paquete");
    const fiscalPackage = await this.repository.package(packageId);
    if (fiscalPackage.estado !== "OBSERVADO") throw new Error("PAQUETE_NO_OBSERVADO");
    const links = await this.repository.packageInvoices(packageId);
    const link = links.find((item) => String(item.factura.id) === invoiceId);
    if (!link) throw new Error("FACTURA_NO_PERTENECE_AL_PAQUETE");
    const invoice = await this.repository.invoice(invoiceId);
    if (invoice.estado_fiscal !== "EMPAQUETADA") { await this.repository.completeJob(String(job.id)); return; }
    const config = await this.repository.configuration();
    const response = await this.adapter.verificarFactura(await this.currentInvoiceContext(config, invoice), stringValue(invoice.cuf, "CUF"), { retries: 0 });
    const result = classifyInvoiceReception(response);
    if (result.inconclusive) {
      await this.repository.audit(invoiceId, "CONCILIACION_FACTURA_PAQUETE_INCIERTA", "EMPAQUETADA", "EMPAQUETADA", { paqueteId: packageId, posicion: link.posicion, codigoEstado: response.codigoEstado, transaccion: response.transaccion, respuesta: response.rawSanitizado });
      await this.repository.completeJob(String(job.id)); return;
    }
    const updated = await this.repository.updateInvoiceIfState(invoiceId, "EMPAQUETADA", { estado_fiscal: result.state, codigo_estado: response.codigoEstado, transaccion: response.transaccion,
      mensajes_siat: response.mensajes, ...(result.accepted ? { codigo_recepcion: response.codigoRecepcion, fecha_validacion: new Date().toISOString() } : {}) });
    if (!updated) { await this.repository.completeJob(String(job.id)); return; }
    await this.repository.audit(invoiceId, "CONCILIACION_FACTURA_PAQUETE", "EMPAQUETADA", result.state, { paqueteId: packageId, posicion: link.posicion, codigoEstado: response.codigoEstado, respuesta: response.rawSanitizado });
    await this.repository.refreshEventFromPackages(String(fiscalPackage.evento_id));
    await this.repository.completeJob(String(job.id));
  }

  async requestCuis(job: Record<string, unknown>) {
    const config = await this.repository.configuration(); const branch = await this.repository.branch(stringValue(config.sucursal_predeterminada_id, "Sucursal predeterminada"));
    const point = config.punto_venta_predeterminado_id ? await this.repository.point(String(config.punto_venta_predeterminado_id)) : null;
    if (config.modalidad !== "ELECTRONICA") throw new Error("La solicitud CUIS piloto requiere modalidad ELECTRONICA (código 1).");
    stringValue(config.documento_sector, "Documento sector");
    const context = this.context(config, { codigoSucursal: numberValue(branch.codigo, "Sucursal"), codigoPuntoVenta: point ? numberValue(point.codigo, "Punto de venta") : null, cuis: "" }); const result = await this.adapter.solicitarCuis(context);
    if (!result.transaccion || !result.codigo || !result.fechaVigencia || Number.isNaN(new Date(result.fechaVigencia).getTime())) throw new Error(result.mensajes.map((item) => item.descripcion).join("; ") || "El SIN no entregó un CUIS con vigencia válida.");
    await this.repository.saveCuis(config, { codigo: result.codigo, fechaVigencia: result.fechaVigencia });
    await this.repository.auditEntity("siat_cuis", String(config.sucursal_predeterminada_id), "CUIS_OBTENIDO", null, "VIGENTE", { ambiente: config.ambiente, sucursalId: config.sucursal_predeterminada_id, puntoVentaId: config.punto_venta_predeterminado_id ?? null, fechaVigencia: result.fechaVigencia });
    await this.repository.completeJob(String(job.id));
  }

  async requestCufd(job: Record<string, unknown>) {
    const config = await this.repository.configuration();
    if (config.ambiente !== "PRUEBAS" || config.modalidad !== "ELECTRONICA" || numberValue(config.documento_sector, "Documento sector") !== 1 || numberValue(config.tipo_factura, "Tipo factura") !== 1) throw new Error("La configuracion fiscal del piloto debe ser PRUEBAS, ELECTRONICA, documento sector 1 y tipo factura 1.");
    const branch = await this.repository.branch(stringValue(config.sucursal_predeterminada_id, "Sucursal predeterminada"));
    if (numberValue(branch.codigo, "Sucursal") !== 0) throw new Error("El piloto CUFD requiere la sucursal Casa Matriz con codigo 0.");
    const point = config.punto_venta_predeterminado_id ? await this.repository.point(String(config.punto_venta_predeterminado_id)) : null;
    if (point && numberValue(point.codigo, "Punto de venta") !== 0) throw new Error("El piloto CUFD requiere el punto de venta con codigo 0.");
    const cuis = await this.repository.activeCuis(config);
    if (!cuis) throw new Error("Se requiere un CUIS vigente antes de solicitar CUFD.");
    const existing = await this.repository.activeCufd(config, stringValue(cuis.id, "CUIS"));
    if (existing) { await this.repository.completeJob(String(job.id)); return; }
    const context = this.context(config, { codigoSucursal: numberValue(branch.codigo, "Sucursal"), codigoPuntoVenta: point ? numberValue(point.codigo, "Punto de venta") : null, cuis: stringValue(cuis.codigo, "CUIS") });
    const result = await this.adapter.solicitarCufd(context);
    if (!result.transaccion || !result.codigo || !result.codigoControl || !result.fechaVigencia) throw new Error(result.mensajes.map((item) => item.descripcion).join("; ") || "El SIN no entregó CUFD.");
    const fechaPrueba = new Date(Date.now() + Number(config.desfase_hora_sin_ms ?? 0));
    const cufPrueba = generateCuf({ nit: stringValue(config.nit, "NIT"), fechaEmision: fechaPrueba, codigoSucursal: 0, modalidad: 1, tipoEmision: 1, tipoFactura: 1, documentoSector: 1, numeroFactura: 1, codigoPuntoVenta: 0, codigoControl: result.codigoControl });
    if (!cufPrueba.endsWith(result.codigoControl.toUpperCase())) throw new Error("La validacion local del CUF no incorporo el codigo de control.");
    await this.repository.auditEntity("siat_configuracion", "true", "VALIDAR_CUF_SIN_EMISION", null, null, { numeroFacturaPrueba: 1, fechaEmision: fechaPrueba.toISOString(), longitudCuf: cufPrueba.length, codigoControlIncorporado: true });
    await this.repository.saveCufd(config, stringValue(cuis.id, "CUIS"), { codigo: result.codigo, codigoControl: result.codigoControl, direccion: result.direccion, fechaVigencia: result.fechaVigencia });
    await this.repository.completeJob(String(job.id));
  }

  async synchronize(job: Record<string, unknown>) {
    const config = await this.repository.configuration(); const branch = await this.repository.branch(stringValue(config.sucursal_predeterminada_id, "Sucursal predeterminada")); const cuis = await this.repository.activeCuis(config); const point = config.punto_venta_predeterminado_id ? await this.repository.point(String(config.punto_venta_predeterminado_id)) : null;
    if (!cuis) throw new Error("Se requiere un CUIS vigente para sincronizar.");
    const context = this.context(config, { codigoSucursal: numberValue(branch.codigo, "Sucursal"), codigoPuntoVenta: point ? numberValue(point.codigo, "Punto de venta") : null, cuis: stringValue(cuis.codigo, "CUIS") });
    const time = await this.adapter.sincronizarFechaHora(context);
    if (time.response.transaccion !== true) throw new Error(time.response.mensajes.map((item) => item.descripcion).join("; ") || "El SIN no confirmó la fecha y hora.");
    const offset = new Date(time.fechaHora).getTime() - Date.now();
    if (Number.isNaN(offset)) throw new Error("El SIN devolvió una fecha y hora inválida.");
    const catalogPayload = objectValue(job.payload).catalogos;
    const requestedCatalogs = Array.isArray(catalogPayload) ? catalogPayload.filter((value): value is string => typeof value === "string") : [];
    const operations = requestedCatalogs.length ? catalogOperations.filter(([code]) => requestedCatalogs.includes(code)) : catalogOperations;
    if (requestedCatalogs.length && operations.length !== requestedCatalogs.length) throw new Error("La tarea contiene catálogos SIAT no permitidos.");
    const correlationId = crypto.randomUUID(); let completed = 0; const failures: string[] = [];
    for (const [code, name, operation] of operations) {
      try {
        const result = await this.adapter.sincronizarCatalogo(context, operation);
        if (result.response.transaccion !== true) throw new Error(result.response.mensajes.map((item) => item.descripcion).join("; ") || `El SIN no confirmó el catálogo ${code}.`);
        const items = result.items.map((raw) => catalogItem(code, raw));
        if (!items.length) throw new Error(`El SIN devolvió el catálogo ${code} vacío.`);
        if (items.some((item) => !item.codigo || !item.descripcion)) throw new Error(`El SIN devolvió items incompletos para ${code}.`);
        await this.repository.applyCatalog({ codigo: code, nombre: name, items }, correlationId); completed += 1;
      } catch (error) {
        const message = errorMessage(error); failures.push(`${code}: ${message}`);
        await this.repository.registerCatalogError(code, name, correlationId, message);
      }
    }
    if (!completed) throw new Error(failures.join("; ") || "El SIN no entregó catálogos válidos.");
    await this.repository.saveSynchronizationOffset(offset);
    await this.repository.completeJob(String(job.id));
  }

  async process(job: Record<string, unknown>) {
    if (["REGISTRAR_EVENTO", "CONCILIAR_EVENTO", "GENERAR_PAQUETES_EVENTO", "ENVIAR_PAQUETE", "VALIDAR_PAQUETE", "CONCILIAR_FACTURA_PAQUETE"].includes(String(job.tipo_tarea))) {
      if (!this.contingencyEnabled) throw new Error("CONTINGENCIA_PENDIENTE_VALIDACION_Y_AUTORIZACION");
      const config = await this.repository.configuration();
      if (config.ambiente !== "PRUEBAS") throw new Error("CONTINGENCIA_SOLO_PILOTO");
    }
    switch (job.tipo_tarea) {
      case "EMITIR_FACTURA_ONLINE": return this.emit(job);
      case "CONCILIAR_FACTURA": return this.reconcile(job);
      case "ANULAR_FACTURA": return this.cancel(job);
      case "REVERTIR_ANULACION": return this.reverse(job);
      case "CONCILIAR_ANULACION": return this.reconcileFiscalOperation(job, "ANULACION");
      case "CONCILIAR_REVERSION": return this.reconcileFiscalOperation(job, "REVERSION");
      case "RENOVAR_CUIS": return this.requestCuis(job);
      case "RENOVAR_CUFD": return this.requestCufd(job);
      case "SINCRONIZAR_CATALOGOS": return this.synchronize(job);
      case "REGISTRAR_EVENTO": return this.registerEvent(job);
      case "CONCILIAR_EVENTO": return this.reconcileEvent(job);
      case "GENERAR_PAQUETES_EVENTO": return this.buildEventPackages(job);
      case "ENVIAR_PAQUETE": return this.sendPackage(job);
      case "VALIDAR_PAQUETE": return this.validatePackage(job);
      case "CONCILIAR_FACTURA_PAQUETE": return this.reconcilePackageInvoice(job);
      default: throw new Error(`Tipo de tarea SIAT no soportado: ${String(job.tipo_tarea)}`);
    }
  }
}

export { catalogOperations, errorMessage };

import { Decimal } from "decimal.js";
import { generateCuf } from "./cuf.ts";
import { gzipBytes, sha256Hex } from "./encoding.ts";
import { generateFiscalPdf } from "./fiscal-pdf.ts";
import { generateInvoiceXml } from "./invoice-xml.ts";
import { siatDateTime } from "./invoice-xml.ts";
import { invoiceTotal } from "./money.ts";
import { officialQrUrl } from "./qr.ts";
import { SiatRepository } from "./repository.ts";
import { AmbiguousSiatError } from "./types.ts";
import type { InvoiceSnapshot, SiatAdapter, SiatContext, SiatResponse } from "./types.ts";
import { signInvoiceXml } from "./xmldsig.ts";
import { validateElectronicInvoiceXml, validateXmlAgainstXsd } from "./xsd.ts";
import { createTar } from "./tar.ts";

const XSD_HASH = {
  COMPUTARIZADA: "344ED2A4BE74C191637B7E918ED3DCE6D85B667CB98DA47A53FA4103683717D9",
  ELECTRONICA: "A3BB1D2E35C2D1E8C710AFBE9F1DA242A9F02BDD49F78C3D45DC4DBAFDA339CF",
} as const;

const catalogOperations = [
  ["ACTIVIDADES", "Actividades económicas", "sincronizarActividades"],
  ["PRODUCTOS_SERVICIOS", "Productos y servicios", "sincronizarListaProductosServicios"],
  ["UNIDADES_MEDIDA", "Unidades de medida", "sincronizarParametricaUnidadMedida"],
  ["METODOS_PAGO", "Métodos de pago", "sincronizarParametricaTipoMetodoPago"],
  ["TIPOS_DOCUMENTO", "Tipos de documento", "sincronizarParametricaTipoDocumentoIdentidad"],
  ["MOTIVOS_ANULACION", "Motivos de anulación", "sincronizarParametricaMotivoAnulacion"],
  ["LEYENDAS_FACTURA", "Leyendas de factura", "sincronizarListaLeyendasFactura"],
  ["EVENTOS_SIGNIFICATIVOS", "Eventos significativos", "sincronizarParametricaEventosSignificativos"],
  ["PAISES_ORIGEN", "Países de origen", "sincronizarParametricaPaisOrigen"],
  ["TIPOS_EMISION", "Tipos de emisión", "sincronizarParametricaTipoEmision"],
  ["TIPOS_FACTURA", "Tipos de factura", "sincronizarParametricaTiposFactura"],
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
const arrayValue = (value: unknown) => Array.isArray(value) ? value as Array<Record<string, unknown>> : [];
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/TokenApi\s+\S+/gi, "TokenApi [REDACTED]").slice(0, 500);

export class SiatEngine {
  constructor(
    private readonly repository: SiatRepository,
    private readonly adapter: SiatAdapter,
    private readonly secrets: { privateKeyPem?: string; certificatePem?: string },
    private readonly readArtifact: (name: string) => Promise<string>,
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

  private snapshot(invoice: Record<string, unknown>, config: Record<string, unknown>, branch: Record<string, unknown>, cuf: string): InvoiceSnapshot {
    const customer = objectValue(invoice.cliente_snapshot); const payment = objectValue(invoice.pago_snapshot); const totals = objectValue(invoice.totales_snapshot);
    const detail = arrayValue(invoice.detalle_snapshot);
    const computed = invoiceTotal(detail.map((line) => ({ quantity: stringValue(line.cantidad, "Cantidad"), price: stringValue(line.precioUnitario, "Precio"), discount: String(line.descuento ?? 0) })), String(totals.descuentoAdicional ?? 0));
    if (!computed.eq(new Decimal(stringValue(totals.montoTotal, "Monto total")))) throw new Error("Los totales del snapshot no coinciden con el detalle fiscal.");
    return {
      id: stringValue(invoice.id, "Factura"), correlationId: stringValue(invoice.correlation_id, "Correlación"),
      nit: stringValue(config.nit, "NIT"), razonSocial: stringValue(config.razon_social, "Razón social"),
      municipio: stringValue(branch.municipio ?? config.municipio, "Municipio"), telefono: config.telefono ? String(config.telefono) : null,
      numeroFactura: stringValue(invoice.numero_factura, "Número de factura"), cuf, cufd: stringValue(invoice.cufd, "CUFD"),
      codigoSucursal: numberValue(invoice.codigo_sucursal, "Sucursal"), direccion: stringValue(branch.direccion ?? config.domicilio, "Dirección"),
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
      totales: { montoTotal: stringValue(totals.montoTotal, "Monto total"), montoTotalSujetoIva: stringValue(totals.montoTotalSujetoIva, "Monto sujeto a IVA"), montoTotalMoneda: stringValue(totals.montoTotalMoneda, "Monto moneda"), descuentoAdicional: totals.descuentoAdicional ? String(totals.descuentoAdicional) : null },
      leyenda: stringValue(totals.leyenda, "Leyenda fiscal"), usuario: String(payment.usuario || "sistema").slice(0, 100),
      detalle: detail.map((line) => ({ actividadEconomica: stringValue(line.actividadEconomica, "Actividad económica"), codigoProductoSin: stringValue(line.codigoProductoSin, "Producto SIN"), codigoProducto: stringValue(line.codigoProducto, "Código producto"), descripcion: stringValue(line.descripcion, "Descripción"), cantidad: stringValue(line.cantidad, "Cantidad"), unidadMedidaSin: stringValue(line.unidadMedidaSin, "Unidad de medida"), precioUnitario: stringValue(line.precioUnitario, "Precio"), descuento: line.descuento == null ? null : String(line.descuento), subtotal: stringValue(line.subtotal, "Subtotal") })),
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
    const invoiceId = stringValue(job.factura_id, "Factura"); const jobId = stringValue(job.id, "Outbox");
    const invoice = await this.repository.invoice(invoiceId);
    if (["VALIDADA", "ANULADA", "REVERTIDA"].includes(String(invoice.estado_fiscal))) { await this.repository.completeJob(jobId); return; }
    if (["ENVIANDO", "SIN_RESPUESTA", "CONCILIANDO"].includes(String(invoice.estado_fiscal))) {
      await this.repository.enqueue(invoiceId, "CONCILIAR_FACTURA", `conciliar:${invoiceId}`, { facturaId: invoiceId }); await this.repository.completeJob(jobId); return;
    }
    const config = await this.repository.configuration(); const branch = await this.repository.branch(stringValue(invoice.sucursal_id, "Sucursal")); const cufd = await this.repository.cufd(stringValue(invoice.cufd_id, "CUFD"));
    const cuf = generateCuf({ nit: stringValue(config.nit, "NIT"), fechaEmision: stringValue(invoice.fecha_emision, "Fecha"), codigoSucursal: numberValue(invoice.codigo_sucursal, "Sucursal"), modalidad: invoice.modalidad === "ELECTRONICA" ? 1 : 2, tipoEmision: 1, tipoFactura: numberValue(invoice.tipo_factura, "Tipo factura"), documentoSector: numberValue(invoice.documento_sector, "Documento sector"), numeroFactura: stringValue(invoice.numero_factura, "Número factura"), codigoPuntoVenta: Number(invoice.codigo_punto_venta ?? 0), codigoControl: stringValue(cufd.codigo_control, "Código control CUFD") });
    const snapshot = this.snapshot(invoice, config, branch, cuf);
    await this.repository.updateInvoice(invoiceId, { estado_fiscal: "GENERANDO", cuf });
    let xml = generateInvoiceXml(snapshot); const electronic = snapshot.modalidad === "ELECTRONICA";
    if (electronic) xml = signInvoiceXml(xml, stringValue(this.secrets.privateKeyPem, "Clave privada"), stringValue(this.secrets.certificatePem, "Certificado"));
    await this.repository.updateInvoice(invoiceId, { estado_fiscal: "VALIDANDO_XSD" });
    const xsdName = electronic ? "facturaElectronicaCompraVenta.xsd" : "facturaComputarizadaCompraVenta.xsd";
    const xsd = await this.readArtifact(xsdName);
    if (electronic) validateElectronicInvoiceXml(xml, xsd, await this.readArtifact("SignatureSchema.xsd")); else validateXmlAgainstXsd(xml, xsd);
    const compressed = await gzipBytes(xml); const hash = await sha256Hex(compressed); const xmlPath = `${snapshot.fechaEmision.slice(0, 7)}/${invoiceId}/${cuf}.xml.gz`;
    await this.repository.store(xmlPath, compressed, "application/gzip");
    await this.repository.updateInvoice(invoiceId, { estado_fiscal: "ENVIANDO", xml_documento: xml, xml_hash: hash, version_xsd: "23/08/2021", hash_xsd: XSD_HASH[snapshot.modalidad], xml_firmado: electronic, xml_storage_path: xmlPath, fecha_envio: new Date().toISOString(), cantidad_intentos: Number(invoice.cantidad_intentos ?? 0) + 1 });
    const attemptId = await this.repository.attempt({ outbox_id: jobId, factura_id: invoiceId, operacion: "RECEPCION_FACTURA", numero_intento: Number(job.intentos ?? 1), estado: "INICIADO", correlation_id: snapshot.correlationId, request_hash: hash });
    try {
      const response = await this.adapter.recepcionarFactura({ context: this.invoiceContext(config, invoice), cufd: snapshot.cufd, documentoSector: snapshot.documentoSector, tipoFactura: snapshot.tipoFactura, archivo: compressed, hashArchivo: hash, fechaEnvio: new Date().toISOString() });
      await this.handleReception(invoiceId, jobId, attemptId, snapshot, response);
    } catch (error) {
      if (error instanceof AmbiguousSiatError) {
        await this.repository.updateInvoice(invoiceId, { estado_fiscal: "SIN_RESPUESTA", ultimo_error_sanitizado: error.message });
        await this.repository.finishAttempt(attemptId, { estado: "AMBIGUO", error_sanitizado: error.message });
        await this.repository.enqueue(invoiceId, "CONCILIAR_FACTURA", `conciliar:${invoiceId}`, { facturaId: invoiceId });
        await this.repository.audit(invoiceId, "RESPUESTA_DESCONOCIDA", "ENVIANDO", "SIN_RESPUESTA", { correlationId: snapshot.correlationId });
        await this.repository.completeJob(jobId); return;
      }
      await this.repository.finishAttempt(attemptId, { estado: "REINTENTO", error_sanitizado: errorMessage(error) });
      throw error;
    }
  }

  private async handleReception(invoiceId: string, jobId: string, attemptId: string, snapshot: InvoiceSnapshot, response: SiatResponse) {
    const accepted = response.transaccion === true && Boolean(response.codigoRecepcion);
    const inconclusive = response.transaccion === true && !response.codigoRecepcion;
    const state = accepted ? "VALIDADA" : inconclusive ? "SIN_RESPUESTA" : response.codigoRecepcion ? "OBSERVADA" : "RECHAZADA";
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

  async reconcile(job: Record<string, unknown>) {
    const invoiceId = stringValue(job.factura_id, "Factura"); const invoice = await this.repository.invoice(invoiceId); const config = await this.repository.configuration();
    if (!invoice.cuf) throw new Error("La factura no tiene CUF para conciliación.");
    await this.repository.updateInvoice(invoiceId, { estado_fiscal: "CONCILIANDO" });
    const response = await this.adapter.verificarFactura(this.invoiceContext(config, invoice), String(invoice.cuf));
    const description = `${response.codigoDescripcion ?? ""} ${response.mensajes.map((item) => item.descripcion).join(" ")}`.toUpperCase();
    const state = description.includes("VALIDAD") ? "VALIDADA" : description.includes("RECHAZ") ? "RECHAZADA" : description.includes("OBSERV") ? "OBSERVADA" : null;
    if (!state) throw new Error("La consulta al SIN no devolvió un estado fiscal concluyente; se reintentará solo la verificación.");
    const values: Record<string, unknown> = { estado_fiscal: state, codigo_recepcion: response.codigoRecepcion ?? invoice.codigo_recepcion, codigo_estado: response.codigoEstado, codigo_descripcion: response.codigoDescripcion, mensajes_siat: response.mensajes, transaccion: response.transaccion, fecha_respuesta: new Date().toISOString(), ultimo_error_sanitizado: null };
    if (state === "VALIDADA" && !invoice.pdf_storage_path) {
      const branch = await this.repository.branch(stringValue(invoice.sucursal_id, "Sucursal"));
      Object.assign(values, await this.persistRepresentation(invoiceId, this.snapshot(invoice, config, branch, String(invoice.cuf))));
    }
    await this.repository.updateInvoice(invoiceId, values);
    await this.repository.audit(invoiceId, "CONCILIACION", "CONCILIANDO", state, { codigoEstado: response.codigoEstado }); await this.repository.completeJob(String(job.id));
  }

  async cancel(job: Record<string, unknown>) {
    const invoiceId = stringValue(job.factura_id, "Factura"); const invoice = await this.repository.invoice(invoiceId); const payload = objectValue(job.payload); const config = await this.repository.configuration();
    if (invoice.estado_fiscal !== "ANULACION_PENDIENTE") throw new Error("La factura no está pendiente de anulación.");
    let response: SiatResponse;
    try { response = await this.adapter.anularFactura(this.invoiceContext(config, invoice), stringValue(invoice.cuf, "CUF"), numberValue(payload.motivo, "Motivo")); }
    catch (error) {
      if (!(error instanceof AmbiguousSiatError)) throw error;
      await this.repository.updateInvoice(invoiceId, { ultimo_error_sanitizado: error.message });
      await this.repository.enqueue(invoiceId, "CONCILIAR_ANULACION", `conciliar_anulacion:${invoiceId}:${String(job.id)}`, { facturaId: invoiceId });
      await this.repository.audit(invoiceId, "ANULACION_RESPUESTA_DESCONOCIDA", "ANULACION_PENDIENTE", "ANULACION_PENDIENTE", {});
      await this.repository.completeJob(String(job.id)); return;
    }
    const state = response.transaccion === true ? "ANULADA" : "VALIDADA";
    await this.repository.updateInvoice(invoiceId, { estado_fiscal: state, respuesta_anulacion: response.rawSanitizado, mensajes_siat: response.mensajes });
    await this.repository.audit(invoiceId, "ANULACION", "ANULACION_PENDIENTE", state, { motivo: payload.motivo, codigoEstado: response.codigoEstado }); await this.repository.completeJob(String(job.id));
  }

  async reverse(job: Record<string, unknown>) {
    const invoiceId = stringValue(job.factura_id, "Factura"); const invoice = await this.repository.invoice(invoiceId); const config = await this.repository.configuration();
    if (invoice.estado_fiscal !== "REVERSION_PENDIENTE") throw new Error("La factura no está pendiente de reversión.");
    let response: SiatResponse;
    try { response = await this.adapter.revertirAnulacion(this.invoiceContext(config, invoice), stringValue(invoice.cuf, "CUF")); }
    catch (error) {
      if (!(error instanceof AmbiguousSiatError)) throw error;
      await this.repository.updateInvoice(invoiceId, { ultimo_error_sanitizado: error.message });
      await this.repository.enqueue(invoiceId, "CONCILIAR_REVERSION", `conciliar_reversion:${invoiceId}:${String(job.id)}`, { facturaId: invoiceId });
      await this.repository.audit(invoiceId, "REVERSION_RESPUESTA_DESCONOCIDA", "REVERSION_PENDIENTE", "REVERSION_PENDIENTE", {});
      await this.repository.completeJob(String(job.id)); return;
    }
    const state = response.transaccion === true ? "REVERTIDA" : "ANULADA";
    await this.repository.updateInvoice(invoiceId, { estado_fiscal: state, fecha_reversion: response.transaccion ? new Date().toISOString() : null, respuesta_reversion: response.rawSanitizado, mensajes_siat: response.mensajes });
    await this.repository.audit(invoiceId, "REVERSION_ANULACION", "REVERSION_PENDIENTE", state, { codigoEstado: response.codigoEstado }); await this.repository.completeJob(String(job.id));
  }

  async reconcileFiscalOperation(job: Record<string, unknown>, operation: "ANULACION" | "REVERSION") {
    const invoiceId = stringValue(job.factura_id, "Factura"); const invoice = await this.repository.invoice(invoiceId); const config = await this.repository.configuration();
    const response = await this.adapter.verificarFactura(this.invoiceContext(config, invoice), stringValue(invoice.cuf, "CUF"));
    const description = `${response.codigoDescripcion ?? ""} ${response.mensajes.map((item) => item.descripcion).join(" ")}`.toUpperCase();
    const confirmed = operation === "ANULACION" ? description.includes("ANULAD") : description.includes("REVERT") || description.includes("VALIDAD");
    if (!confirmed) throw new Error(`Conciliación de ${operation.toLowerCase()} todavía no concluyente; no se repetirá la mutación fiscal.`);
    const previous = operation === "ANULACION" ? "ANULACION_PENDIENTE" : "REVERSION_PENDIENTE"; const state = operation === "ANULACION" ? "ANULADA" : "REVERTIDA";
    await this.repository.updateInvoice(invoiceId, { estado_fiscal: state, mensajes_siat: response.mensajes, codigo_estado: response.codigoEstado, ultimo_error_sanitizado: null });
    await this.repository.audit(invoiceId, `CONCILIACION_${operation}`, previous, state, { codigoEstado: response.codigoEstado, codigoDescripcion: response.codigoDescripcion });
    await this.repository.completeJob(String(job.id));
  }

  async registerEvent(job: Record<string, unknown>) {
    const payload = objectValue(job.payload); const eventId = stringValue(payload.eventoId, "Evento");
    const event = await this.repository.event(eventId); const config = await this.repository.configuration();
    if (event.codigo_recepcion) { await this.repository.completeJob(String(job.id)); return; }
    const branch = await this.repository.branch(stringValue(event.sucursal_id, "Sucursal"));
    const point = event.punto_venta_id ? await this.repository.point(String(event.punto_venta_id)) : null;
    const oldCufd = await this.repository.cufd(stringValue(event.cufd_id, "CUFD del evento"));
    const codes = await this.repository.activeFiscalCodes(String(event.sucursal_id), event.punto_venta_id ? String(event.punto_venta_id) : null, String(config.ambiente));
    const context = this.context(config, {
      codigoSucursal: numberValue(branch.codigo, "Sucursal"), codigoPuntoVenta: point ? numberValue(point.codigo, "Punto de venta") : null,
      cuis: stringValue(codes.cuis.codigo, "CUIS"), cufd: stringValue(codes.cufd.codigo, "CUFD nuevo"),
    });
    await this.repository.updateEvent(eventId, { estado: "ENVIANDO", cufd_envio_id: codes.cufd.id, ultimo_error_sanitizado: null });
    try {
      const response = await this.adapter.registrarEvento({
        context, codigoEvento: numberValue(event.tipo_evento_codigo, "Tipo de evento"),
        descripcion: stringValue(event.descripcion, "Descripción del evento"),
        fechaInicioEvento: siatDateTime(stringValue(event.fecha_inicio, "Inicio del evento")),
        fechaFinEvento: siatDateTime(stringValue(event.fecha_fin, "Fin del evento")),
        cufdEvento: stringValue(oldCufd.codigo, "CUFD del evento"),
      });
      if (response.transaccion !== true || !response.codigoRecepcion) {
        const message = response.mensajes.map((item) => item.descripcion).join("; ") || "El SIN no registró el evento significativo.";
        await this.repository.updateEvent(eventId, { estado: "CON_ERROR", respuesta_siat: response.rawSanitizado, ultimo_error_sanitizado: message.slice(0, 500) });
        await this.repository.auditEntity("siat_eventos_significativos", eventId, "REGISTRO_EVENTO_RECHAZADO", "ENVIANDO", "CON_ERROR", { codigoEstado: response.codigoEstado, mensajes: response.mensajes }, "FALLIDO");
        await this.repository.completeJob(String(job.id)); return;
      }
      await this.repository.updateEvent(eventId, { estado: "ENVIADO", codigo_recepcion: response.codigoRecepcion, respuesta_siat: response.rawSanitizado, ultimo_error_sanitizado: null });
      await this.repository.auditEntity("siat_eventos_significativos", eventId, "REGISTRO_EVENTO_SIN", "ENVIANDO", "ENVIADO", { codigoRecepcion: response.codigoRecepcion });
      await this.repository.enqueue(null, "GENERAR_PAQUETES_EVENTO", `generar_paquetes:${eventId}`, { eventoId: eventId });
      await this.repository.completeJob(String(job.id));
    } catch (error) {
      if (!(error instanceof AmbiguousSiatError)) throw error;
      await this.repository.updateEvent(eventId, { estado: "SIN_RESPUESTA", ultimo_error_sanitizado: error.message });
      await this.repository.enqueue(null, "CONCILIAR_EVENTO", `conciliar_evento:${eventId}`, { eventoId: eventId });
      await this.repository.auditEntity("siat_eventos_significativos", eventId, "EVENTO_RESPUESTA_DESCONOCIDA", "ENVIANDO", "SIN_RESPUESTA", {});
      await this.repository.completeJob(String(job.id));
    }
  }

  async reconcileEvent(job: Record<string, unknown>) {
    const eventId = stringValue(objectValue(job.payload).eventoId, "Evento"); const event = await this.repository.event(eventId);
    const config = await this.repository.configuration(); const branch = await this.repository.branch(stringValue(event.sucursal_id, "Sucursal"));
    const point = event.punto_venta_id ? await this.repository.point(String(event.punto_venta_id)) : null;
    const codes = await this.repository.activeFiscalCodes(String(event.sucursal_id), event.punto_venta_id ? String(event.punto_venta_id) : null, String(config.ambiente));
    const context = this.context(config, { codigoSucursal: numberValue(branch.codigo, "Sucursal"), codigoPuntoVenta: point ? numberValue(point.codigo, "Punto de venta") : null, cuis: stringValue(codes.cuis.codigo, "CUIS"), cufd: stringValue(codes.cufd.codigo, "CUFD") });
    await this.repository.updateEvent(eventId, { estado: "CONCILIANDO" });
    const result = await this.adapter.consultarEventos(context, String(event.fecha_inicio).slice(0, 10));
    const expectedCode = String(event.tipo_evento_codigo); const expectedDescription = String(event.descripcion).trim().toUpperCase();
    const found = result.eventos.map(objectValue).find((item) => String(item.codigoEvento ?? item.codigo ?? "") === expectedCode && String(item.descripcion ?? "").trim().toUpperCase() === expectedDescription);
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
    await this.repository.updateEvent(eventId, { estado: "EMPAQUETANDO" });
    for (const values of groups.values()) {
      for (let index = 0; index < values.length; index += 500) {
        const chunk = values.slice(index, index + 500);
        const tar = createTar(chunk.map((invoice, position) => ({ name: `${String(position + 1).padStart(3, "0")}_${stringValue(invoice.cuf, "CUF")}.xml`, content: new TextEncoder().encode(stringValue(invoice.xml_documento, "XML fiscal")) })));
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
    if (fiscalPackage.codigo_recepcion) { await this.repository.completeJob(String(job.id)); return; }
    const event = await this.repository.event(stringValue(fiscalPackage.evento_id, "Evento")); const config = await this.repository.configuration();
    const branch = await this.repository.branch(stringValue(fiscalPackage.sucursal_id, "Sucursal")); const point = fiscalPackage.punto_venta_id ? await this.repository.point(String(fiscalPackage.punto_venta_id)) : null;
    const codes = await this.repository.activeFiscalCodes(String(fiscalPackage.sucursal_id), fiscalPackage.punto_venta_id ? String(fiscalPackage.punto_venta_id) : null, String(config.ambiente));
    const context = this.context(config, { codigoSucursal: numberValue(branch.codigo, "Sucursal"), codigoPuntoVenta: point ? numberValue(point.codigo, "Punto de venta") : null, cuis: stringValue(codes.cuis.codigo, "CUIS"), cufd: stringValue(codes.cufd.codigo, "CUFD"), documentoSector: numberValue(fiscalPackage.documento_sector, "Documento sector"), tipoFactura: numberValue(config.tipo_factura, "Tipo factura") });
    const bytes = await this.repository.download(stringValue(fiscalPackage.storage_path, "Archivo del paquete"));
    const cafc = fiscalPackage.cafc_id ? await this.repository.cafc(String(fiscalPackage.cafc_id)) : null;
    await this.repository.updatePackage(packageId, { estado: "ENVIADO", intentos: Number(fiscalPackage.intentos ?? 0) + 1, fecha_envio: new Date().toISOString() });
    try {
      const response = await this.adapter.recepcionarPaquete({ context, cufd: stringValue(codes.cufd.codigo, "CUFD"), documentoSector: numberValue(fiscalPackage.documento_sector, "Documento sector"), tipoFactura: numberValue(config.tipo_factura, "Tipo factura"), archivo: bytes, hashArchivo: stringValue(fiscalPackage.archivo_hash, "Hash"), fechaEnvio: siatDateTime(new Date().toISOString()), cafc: cafc ? stringValue(cafc.autorizacion, "CAFC") : null, cantidadFacturas: numberValue(fiscalPackage.cantidad_facturas, "Cantidad"), codigoEvento: stringValue(event.codigo_recepcion, "Código de evento") });
      if (response.transaccion !== true || !response.codigoRecepcion) {
        await this.repository.updatePackage(packageId, { estado: response.codigoEstado === 904 ? "OBSERVADO" : "RECHAZADO", respuesta_siat: response.rawSanitizado, mensajes_siat: response.mensajes, ultimo_error: response.mensajes.map((item) => item.descripcion).join("; ").slice(0, 500) });
        await this.repository.completeJob(String(job.id)); return;
      }
      await this.repository.updatePackage(packageId, { estado: "RECEPCIONADO", codigo_recepcion: response.codigoRecepcion, respuesta_siat: response.rawSanitizado, mensajes_siat: response.mensajes });
      await this.repository.enqueue(null, "VALIDAR_PAQUETE", `validar_paquete:${packageId}`, { paqueteId: packageId });
      await this.repository.completeJob(String(job.id));
    } catch (error) {
      if (!(error instanceof AmbiguousSiatError)) throw error;
      await this.repository.updatePackage(packageId, { estado: "SIN_RESPUESTA", ultimo_error: error.message });
      await this.repository.auditEntity("siat_paquetes", packageId, "PAQUETE_RESPUESTA_DESCONOCIDA", "ENVIADO", "SIN_RESPUESTA", {});
      await this.repository.completeJob(String(job.id));
    }
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
    if (response.codigoEstado !== 908 && response.codigoEstado !== 904) throw new Error(response.mensajes.map((item) => item.descripcion).join("; ") || "Estado de paquete no concluyente.");
    const valid = response.codigoEstado === 908;
    await this.repository.updatePackage(packageId, { estado: valid ? "VALIDADO" : "OBSERVADO", fecha_validacion: new Date().toISOString(), respuesta_siat: response.rawSanitizado, mensajes_siat: response.mensajes, ultimo_error: valid ? null : response.mensajes.map((item) => item.descripcion).join("; ").slice(0, 500) });
    await this.repository.finishPackage(packageId, valid ? "VALIDADA" : "OBSERVADA", response.mensajes);
    await this.repository.auditEntity("siat_paquetes", packageId, "VALIDACION_PAQUETE", "VALIDANDO", valid ? "VALIDADO" : "OBSERVADO", { codigoEstado: response.codigoEstado, codigoRecepcion: reception }, valid ? "EXITOSO" : "OBSERVADO");
    await this.repository.refreshEventFromPackages(String(fiscalPackage.evento_id));
    await this.repository.completeJob(String(job.id));
  }

  async requestCuis(job: Record<string, unknown>) {
    const config = await this.repository.configuration(); const branch = await this.repository.branch(stringValue(config.sucursal_predeterminada_id, "Sucursal predeterminada"));
    const point = config.punto_venta_predeterminado_id ? await this.repository.point(String(config.punto_venta_predeterminado_id)) : null;
    const context = this.context(config, { codigoSucursal: numberValue(branch.codigo, "Sucursal"), codigoPuntoVenta: point ? numberValue(point.codigo, "Punto de venta") : null, cuis: "" }); const result = await this.adapter.solicitarCuis(context);
    if (!result.transaccion || !result.codigo) throw new Error(result.mensajes.map((item) => item.descripcion).join("; ") || "El SIN no entregó CUIS.");
    await this.repository.saveCuis(config, { codigo: result.codigo, fechaVigencia: result.fechaVigencia }); await this.repository.completeJob(String(job.id));
  }

  async requestCufd(job: Record<string, unknown>) {
    const config = await this.repository.configuration(); const branch = await this.repository.branch(stringValue(config.sucursal_predeterminada_id, "Sucursal predeterminada")); const cuis = await this.repository.activeCuis(config); const point = config.punto_venta_predeterminado_id ? await this.repository.point(String(config.punto_venta_predeterminado_id)) : null;
    if (!cuis) throw new Error("Se requiere un CUIS vigente antes de solicitar CUFD.");
    const context = this.context(config, { codigoSucursal: numberValue(branch.codigo, "Sucursal"), codigoPuntoVenta: point ? numberValue(point.codigo, "Punto de venta") : null, cuis: stringValue(cuis.codigo, "CUIS") }); const result = await this.adapter.solicitarCufd(context);
    if (!result.transaccion || !result.codigo || !result.codigoControl || !result.fechaVigencia) throw new Error(result.mensajes.map((item) => item.descripcion).join("; ") || "El SIN no entregó CUFD.");
    await this.repository.saveCufd(config, stringValue(cuis.id, "CUIS"), { codigo: result.codigo, codigoControl: result.codigoControl, direccion: result.direccion, fechaVigencia: result.fechaVigencia }); await this.repository.completeJob(String(job.id));
  }

  async synchronize(job: Record<string, unknown>) {
    const config = await this.repository.configuration(); const branch = await this.repository.branch(stringValue(config.sucursal_predeterminada_id, "Sucursal predeterminada")); const cuis = await this.repository.activeCuis(config); const point = config.punto_venta_predeterminado_id ? await this.repository.point(String(config.punto_venta_predeterminado_id)) : null;
    if (!cuis) throw new Error("Se requiere un CUIS vigente para sincronizar.");
    const context = this.context(config, { codigoSucursal: numberValue(branch.codigo, "Sucursal"), codigoPuntoVenta: point ? numberValue(point.codigo, "Punto de venta") : null, cuis: stringValue(cuis.codigo, "CUIS") });
    const time = await this.adapter.sincronizarFechaHora(context); const offset = new Date(time.fechaHora).getTime() - Date.now();
    const catalogs: Array<{ codigo: string; nombre: string; items: Array<{ codigo: string; descripcion: string; metadatos: Record<string, unknown> }> }> = [];
    for (const [code, name, operation] of catalogOperations) {
      const result = await this.adapter.sincronizarCatalogo(context, operation);
      if (result.response.transaccion !== true) throw new Error(result.response.mensajes.map((item) => item.descripcion).join("; ") || `El SIN no confirmó el catálogo ${code}.`);
      const items = result.items.map((raw) => {
        const item = objectValue(raw); const codigo = item.codigoClasificador ?? item.codigoCaeb ?? item.codigoActividad ?? item.codigoProducto ?? item.codigo;
        const descripcion = item.descripcion ?? item.descripcionLeyenda ?? item.descripcionProducto ?? item.productoServicio ?? item.nombre;
        return { codigo: String(codigo ?? ""), descripcion: String(descripcion ?? ""), metadatos: { ...item, actividadEconomica: item.codigoActividad ?? item.codigoCaeb ?? null } };
      });
      catalogs.push({ codigo: code, nombre: name, items });
    }
    const { error } = await this.repository.db.rpc("siat_aplicar_sincronizacion_completa", { p_catalogos: catalogs, p_version_catalogo: new Date().toISOString(), p_desfase_hora_sin_ms: offset, p_correlation_id: crypto.randomUUID() });
    if (error) throw new Error(error.message);
    await this.repository.completeJob(String(job.id));
  }

  async process(job: Record<string, unknown>) {
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
      default: throw new Error(`Tipo de tarea SIAT no soportado: ${String(job.tipo_tarea)}`);
    }
  }
}

export { catalogOperations, errorMessage };

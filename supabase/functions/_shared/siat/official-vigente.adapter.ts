import { deepFind, normalizeSiatResponse, SoapClient } from "./soap.ts";
import { toBase64 } from "./encoding.ts";
import type { CufdResult, CuisResult, InvoiceReceptionInput, PackageReceptionInput, SiatAdapter, SiatContext, SiatResponse, SignificantEventInput } from "./types.ts";

export const OFFICIAL_TEST_ENDPOINTS = {
  codigos: "https://pilotosiatservicios.impuestos.gob.bo/v2/FacturacionCodigos",
  sincronizacion: "https://pilotosiatservicios.impuestos.gob.bo/v2/FacturacionSincronizacion",
  compraVenta: "https://pilotosiatservicios.impuestos.gob.bo/v2/ServicioFacturacionCompraVenta",
  operaciones: "https://pilotosiatservicios.impuestos.gob.bo/v2/FacturacionOperaciones",
} as const;

const cuisFields = (context: SiatContext) => ({
  codigoAmbiente: context.ambiente === "PRUEBAS" ? 2 : 1,
  codigoModalidad: context.modalidad === "ELECTRONICA" ? 1 : 2,
  codigoPuntoVenta: context.codigoPuntoVenta ?? undefined,
  codigoSistema: context.codigoSistema,
  codigoSucursal: context.codigoSucursal,
  nit: context.nit,
});

const orderedCufdFields = (context: SiatContext) => ({
  codigoAmbiente: context.ambiente === "PRUEBAS" ? 2 : 1, codigoModalidad: context.modalidad === "ELECTRONICA" ? 1 : 2,
  codigoPuntoVenta: context.codigoPuntoVenta ?? undefined, codigoSistema: context.codigoSistema, codigoSucursal: context.codigoSucursal,
  cuis: context.cuis, nit: context.nit,
});
const syncFields = (context: SiatContext) => ({
  codigoAmbiente: context.ambiente === "PRUEBAS" ? 2 : 1, codigoPuntoVenta: context.codigoPuntoVenta ?? undefined,
  codigoSistema: context.codigoSistema, codigoSucursal: context.codigoSucursal, cuis: context.cuis, nit: context.nit,
});
const receptionFields = (context: SiatContext, codigoEmision = 1) => ({
  codigoAmbiente: context.ambiente === "PRUEBAS" ? 2 : 1, codigoDocumentoSector: context.documentoSector,
  codigoEmision, codigoModalidad: context.modalidad === "ELECTRONICA" ? 1 : 2,
  codigoPuntoVenta: context.codigoPuntoVenta ?? undefined, codigoSistema: context.codigoSistema, codigoSucursal: context.codigoSucursal,
  cufd: context.cufd, cuis: context.cuis, nit: context.nit, tipoFacturaDocumento: context.tipoFactura,
});

const text = (raw: unknown, key: string) => {
  const value = deepFind(raw, key);
  return value == null || value === "" ? null : String(value);
};

export class OfficialVigenteAdapter implements SiatAdapter {
  private readonly codes: SoapClient;
  private readonly sync: SoapClient;
  private readonly invoice: SoapClient;
  private readonly operations: SoapClient;

  constructor(token: string, endpoints: Partial<typeof OFFICIAL_TEST_ENDPOINTS> = {}, timeoutMs?: number) {
    if (!token) throw new Error("El Token Delegado SIAT no está configurado en el backend.");
    const resolved = { ...OFFICIAL_TEST_ENDPOINTS, ...endpoints };
    this.codes = new SoapClient(resolved.codigos, token, timeoutMs);
    this.sync = new SoapClient(resolved.sincronizacion, token, timeoutMs);
    this.invoice = new SoapClient(resolved.compraVenta, token, timeoutMs);
    this.operations = new SoapClient(resolved.operaciones, token, timeoutMs);
  }

  async verificarComunicacion(): Promise<SiatResponse> {
    return normalizeSiatResponse(await this.invoice.call("verificarComunicacion", null, {}, { retries: 1 }));
  }

  async solicitarCuis(context: SiatContext): Promise<CuisResult> {
    const raw = await this.codes.call("cuis", "Cuis", cuisFields(context), { retries: 1 });
    return { ...normalizeSiatResponse(raw), codigo: text(raw, "codigo"), fechaVigencia: text(raw, "fechaVigencia") };
  }

  async solicitarCufd(context: SiatContext): Promise<CufdResult> {
    const raw = await this.codes.call("cufd", "Cufd", orderedCufdFields(context), { retries: 1 });
    return { ...normalizeSiatResponse(raw), codigo: text(raw, "codigo"), codigoControl: text(raw, "codigoControl"), direccion: text(raw, "direccion"), fechaVigencia: text(raw, "fechaVigencia") };
  }

  async sincronizarFechaHora(context: SiatContext) {
    const raw = await this.sync.call("sincronizarFechaHora", "Sincronizacion", syncFields(context), { retries: 1 });
    const fechaHora = text(raw, "fechaHora");
    if (!fechaHora) throw new Error("El SIN no devolvió fecha y hora.");
    return { fechaHora, response: normalizeSiatResponse(raw) };
  }

  async sincronizarCatalogo(context: SiatContext, operation: string) {
    if (!/^sincronizar[A-Z][A-Za-z]+$/.test(operation)) throw new Error("Operación de catálogo SIAT no permitida.");
    const raw = await this.sync.call(operation, "Sincronizacion", syncFields(context), { retries: 1 });
    const list = deepFind(raw, "listaCodigos") ?? deepFind(raw, "listaActividades") ?? deepFind(raw, "listaLeyendas") ?? deepFind(raw, "listaProductos") ?? [];
    return { items: Array.isArray(list) ? list : [list], response: normalizeSiatResponse(raw) };
  }

  async recepcionarFactura(input: InvoiceReceptionInput): Promise<SiatResponse> {
    const raw = await this.invoice.call("recepcionFactura", "ServicioRecepcionFactura", {
      ...receptionFields({ ...input.context, cufd: input.cufd, documentoSector: input.documentoSector, tipoFactura: input.tipoFactura }), archivo: toBase64(input.archivo),
      fechaEnvio: input.fechaEnvio, hashArchivo: input.hashArchivo,
    }, { ambiguousOnTimeout: true });
    return normalizeSiatResponse(raw);
  }

  async verificarFactura(context: SiatContext, cuf: string): Promise<SiatResponse> {
    const raw = await this.invoice.call("verificacionEstadoFactura", "ServicioVerificacionEstadoFactura", {
      ...receptionFields(context), cuf,
    }, { retries: 1 });
    return normalizeSiatResponse(raw);
  }

  async anularFactura(context: SiatContext, cuf: string, motivo: number): Promise<SiatResponse> {
    const raw = await this.invoice.call("anulacionFactura", "ServicioAnulacionFactura", {
      ...receptionFields(context), codigoMotivo: motivo, cuf,
    }, { ambiguousOnTimeout: true });
    return normalizeSiatResponse(raw);
  }

  async revertirAnulacion(context: SiatContext, cuf: string): Promise<SiatResponse> {
    const raw = await this.invoice.call("reversionAnulacionFactura", "ServicioReversionAnulacionFactura", {
      ...receptionFields(context), cuf,
    }, { ambiguousOnTimeout: true });
    return normalizeSiatResponse(raw);
  }

  async registrarEvento(input: SignificantEventInput): Promise<SiatResponse> {
    const raw = await this.operations.call("registroEventoSignificativo", "EventoSignificativo", {
      codigoAmbiente: input.context.ambiente === "PRUEBAS" ? 2 : 1,
      codigoSistema: input.context.codigoSistema,
      nit: input.context.nit,
      cuis: input.context.cuis,
      cufd: input.context.cufd,
      codigoSucursal: input.context.codigoSucursal,
      codigoPuntoVenta: input.context.codigoPuntoVenta ?? undefined,
      codigoEvento: input.codigoEvento,
      descripcion: input.descripcion,
      fechaInicioEvento: input.fechaInicioEvento,
      fechaFinEvento: input.fechaFinEvento,
      cufdEvento: input.cufdEvento,
    }, { ambiguousOnTimeout: true });
    return normalizeSiatResponse(raw);
  }

  async consultarEventos(context: SiatContext, fechaEvento: string) {
    const raw = await this.operations.call("consultaEventoSignificativo", "ConsultaEvento", {
      codigoAmbiente: context.ambiente === "PRUEBAS" ? 2 : 1,
      codigoSistema: context.codigoSistema,
      nit: context.nit,
      cuis: context.cuis,
      cufd: context.cufd,
      codigoSucursal: context.codigoSucursal,
      codigoPuntoVenta: context.codigoPuntoVenta ?? undefined,
      fechaEvento,
    }, { retries: 1 });
    const found = deepFind(raw, "listaEventos") ?? [];
    return { eventos: (Array.isArray(found) ? found : [found]).filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object"), response: normalizeSiatResponse(raw) };
  }

  async recepcionarPaquete(input: PackageReceptionInput): Promise<SiatResponse> {
    const raw = await this.invoice.call("recepcionPaqueteFactura", "ServicioRecepcionPaquete", {
      ...receptionFields({ ...input.context, cufd: input.cufd, documentoSector: input.documentoSector, tipoFactura: input.tipoFactura }, 2),
      archivo: toBase64(input.archivo),
      fechaEnvio: input.fechaEnvio,
      hashArchivo: input.hashArchivo,
      cafc: input.cafc ?? undefined,
      cantidadFacturas: input.cantidadFacturas,
      codigoEvento: input.codigoEvento,
    }, { ambiguousOnTimeout: true });
    return normalizeSiatResponse(raw);
  }

  async validarPaquete(context: SiatContext, codigoRecepcion: string): Promise<SiatResponse> {
    const raw = await this.invoice.call("validacionRecepcionPaqueteFactura", "ServicioValidacionRecepcionPaquete", {
      ...receptionFields(context, 2), codigoRecepcion,
    }, { retries: 1 });
    return normalizeSiatResponse(raw);
  }
}

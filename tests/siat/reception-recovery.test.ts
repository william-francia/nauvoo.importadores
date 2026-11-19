import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SiatEngine } from "../../supabase/functions/_shared/siat/engine.ts";
import { OfficialVigenteAdapter } from "../../supabase/functions/_shared/siat/official-vigente.adapter.ts";
import type { SiatRepository } from "../../supabase/functions/_shared/siat/repository.ts";
import { AmbiguousSiatError, type SiatAdapter, type SiatResponse } from "../../supabase/functions/_shared/siat/types.ts";

// This suite tests transport/recovery only; cryptographic and XSD validation have
// their own tests. No certificate, credential, database or network is used here.
vi.mock("../../supabase/functions/_shared/siat/xsd.ts", () => ({
  validateUnsignedElectronicInvoiceXml: vi.fn(), validateElectronicInvoiceXml: vi.fn(), validateXmlAgainstXsd: vi.fn(),
}));
vi.mock("../../supabase/functions/_shared/siat/signature-credentials.ts", () => ({ validateSignatureCredentials: vi.fn() }));
vi.mock("../../supabase/functions/_shared/siat/xmldsig.ts", () => ({ signInvoiceXml: (xml: string) => xml, verifyInvoiceSignature: () => true }));
vi.mock("../../supabase/functions/_shared/siat/pilot-approval.ts", () => ({ publicCertificateSha256: async () => "a".repeat(64) }));
vi.mock("../../supabase/functions/_shared/siat/fiscal-pdf.ts", () => ({ generateFiscalPdf: async () => new Uint8Array([1]) }));

const time = "2026-10-23T18:56:13.873Z";
const fiscalDate = "2026-10-23T18:55:00.000Z";
const savedCuf = "CUF_EXISTENTE_NO_REGENERAR";
const savedXml = "<factura>XML_ORIGINAL_FIRMADO</factura>";
const job = { id: "held-job", factura_id: "invoice", intentos: 1 };
const official = (codigoEstado: number | null, transaccion: boolean | null, codigoRecepcion: string | null = null): SiatResponse => ({
  codigoEstado, transaccion, codigoRecepcion, codigoDescripcion: "RESPUESTA_OFICIAL",
  mensajes: [{ codigo: codigoEstado ?? undefined, descripcion: "Resultado oficial simulado" }],
  rawSanitizado: { codigoEstado, transaccion, codigoRecepcion },
});

function fixture(state = "ENVIANDO") {
  const invoice: Record<string, unknown> = {
    id: "invoice", estado_fiscal: state, origen_fiscal: "PILOTO", ambiente: "PRUEBAS", modalidad: "ELECTRONICA",
    correlation_id: "correlation", numero_factura: 1, fecha_emision: fiscalDate, cuf: savedCuf,
    cuis_id: "cuis", cuis: "CUIS_TEST", cufd_id: "cufd", cufd: "CUFD_TEST", sucursal_id: "branch",
    codigo_sucursal: 0, punto_venta_id: null, codigo_punto_venta: 0, documento_sector: 1, tipo_factura: 1,
    xml_documento: savedXml, xml_hash: "hash-original", xml_storage_path: "original.xml.gz", cantidad_intentos: 1,
    cliente_snapshot: { nombreRazonSocial: "Cliente prueba", codigoTipoDocumentoIdentidad: 1, numeroDocumento: "9204357", codigoCliente: "CLI-TEST" },
    pago_snapshot: { codigoMetodoPago: 1, codigoMoneda: 1, tipoCambio: "1", usuario: "test" },
    totales_snapshot: { montoTotal: "5", montoTotalSujetoIva: "5", montoTotalMoneda: "5", descuentoAdicional: "0", leyenda: "Leyenda prueba" },
    detalle_snapshot: [{ actividadEconomica: "4752100", codigoProductoSin: "1003451", codigoProducto: "FIXTURE", descripcion: "Perno de prueba", cantidad: "1", unidadMedidaSin: "47", precioUnitario: "5", descuento: "0", subtotal: "5" }],
  };
  const config = { ambiente: "PRUEBAS", version_normativa: "SIAT_VIGENTE", modalidad: "ELECTRONICA", siat_habilitado: false, nit: "72229012", codigo_sistema: "SYSTEM_TEST", razon_social: "Emisor prueba", municipio: "La Paz", domicilio: "Direccion prueba" };
  const repository = {
    invoice: vi.fn(async () => invoice), configuration: vi.fn(async () => config), pilotEmissionAllowed: vi.fn(async () => true),
    branch: vi.fn(async () => ({ municipio: "La Paz", direccion: "Direccion prueba" })),
    cuis: vi.fn(async () => ({ id: "cuis", codigo: "CUIS_TEST", estado: "VIGENTE", ambiente: "PRUEBAS", sucursal_id: "branch", punto_venta_id: null, fecha_expiracion: "2027-01-01T00:00:00Z" })),
    cufd: vi.fn(async () => ({ id: "cufd", codigo: "CUFD_TEST", cuis_id: "cuis", estado: "VIGENTE", ambiente: "PRUEBAS", sucursal_id: "branch", punto_venta_id: null, fecha_inicio: "2026-10-23T00:00:00Z", fecha_expiracion: "2026-10-24T00:00:00Z", codigo_control: "TESTCONTROL", direccion: "Direccion prueba" })),
    updateInvoice: vi.fn(async (_id: string, values: Record<string, unknown>) => { Object.assign(invoice, values); }),
    attempt: vi.fn(async () => "attempt"), finishAttempt: vi.fn(async () => {}),
    audit: vi.fn(async () => {}), enqueue: vi.fn(async () => {}), store: vi.fn(async () => {}),
    completeJob: vi.fn(async () => {}), stopJob: vi.fn(async () => {}),
  };
  const adapter = { recepcionarFactura: vi.fn(), verificarFactura: vi.fn() };
  const engine = new SiatEngine(repository as unknown as SiatRepository, adapter as unknown as SiatAdapter, { privateKeyPem: "mock-only", certificatePem: "mock-only" }, async () => "mock-xsd");
  return { engine, repository, adapter, invoice, config };
}

function expectNoResend(f: ReturnType<typeof fixture>) {
  expect(f.adapter.recepcionarFactura).not.toHaveBeenCalled();
  expect(f.repository.enqueue).not.toHaveBeenCalled();
  expect(f.repository.completeJob).not.toHaveBeenCalled();
  expect(f.invoice).toMatchObject({ cuf: savedCuf, xml_documento: savedXml, xml_hash: "hash-original", xml_storage_path: "original.xml.gz", numero_factura: 1, fecha_emision: fiscalDate, cantidad_intentos: 1 });
  expect(f.config.siat_habilitado).toBe(false);
}

describe("recuperacion segura de recepcion SOAP", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(time)); });
  afterEach(() => { vi.useRealTimers(); });

  it("bloquea un outbox retenido antes de leer la factura o intentar transmitir", async () => {
    const f = fixture("EN_COLA");
    await expect(f.engine.emit({ ...job, payload: { reenvioAutomaticoBloqueado: true } })).rejects.toThrow("SIAT_REENVIO_BLOQUEADO");
    expect(f.repository.invoice).not.toHaveBeenCalled();
    expect(f.repository.configuration).not.toHaveBeenCalled();
    expect(f.repository.updateInvoice).not.toHaveBeenCalled();
    expect(f.repository.attempt).not.toHaveBeenCalled();
    expectNoResend(f);
  });

  it("el adaptador respeta retries cero frente a HTTP500 y solo consulta estado una vez", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<Fault><faultstring>Fallo simulado</faultstring></Fault>", { status: 500 }));
    try {
      const adapter = new OfficialVigenteAdapter("mock-only", { compraVenta: "https://soap.invalid/test" });
      await expect(adapter.verificarFactura({
        ambiente: "PRUEBAS", versionNormativa: "SIAT_VIGENTE", modalidad: "ELECTRONICA", codigoSistema: "SYSTEM_TEST",
        codigoSucursal: 0, codigoPuntoVenta: null, nit: "72229012", cuis: "CUIS_TEST", cufd: "CUFD_TEST", documentoSector: 1, tipoFactura: 1,
      }, savedCuf, { retries: 0 })).rejects.toThrow("SIAT_HTTP_500");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const body = String(fetchMock.mock.calls[0]![1]?.body);
      expect(body).toContain("<siat:verificacionEstadoFactura>");
      expect(body).toContain(`<cuf>${savedCuf}</cuf>`);
      expect(body).not.toContain("recepcionFactura");
    } finally { fetchMock.mockRestore(); }
  });

  it("envia fecha SOAP en Bolivia con milisegundos sin Z y conserva fecha fiscal del XML", async () => {
    const f = fixture("EN_COLA");
    f.adapter.recepcionarFactura.mockResolvedValue(official(904, false));
    await f.engine.emit(job);
    expect(f.adapter.recepcionarFactura).toHaveBeenCalledTimes(1);
    expect(f.adapter.recepcionarFactura.mock.calls[0]![0].fechaEnvio).toBe("2026-10-23T14:56:13.873");
    expect(f.invoice.fecha_emision).toBe(fiscalDate);
    expect(f.invoice.xml_documento).toContain("<fechaEmision>2026-10-23T14:55:00.000</fechaEmision>");
  });

  it.each([
    "SIAT_HTTP_500: soap:Client Unmarshalling Error: DateTimeParseException",
    "SIAT_SOAP_FAULT: soap:Client Unmarshalling Error",
  ])("no deja ENVIANDO ni reintenta automaticamente tras %s", async (message) => {
    const f = fixture("EN_COLA");
    f.adapter.recepcionarFactura.mockRejectedValue(new Error(message));
    await f.engine.emit(job);
    expect(f.invoice).toMatchObject({ estado_fiscal: "SIN_RESPUESTA", ultimo_error_sanitizado: message });
    expect(f.repository.finishAttempt).toHaveBeenCalledWith("attempt", expect.objectContaining({ estado: "FALLIDO", error_sanitizado: message }));
    expect(f.repository.stopJob).toHaveBeenCalledWith(job.id, message);
    expect(f.repository.enqueue).not.toHaveBeenCalled();
    expect(f.repository.completeJob).not.toHaveBeenCalled();
    expect(f.adapter.recepcionarFactura).toHaveBeenCalledTimes(1);
    expect(f.repository.audit).toHaveBeenCalledWith("invoice", "ERROR_RECEPCION_SIN_ESTADO_FISCAL", "ENVIANDO", "SIN_RESPUESTA", expect.objectContaining({ error: message, requiereConciliacion: true }), "FALLIDO");
  });

  it.each([
    { code: 908, transaction: true, receipt: "RECEPCION_TEST", expected: "VALIDADA" },
    { code: 904, transaction: false, receipt: null, expected: "OBSERVADA" },
    { code: 924, transaction: false, receipt: null, expected: "SIN_RESPUESTA" },
    { code: 908, transaction: false, receipt: null, expected: "SIN_RESPUESTA" },
  ])("concilia una vez $code/$transaction y conserva CUF/XML sin reenviar", async ({ code, transaction, receipt, expected }) => {
    const f = fixture(); const response = official(code, transaction, receipt);
    f.adapter.verificarFactura.mockResolvedValue(response);
    const result = await f.engine.reconcile(job, { singleShot: true });
    expect(result).toEqual(response);
    expect(f.adapter.verificarFactura).toHaveBeenCalledTimes(1);
    expect(f.adapter.verificarFactura).toHaveBeenCalledWith(expect.objectContaining({ ambiente: "PRUEBAS", cuis: "CUIS_TEST", cufd: "CUFD_TEST" }), savedCuf, { retries: 0 });
    expect(f.invoice).toMatchObject({ estado_fiscal: expected, codigo_estado: code, transaccion: transaction, mensajes_siat: response.mensajes });
    expect(f.repository.attempt).toHaveBeenCalledWith(expect.objectContaining({ operacion: "VERIFICACION_ESTADO_FACTURA", factura_id: "invoice" }));
    expect(f.repository.finishAttempt).toHaveBeenCalledTimes(1);
    if (expected === "SIN_RESPUESTA") expect(f.repository.store).not.toHaveBeenCalled();
    expectNoResend(f);
  });

  it("consulta el mismo CUF con CUFD vigente y conserva CUFD/XML originales de la factura", async () => {
    const f = fixture();
    const vigente = { id: "cufd-current", codigo: "CUFD_VIGENTE", cuis_id: "cuis", sucursal_id: "branch",
      punto_venta_id: null, ambiente: "PRUEBAS", estado: "VIGENTE",
      fecha_inicio: "2026-10-23T12:00:00Z", fecha_expiracion: "2026-10-24T00:00:00Z" };
    f.adapter.verificarFactura.mockResolvedValue(official(946, false));
    await f.engine.reconcile(job, { singleShot: true, currentCufd: vigente });
    expect(f.adapter.verificarFactura).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ cufd: "CUFD_VIGENTE", cuis: "CUIS_TEST", codigoSucursal: 0 }), savedCuf, { retries: 0 });
    expect(f.repository.attempt).toHaveBeenCalledWith(expect.objectContaining({ numero_intento: 2 }));
    expect(f.invoice).toMatchObject({ estado_fiscal: "SIN_RESPUESTA", cufd_id: "cufd", cufd: "CUFD_TEST" });
    expectNoResend(f);
  });

  it("detiene la consulta antes del intento cuando el CUFD seleccionado expiró", async () => {
    const f = fixture();
    const vencido = { id: "cufd-current", codigo: "CUFD_VENCIDO", cuis_id: "cuis", sucursal_id: "branch",
      punto_venta_id: null, ambiente: "PRUEBAS", estado: "VIGENTE",
      fecha_inicio: "2026-10-22T00:00:00Z", fecha_expiracion: "2026-10-23T18:00:00Z" };
    await expect(f.engine.reconcile(job, { singleShot: true, currentCufd: vencido })).rejects.toThrow("CONCILIACION_CUFD_VIGENTE_NO_DISPONIBLE");
    expect(f.repository.attempt).not.toHaveBeenCalled();
    expect(f.adapter.verificarFactura).not.toHaveBeenCalled();
    expectNoResend(f);
  });

  it("timeout en consulta unica conserva incertidumbre y no programa consultas ni envios", async () => {
    const f = fixture();
    f.adapter.verificarFactura.mockRejectedValue(new AmbiguousSiatError("Consulta agotada"));
    expect(await f.engine.reconcile(job, { singleShot: true })).toBeUndefined();
    expect(f.adapter.verificarFactura).toHaveBeenCalledTimes(1);
    expect(f.invoice).toMatchObject({ estado_fiscal: "SIN_RESPUESTA", ultimo_error_sanitizado: "Consulta agotada" });
    expect(f.invoice.codigo_estado).toBeUndefined();
    expect(f.repository.finishAttempt).toHaveBeenCalledWith("attempt", expect.objectContaining({ estado: "AMBIGUO", error_sanitizado: "Consulta agotada" }));
    expect(f.repository.store).not.toHaveBeenCalled();
    expectNoResend(f);
  });
});

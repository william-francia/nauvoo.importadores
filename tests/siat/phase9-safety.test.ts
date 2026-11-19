import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { SiatEngine } from "../../supabase/functions/_shared/siat/engine.ts";
import { OfficialVigenteAdapter } from "../../supabase/functions/_shared/siat/official-vigente.adapter.ts";
import { assertFiscalOperationAllowed } from "../../supabase/functions/_shared/siat/fiscal-operation.ts";
import { normalizeSiatResponse } from "../../supabase/functions/_shared/siat/soap.ts";
import { gzipBytes, sha256Hex } from "../../supabase/functions/_shared/siat/encoding.ts";
import { prepararAvisoFiscal } from "../../src/features/facturas/services/aviso-fiscal.service.ts";
import { assertContingencyPilotReady } from "../../agent-local/src/contingency-safety.ts";
import type { SiatRepository } from "../../supabase/functions/_shared/siat/repository.ts";
import type { SiatAdapter, SiatResponse } from "../../supabase/functions/_shared/siat/types.ts";

vi.mock("../../supabase/functions/_shared/siat/xsd.ts", () => ({ validateUnsignedElectronicInvoiceXml: vi.fn(), validateElectronicInvoiceXml: vi.fn(), validateXmlAgainstXsd: vi.fn() }));
vi.mock("../../supabase/functions/_shared/siat/signature-credentials.ts", () => ({ validateSignatureCredentials: vi.fn() }));
vi.mock("../../supabase/functions/_shared/siat/xmldsig.ts", () => ({ signInvoiceXml: (xml: string) => xml, verifyInvoiceSignature: () => true }));
vi.mock("../../supabase/functions/_shared/siat/fiscal-pdf.ts", () => ({ generateFiscalPdf: vi.fn() }));

const response = (code: number | null, transaction: boolean | null, reception: string | null = null): SiatResponse => ({ codigoEstado: code, transaccion: transaction, codigoRecepcion: reception, codigoDescripcion: "NO ANULADA", mensajes: [], rawSanitizado: { code, transaction } });
const payload = { operacion: "ANULAR", actor: "admin-test", motivo: 1, confirmacionExpresa: true, declaracionNoUtilizadaDDJJ: true };
const job = { id: "job-test", factura_id: "fake-invoice", payload };
function fixture(state = "ANULACION_PENDIENTE") {
  let started = false;
  const invoice: Record<string, unknown> = { id: "fake-invoice", estado_fiscal: state, ambiente: "PRUEBAS", origen_fiscal: "PILOTO", sucursal_id: "branch", fecha_emision: "2026-10-23T18:00:00Z", codigo_sucursal: 0, cuis: "CUIS-TEST", cufd: "CUFD-TEST", documento_sector: 1, tipo_factura: 1, cuf: "CUF-TEST" };
  const event: Record<string, unknown> = { sucursal_id: "branch", cufd_id: "old", tipo_evento_codigo: 1, descripcion: "Evento test", fecha_inicio: "2026-11-03T09:00:00Z", fecha_fin: "2026-11-03T10:00:00Z", evidencia_deteccion: { resultado: "simulado" } };
  const pack: Record<string, unknown> = { evento_id: "event", sucursal_id: "branch", cufd_evento_id: "old", documento_sector: 1, storage_path: "mock", archivo_hash: "4BF5122F344554C53BDE2EBB8CD2B7E3D1600AD631C385A5D7CCE23C7785459A", cantidad_facturas: 1 };
  const repository = {
    invoice: vi.fn(async () => invoice), configuration: vi.fn(async () => ({ ambiente: "PRUEBAS", version_normativa: "SIAT_VIGENTE", codigo_sistema: "test", nit: "1", modalidad: "ELECTRONICA", tipo_factura: 1 })),
    markFiscalMutationStarted: vi.fn(async () => { if (started) return false; started = true; return true; }),
    updateInvoice: vi.fn(async (_id: string, data: Record<string, unknown>) => { Object.assign(invoice, data); }),
    updateInvoiceIfState: vi.fn(async (_id: string, expected: string, data: Record<string, unknown>) => { if (invoice.estado_fiscal !== expected) return false; Object.assign(invoice, data); return true; }),
    updateEvent: vi.fn(async (_id: string, data: Record<string, unknown>) => { Object.assign(event, data); }),
    updatePackage: vi.fn(async (_id: string, data: Record<string, unknown>) => { Object.assign(pack, data); }),
    event: vi.fn(async () => event), package: vi.fn(async () => pack), branch: vi.fn(async () => ({ codigo: 0, activo: true })), point: vi.fn(async () => ({ codigo: 3, activo: true, sucursal_id: "branch-alt" })),
    cufd: vi.fn(async () => ({ id: "old", codigo: "OLD", ambiente: "PRUEBAS", sucursal_id: "branch", punto_venta_id: null, fecha_inicio: "2026-11-03T00:00:00Z", fecha_expiracion: "2026-11-04T00:00:00Z" })), activeFiscalCodes: vi.fn(async (): Promise<{ cuis: Record<string, unknown>; cufd: Record<string, unknown> }> => ({ cuis: { id: "cuis-current", codigo: "CUIS", estado: "VIGENTE", ambiente: "PRUEBAS", sucursal_id: "branch", punto_venta_id: null, fecha_expiracion: "2026-11-20T00:00:00Z" }, cufd: { id: "new", codigo: "NEW", cuis_id: "cuis-current", estado: "VIGENTE", ambiente: "PRUEBAS", sucursal_id: "branch", punto_venta_id: null, fecha_inicio: "2026-11-03T10:30:00Z", fecha_expiracion: "2026-11-20T00:00:00Z" } })),
    packageInvoices: vi.fn(async () => [{ posicion: 1, factura: invoice }]),
    download: vi.fn(async () => new Uint8Array([1])), offlineInvoices: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []), store: vi.fn(async () => {}), createPackage: vi.fn(async () => "package"), enqueue: vi.fn(async () => {}), audit: vi.fn(async () => {}), auditEntity: vi.fn(async () => {}), completeJob: vi.fn(async () => {}), stopJob: vi.fn(async () => {}), finishPackage: vi.fn(async () => {}), refreshEventFromPackages: vi.fn(async () => {}),
  };
  const adapter = { anularFactura: vi.fn(), revertirAnulacion: vi.fn(), verificarFactura: vi.fn(), registrarEvento: vi.fn(), consultarEventos: vi.fn(), recepcionarPaquete: vi.fn(), validarPaquete: vi.fn() };
  return { invoice, event, pack, repository, adapter, engine: new SiatEngine(repository as unknown as SiatRepository, adapter as unknown as SiatAdapter, {}, async () => "", async () => async () => {}) };
}

describe("Paso 9: operaciones seguras simuladas, sin red", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-03T12:00:00Z")); });
  afterEach(() => vi.useRealTimers());

  it("exige confirmación, declaración DDJJ, plazo y ambiente piloto", () => {
    const f = fixture();
    expect(() => assertFiscalOperationAllowed(f.invoice, payload, "ANULAR", Date.parse("2026-11-10T03:59:59Z"))).not.toThrow();
    expect(() => assertFiscalOperationAllowed(f.invoice, payload, "ANULAR", Date.parse("2026-11-10T04:00:00Z"))).toThrow("PLAZO_OPERACION_VENCIDO");
    expect(() => assertFiscalOperationAllowed(f.invoice, { ...payload, confirmacionExpresa: false }, "ANULAR")).toThrow("CONFIRMACION");
    expect(() => assertFiscalOperationAllowed(f.invoice, { ...payload, declaracionNoUtilizadaDDJJ: false }, "ANULAR")).toThrow("DDJJ");
    expect(() => assertFiscalOperationAllowed({ ...f.invoice, ambiente: "PRODUCCION" }, payload, "ANULAR")).toThrow("SOLO_PILOTO");
    expect(() => assertFiscalOperationAllowed({ ...f.invoice, origen_fiscal: "VENTA" }, payload, "ANULAR")).toThrow("FACTURA_PILOTO_AISLADA");
    expect(() => assertFiscalOperationAllowed({ ...f.invoice, fecha_reversion: "2026-11-01" }, payload, "ANULAR")).toThrow("YA_REVERTIDA");
    for (const id of ["c2279bbb-e851-468b-afe6-8ebf0b436d28", "08dd889e-f2f7-4acb-be2e-2f911aae9919"]) expect(() => assertFiscalOperationAllowed({ ...f.invoice, id }, payload, "ANULAR")).toThrow("FACTURA_PILOTO_ANTERIOR_PROTEGIDA");
    const reversal = { ...payload, operacion: "REVERTIR_ANULACION" };
    expect(() => assertFiscalOperationAllowed({ ...f.invoice, fecha_emision: "2026-12-15T12:00:00Z" }, reversal, "REVERTIR_ANULACION", Date.parse("2027-01-10T03:59:59Z"))).not.toThrow();
    expect(() => assertFiscalOperationAllowed({ ...f.invoice, fecha_emision: "2026-12-15T12:00:00Z" }, reversal, "REVERTIR_ANULACION", Date.parse("2027-01-10T04:00:00Z"))).toThrow("PLAZO_OPERACION_VENCIDO");
  });

  it.each([["cancel", "anulacionFactura", 905], ["reverse", "reversionAnulacionFactura", 907]] as const)("serializa el contrato SOAP %s sin red", async (operation, method, code) => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(`<Envelope><Body><Result><codigoEstado>${code}</codigoEstado><transaccion>true</transaccion></Result></Body></Envelope>`, { status: 200 }));
    try {
      const adapter = new OfficialVigenteAdapter("mock-token", { compraVenta: "https://soap.invalid/test" });
      const context = { ambiente: "PRUEBAS" as const, versionNormativa: "SIAT_VIGENTE" as const, modalidad: "ELECTRONICA" as const, codigoSistema: "MOCK", codigoSucursal: 0, codigoPuntoVenta: null, nit: "1", cuis: "CUIS", cufd: "CUFD", documentoSector: 1, tipoFactura: 1 };
      const result = operation === "cancel" ? await adapter.anularFactura(context, "CUF-TEST", 1) : await adapter.revertirAnulacion(context, "CUF-TEST");
      expect(result).toMatchObject({ codigoEstado: code, transaccion: true }); expect(fetchMock).toHaveBeenCalledTimes(1);
      const xml = String(fetchMock.mock.calls[0]![1]?.body); expect(xml).toContain(`<siat:${method}>`); expect(xml).toContain("<cuf>CUF-TEST</cuf>");
      expect(xml).toContain("<cuis>CUIS</cuis>"); expect(xml).toContain("<cufd>CUFD</cufd>");
      if (operation === "cancel") expect(xml).toContain("<codigoMotivo>1</codigoMotivo>");
    } finally { fetchMock.mockRestore(); }
  });

  it("conserva códigos y mensajes en respuestas oficiales de anulación", () => {
    const parsed = normalizeSiatResponse({ codigoEstado: "906", transaccion: "false", codigosRespuesta: [{ codigo: "934", descripcion: "Solicitud fuera de plazo" }, { codigo: "981", descripcion: "No disponible" }] });
    expect(parsed).toMatchObject({ codigoEstado: 906, transaccion: false, mensajes: [{ codigo: 934, descripcion: "Solicitud fuera de plazo" }, { codigo: 981, descripcion: "No disponible" }] });
  });

  it.each([[905, true, "ANULADA"], [905, false, "ANULACION_PENDIENTE"], [null, null, "ANULACION_PENDIENTE"], [908, true, "ANULACION_PENDIENTE"]] as const)("anulación %s/%s termina en %s", async (code, transaction, state) => {
    const f = fixture(); f.adapter.anularFactura.mockResolvedValue(response(code, transaction));
    await f.engine.cancel(job); expect(f.invoice.estado_fiscal).toBe(state);
    if (state === "ANULACION_PENDIENTE") expect(f.repository.enqueue).toHaveBeenCalledWith("fake-invoice", "CONCILIAR_ANULACION", expect.any(String), expect.any(Object));
  });

  it("doble ejecución, timeout y caída posterior no repiten anulación", async () => {
    const f = fixture(); f.adapter.anularFactura.mockRejectedValue(new Error("SIAT_TIMEOUT"));
    await Promise.all([f.engine.cancel(job), f.engine.cancel(job)]);
    await f.engine.cancel(job);
    expect(f.adapter.anularFactura).toHaveBeenCalledTimes(1);
    expect(f.invoice.estado_fiscal).toBe("ANULACION_PENDIENTE");
  });

  it("utiliza CUIS y CUFD vigentes sin cambiar los históricos", async () => {
    const f = fixture(); f.adapter.anularFactura.mockResolvedValue(response(905, true));
    await f.engine.cancel(job);
    expect(f.adapter.anularFactura).toHaveBeenCalledWith(expect.objectContaining({ cuis: "CUIS", cufd: "NEW" }), "CUF-TEST", 1, expect.any(Function));
    expect(f.invoice).toMatchObject({ cuis: "CUIS-TEST", cufd: "CUFD-TEST" });
  });

  it("permite una sucursal y punto alternativos habilitados con códigos propios", async () => {
    const f = fixture(); const codes = await f.repository.activeFiscalCodes(); codes.cuis.sucursal_id = "branch-alt"; codes.cufd.sucursal_id = "branch-alt";
    codes.cuis.punto_venta_id = "point-alt"; codes.cufd.punto_venta_id = "point-alt";
    f.repository.activeFiscalCodes.mockResolvedValue(codes); f.repository.branch.mockResolvedValue({ codigo: 2, activo: true });
    f.adapter.anularFactura.mockResolvedValue(response(905, true));
    await f.engine.cancel({ ...job, payload: { ...payload, sucursalOperacionId: "branch-alt", puntoVentaOperacionId: "point-alt" } });
    expect(f.adapter.anularFactura).toHaveBeenCalledWith(expect.objectContaining({ codigoSucursal: 2, codigoPuntoVenta: 3, cuis: "CUIS", cufd: "NEW" }), "CUF-TEST", 1, expect.any(Function));
    expect(f.invoice.sucursal_id).toBe("branch");
  });

  it("bloquea una sucursal alternativa inactiva antes de transmitir", async () => {
    const f = fixture(); f.repository.branch.mockResolvedValue({ codigo: 2, activo: false });
    await expect(f.engine.cancel({ ...job, payload: { ...payload, sucursalOperacionId: "branch-alt" } })).rejects.toThrow("SUCURSAL_OPERACION_NO_HABILITADA");
    expect(f.adapter.anularFactura).not.toHaveBeenCalled();
  });

  it("bloquea CUFD vencido antes de marcar o llamar al servicio", async () => {
    const f = fixture(); const codes = await f.repository.activeFiscalCodes(); codes.cufd.fecha_expiracion = "2026-11-01T00:00:00Z";
    f.repository.activeFiscalCodes.mockResolvedValue(codes);
    await expect(f.engine.cancel(job)).rejects.toThrow("CUFD_NO_VIGENTE");
    expect(f.repository.markFiscalMutationStarted).not.toHaveBeenCalled(); expect(f.adapter.anularFactura).not.toHaveBeenCalled();
  });

  it("bloquea la transmisión si no hay almacenamiento de evidencia configurado", async () => {
    const f = fixture();
    const engine = new SiatEngine(f.repository as unknown as SiatRepository, f.adapter as unknown as SiatAdapter, {}, async () => "");
    await expect(engine.cancel(job)).rejects.toThrow("SOAP_EVIDENCIA_NO_CONFIGURADA");
    expect(f.repository.markFiscalMutationStarted).not.toHaveBeenCalled();
    expect(f.adapter.anularFactura).not.toHaveBeenCalled();
  });

  it("bloquea CUIS vencido o de otra sucursal antes de transmitir", async () => {
    const f = fixture(); const codes = await f.repository.activeFiscalCodes(); codes.cuis.fecha_expiracion = "2026-11-01T00:00:00Z";
    f.repository.activeFiscalCodes.mockResolvedValue(codes);
    await expect(f.engine.cancel(job)).rejects.toThrow("CUIS_NO_VIGENTE");
    codes.cuis.fecha_expiracion = "2026-11-20T00:00:00Z"; codes.cuis.sucursal_id = "otra";
    await expect(f.engine.cancel(job)).rejects.toThrow("CUIS_NO_VIGENTE");
    expect(f.adapter.anularFactura).not.toHaveBeenCalled();
  });

  it("prepara aviso privado solo con datos oficiales suficientes, sin enviar", () => {
    const data = { estadoFiscal: "ANULADA", numeroFactura: "99", cuf: "CUF-TEST", motivo: "Error de emisión", emisor: "Emisor sintético", nitEmisor: "123456" };
    expect(prepararAvisoFiscal(data)).toContain("CUF-TEST");
    expect(prepararAvisoFiscal({ ...data, motivo: null })).toBeNull();
    expect(prepararAvisoFiscal({ ...data, nitEmisor: "" })).toBeNull();
    expect(prepararAvisoFiscal({ ...data, estadoFiscal: "VALIDADA" })).toBeNull();
    expect(prepararAvisoFiscal({ ...data, estadoFiscal: "REVERTIDA" })).toContain("reversión");
  });

  it.each(["REGISTRAR_EVENTO", "CONCILIAR_EVENTO", "GENERAR_PAQUETES_EVENTO", "ENVIAR_PAQUETE", "VALIDAR_PAQUETE", "CONCILIAR_FACTURA_PAQUETE"])("bloquea el procesamiento real de %s hasta la autorización", async (tipo_tarea) => {
    const f = fixture(); await expect(f.engine.process({ id: "test", tipo_tarea })).rejects.toThrow("CONTINGENCIA_PENDIENTE");
    expect(f.adapter.registrarEvento).not.toHaveBeenCalled(); expect(f.adapter.recepcionarPaquete).not.toHaveBeenCalled(); expect(f.adapter.verificarFactura).not.toHaveBeenCalled();
  });

  it("el agente local no habilita contingencia sin validación", () => {
    expect(() => assertContingencyPilotReady()).toThrow("CONTINGENCIA_PENDIENTE");
    const source = readFileSync("supabase/functions/siat-local-ingest/index.ts", "utf8");
    expect(source).toContain('"recovery-status"].includes(action) && (!enabled || body.contrato !== 2)');
    expect(source).toContain('action === "release-reservation" && (Deno.env.get("SIAT_CONTINGENCIA_AGENTE_CODIGO") !== agentCode || body.contrato !== 2)');
    expect(source).toContain('Deno.env.get("SIAT_CONTINGENCIA_AGENTE_CODIGO") === agentCode');
  });

  it("reversión exige 907 verdadero; errores y 908 quedan pendientes", async () => {
    const f = fixture("REVERSION_PENDIENTE"); const reverseJob = { ...job, payload: { ...payload, operacion: "REVERTIR_ANULACION" } };
    f.adapter.revertirAnulacion.mockResolvedValue(response(908, true)); await f.engine.reverse(reverseJob);
    expect(f.invoice.estado_fiscal).toBe("REVERSION_PENDIENTE");
    const success = fixture("REVERSION_PENDIENTE"); success.adapter.revertirAnulacion.mockResolvedValue(response(907, true));
    await success.engine.reverse(reverseJob); expect(success.invoice.estado_fiscal).toBe("REVERTIDA"); expect(success.invoice.fecha_reversion).toBeTruthy();
  });

  it.each([["ANULACION", 906], ["REVERSION", 909]] as const)("%s rechazada con %s conserva estado y exige revisión", async (operation, code) => {
    const reverse = operation === "REVERSION"; const f = fixture(reverse ? "REVERSION_PENDIENTE" : "ANULACION_PENDIENTE");
    const opJob = reverse ? { ...job, payload: { ...payload, operacion: "REVERTIR_ANULACION" } } : job;
    if (reverse) { f.adapter.revertirAnulacion.mockResolvedValue(response(code, false)); await f.engine.reverse(opJob); }
    else { f.adapter.anularFactura.mockResolvedValue(response(code, false)); await f.engine.cancel(opJob); }
    expect(f.invoice.estado_fiscal).toBe(reverse ? "REVERSION_PENDIENTE" : "ANULACION_PENDIENTE");
    expect(f.repository.stopJob).toHaveBeenCalledOnce(); expect(f.repository.enqueue).not.toHaveBeenCalled();
  });

  it.each([981, 924, 3011, 3012])("reversión con mensaje oficial %s se conserva para revisión", async (code) => {
    const f = fixture("REVERSION_PENDIENTE"); const raw = response(909, false); raw.mensajes = [{ codigo: code, descripcion: "Motivo oficial simulado" }];
    f.adapter.revertirAnulacion.mockResolvedValue(raw);
    await f.engine.reverse({ ...job, payload: { ...payload, operacion: "REVERTIR_ANULACION" } });
    expect(f.invoice.estado_fiscal).toBe("REVERSION_PENDIENTE"); expect(String(f.invoice.ultimo_error_sanitizado)).toContain(String(code));
    expect(f.repository.stopJob).toHaveBeenCalledOnce(); expect(f.repository.enqueue).not.toHaveBeenCalled();
  });

  it("907 contradictorio con impedimento 3011 no confirma reversión", async () => {
    const f = fixture("REVERSION_PENDIENTE"); const raw = response(907, true); raw.mensajes = [{ codigo: 3011, descripcion: "Sistema sin autorización" }];
    f.adapter.revertirAnulacion.mockResolvedValue(raw);
    await f.engine.reverse({ ...job, payload: { ...payload, operacion: "REVERTIR_ANULACION" } });
    expect(f.invoice.estado_fiscal).toBe("REVERSION_PENDIENTE"); expect(f.repository.enqueue).toHaveBeenCalled();
  });

  it("la conciliación no acepta palabras ambiguas ni validación como prueba de reversión", async () => {
    const f = fixture(); f.adapter.verificarFactura.mockResolvedValue(response(908, true));
    await f.engine.reconcileFiscalOperation(job, "ANULACION");
    f.invoice.estado_fiscal = "REVERSION_PENDIENTE";
    await f.engine.reconcileFiscalOperation(job, "REVERSION");
    expect(f.repository.updateInvoice).not.toHaveBeenCalled();
    expect(f.repository.stopJob).toHaveBeenCalledTimes(2);
  });

  it("una consulta con 907 no confirma por sí sola la reversión", async () => {
    const f = fixture("REVERSION_PENDIENTE"); f.adapter.verificarFactura.mockResolvedValue(response(907, true));
    await f.engine.reconcileFiscalOperation(job, "REVERSION");
    expect(f.invoice.estado_fiscal).toBe("REVERSION_PENDIENTE"); expect(f.invoice.fecha_reversion).toBeUndefined();
    expect(f.repository.stopJob).toHaveBeenCalledOnce();
  });

  it("un fallo en la consulta queda para revisión sin reenvío ni reintentos", async () => {
    const f = fixture(); f.adapter.verificarFactura.mockRejectedValue(new Error("SIAT_TIMEOUT"));
    await f.engine.reconcileFiscalOperation(job, "ANULACION");
    expect(f.invoice.estado_fiscal).toBe("ANULACION_PENDIENTE"); expect(f.repository.stopJob).toHaveBeenCalledOnce();
    expect(f.adapter.anularFactura).not.toHaveBeenCalled();
  });

  it("un fallo del registro del evento no permite retransmitir", async () => {
    const f = fixture(); f.adapter.registrarEvento.mockRejectedValue(new Error("SIAT_HTTP_500"));
    const eventJob = { id: "event-job", payload: { eventoId: "event" } };
    await f.engine.registerEvent(eventJob); await f.engine.registerEvent(eventJob);
    expect(f.adapter.registrarEvento).toHaveBeenCalledTimes(1); expect(f.event.estado).toBe("SIN_RESPUESTA");
  });

  it("registra un evento solo con transacción y recepción, sin retransmitirlo", async () => {
    const f = fixture(); f.adapter.registrarEvento.mockResolvedValue(response(0, true, "EVENTO-OK"));
    const eventJob = { id: "event-job", payload: { eventoId: "event" } };
    await f.engine.registerEvent(eventJob); await f.engine.registerEvent(eventJob);
    expect(f.adapter.registrarEvento).toHaveBeenCalledOnce();
    expect(f.event).toMatchObject({ estado: "ENVIADO", codigo_recepcion: "EVENTO-OK" });
    expect(f.repository.enqueue).toHaveBeenCalledWith(null, "GENERAR_PAQUETES_EVENTO", "generar_paquetes:event", { eventoId: "event" });
  });

  it("no registra evento con CUFD que no estaba vigente al inicio", async () => {
    const f = fixture(); const old = await f.repository.cufd(); old.fecha_expiracion = "2026-11-03T09:00:00Z"; f.repository.cufd.mockResolvedValue(old);
    await expect(f.engine.registerEvent({ id: "event-job", payload: { eventoId: "event" } })).rejects.toThrow("CUFD_EVENTO_NO_CORRESPONDE");
    expect(f.adapter.registrarEvento).not.toHaveBeenCalled();
  });

  it("bloquea un paquete CAFC que no corresponde al evento", async () => {
    const f = fixture(); f.event.codigo_recepcion = "event-receipt"; f.pack.cafc_id = "cafc-ajeno";
    await expect(f.engine.sendPackage({ id: "package-job", payload: { paqueteId: "package" } })).rejects.toThrow("PAQUETE_EVENTO_CUFD_O_CAFC");
    expect(f.adapter.recepcionarPaquete).not.toHaveBeenCalled();
  });

  it("no concilia eventos distintos por compartir código y descripción", async () => {
    const f = fixture(); f.adapter.consultarEventos.mockResolvedValue({ response: response(0, true), eventos: [{ codigoEvento: 1, descripcion: "Evento test", codigoRecepcion: "other", fechaHoraInicioEvento: "2026-11-03T08:00:00.000", fechaHoraFinEvento: "2026-11-03T10:00:00.000" }] });
    await expect(f.engine.reconcileEvent({ id: "query", payload: { eventoId: "event" } })).rejects.toThrow("no confirma el evento");
    expect(f.event.codigo_recepcion).toBeUndefined();
  });

  it("consulta el evento usando la fecha local de Bolivia", async () => {
    const f = fixture(); f.event.fecha_inicio = "2026-11-03T02:30:00Z"; f.event.fecha_fin = "2026-11-03T03:30:00Z";
    f.adapter.consultarEventos.mockResolvedValue({ response: response(0, true), eventos: [] });
    await expect(f.engine.reconcileEvent({ id: "query", payload: { eventoId: "event" } })).rejects.toThrow("no confirma el evento");
    expect(f.adapter.consultarEventos).toHaveBeenCalledWith(expect.anything(), "2026-11-02");
  });

  it("un fallo de envío de paquete permanece incierto y sin reenvío", async () => {
    const f = fixture(); f.event.codigo_recepcion = "event-receipt"; f.adapter.recepcionarPaquete.mockRejectedValue(new Error("SIAT_TIMEOUT"));
    const packageJob = { id: "package-job", payload: { paqueteId: "package" } };
    await f.engine.sendPackage(packageJob); await f.engine.sendPackage(packageJob);
    expect(f.adapter.recepcionarPaquete).toHaveBeenCalledTimes(1); expect(f.pack.estado).toBe("SIN_RESPUESTA");
  });

  it("recepción 901 exige transacción y código y no reenvía", async () => {
    const f = fixture(); f.event.codigo_recepcion = "event-receipt";
    f.adapter.recepcionarPaquete.mockResolvedValue(response(901, true, "PAQUETE-OK"));
    const packageJob = { id: "package-job", payload: { paqueteId: "package" } };
    await f.engine.sendPackage(packageJob); await f.engine.sendPackage(packageJob);
    expect(f.adapter.recepcionarPaquete).toHaveBeenCalledOnce();
    expect(f.pack).toMatchObject({ estado: "RECEPCIONADO", codigo_recepcion: "PAQUETE-OK" });
    expect(f.repository.enqueue).toHaveBeenCalledWith(null, "VALIDAR_PAQUETE", "validar_paquete:package", { paqueteId: "package" });
  });

  it("rechaza el envío cuando el archivo del paquete fue alterado", async () => {
    const f = fixture(); f.event.codigo_recepcion = "event-receipt"; f.pack.archivo_hash = "0".repeat(64);
    await expect(f.engine.sendPackage({ id: "package-job", payload: { paqueteId: "package" } })).rejects.toThrow("PAQUETE_HASH_NO_COINCIDE");
    expect(f.adapter.recepcionarPaquete).not.toHaveBeenCalled(); expect(f.repository.markFiscalMutationStarted).not.toHaveBeenCalled();
  });

  it("empaqueta el XML privado íntegro sin cambiar el estado antes de la RPC", async () => {
    const f = fixture(); const xml = "<factura>original sintético</factura>"; const gz = await gzipBytes(xml);
    f.repository.download.mockResolvedValue(gz);
    f.repository.offlineInvoices.mockResolvedValue([{ id: "synthetic", documento_sector: 1, sucursal_id: "branch", cufd_id: "old", modalidad: "ELECTRONICA", cuf: "CUF-1", fecha_emision: "2026-11-01", xml_storage_path: "private.gz", xml_hash: await sha256Hex(gz) }]);
    await f.engine.buildEventPackages({ id: "job", payload: { eventoId: "event" } });
    expect(f.repository.createPackage).toHaveBeenCalledOnce();
    expect(f.repository.updateEvent).not.toHaveBeenCalledWith("event", { estado: "EMPAQUETANDO" });
    f.repository.offlineInvoices.mockResolvedValue([{ id: "synthetic", cuf: "CUF-1", xml_storage_path: "private.gz", xml_hash: "0".repeat(64) }]);
    f.repository.createPackage.mockClear();
    await expect(f.engine.buildEventPackages({ id: "job2", payload: { eventoId: "event" } })).rejects.toThrow("XML_OFFLINE_HASH_NO_COINCIDE");
    expect(f.repository.createPackage).not.toHaveBeenCalled();
  });

  it("no marca paquete validado con 908 y transacción falsa", async () => {
    const f = fixture(); f.pack.codigo_recepcion = "receipt"; f.adapter.validarPaquete.mockResolvedValue(response(908, false));
    await expect(f.engine.validatePackage({ id: "validation", payload: { paqueteId: "package" } })).rejects.toThrow("no concluyente");
    expect(f.repository.finishPackage).not.toHaveBeenCalled();
  });

  it("un 908 no acepta un paquete con enlaces incompletos o mensajes parciales", async () => {
    const f = fixture("EMPAQUETADA"); f.pack.codigo_recepcion = "receipt"; f.pack.cantidad_facturas = 2;
    f.adapter.validarPaquete.mockResolvedValue(response(908, true));
    await expect(f.engine.validatePackage({ id: "validation", payload: { paqueteId: "package" } })).rejects.toThrow("PAQUETE_COBERTURA_INCOMPLETA");
    expect(f.repository.finishPackage).not.toHaveBeenCalled();
    f.pack.cantidad_facturas = 1; const partial = response(908, true); partial.mensajes = [{ codigo: 1, descripcion: "Documento individual", numeroArchivo: 1 }];
    f.adapter.validarPaquete.mockResolvedValue(partial);
    await expect(f.engine.validatePackage({ id: "validation", payload: { paqueteId: "package" } })).rejects.toThrow("RESULTADOS_INDIVIDUALES");
    expect(f.repository.finishPackage).not.toHaveBeenCalled();
  });

  it("acepta 908 verdadero solo si el paquete cubre todas las facturas", async () => {
    const f = fixture("EMPAQUETADA"); f.pack.codigo_recepcion = "receipt";
    f.adapter.validarPaquete.mockResolvedValue(response(908, true));
    await f.engine.validatePackage({ id: "validation", payload: { paqueteId: "package" } });
    expect(f.repository.finishPackage).toHaveBeenCalledWith("package", "VALIDADA", []);
  });

  it("un paquete 904 observado no inventa el estado de cada factura", async () => {
    const f = fixture(); f.pack.codigo_recepcion = "receipt"; f.adapter.validarPaquete.mockResolvedValue(response(904, false));
    await f.engine.validatePackage({ id: "validation", payload: { paqueteId: "package" } });
    expect(f.pack.estado).toBe("OBSERVADO"); expect(f.repository.finishPackage).not.toHaveBeenCalled();
    expect(f.repository.enqueue).toHaveBeenCalledWith("fake-invoice", "CONCILIAR_FACTURA_PAQUETE", expect.any(String), { paqueteId: "package" });
  });

  it.each([[908, true, "receipt", "VALIDADA"], [904, false, null, "OBSERVADA"], [908, true, null, "EMPAQUETADA"], [902, false, null, "EMPAQUETADA"]] as const)("concilia individualmente %s/%s como %s", async (code, transaction, receipt, expected) => {
    const f = fixture("EMPAQUETADA"); f.pack.estado = "OBSERVADO"; f.adapter.verificarFactura.mockResolvedValue(response(code, transaction, receipt));
    await f.engine.reconcilePackageInvoice({ id: "ind", factura_id: "fake-invoice", payload: { paqueteId: "package" } });
    expect(f.invoice.estado_fiscal).toBe(expected); expect(f.adapter.verificarFactura).toHaveBeenCalledTimes(1);
    if (expected === "EMPAQUETADA") expect(f.repository.updateInvoiceIfState).not.toHaveBeenCalled();
  });

  it("no sobrescribe un estado fiscal cambiado durante la consulta individual", async () => {
    const f = fixture("EMPAQUETADA"); f.pack.estado = "OBSERVADO";
    f.adapter.verificarFactura.mockImplementation(async () => { f.invoice.estado_fiscal = "VALIDADA"; return response(904, false); });
    await f.engine.reconcilePackageInvoice({ id: "ind", factura_id: "fake-invoice", payload: { paqueteId: "package" } });
    expect(f.invoice.estado_fiscal).toBe("VALIDADA");
  });

  it("no consulta una factura ajena al paquete", async () => {
    const f = fixture("EMPAQUETADA"); f.pack.estado = "OBSERVADO";
    await expect(f.engine.reconcilePackageInvoice({ id: "ind", factura_id: "otra", payload: { paqueteId: "package" } })).rejects.toThrow("FACTURA_NO_PERTENECE");
    expect(f.adapter.verificarFactura).not.toHaveBeenCalled();
  });

  it("migración y gateway mantienen el control administrativo y bloqueo real", () => {
    const sql = readFileSync("supabase/migrations/20261103010000_siat_paso9_operaciones_piloto.sql", "utf8");
    expect(sql).toContain("FOR UPDATE"); expect(sql).toContain("p_confirmacion IS DISTINCT FROM true");
    expect(sql).toContain("v_factura.fecha_reversion IS NOT NULL"); expect(sql).toContain("REVOKE ALL ON FUNCTION public.siat_solicitar_operacion_factura");
    const gateway = readFileSync("supabase/functions/siat-gateway/index.ts", "utf8");
    expect(gateway).toContain('["prepare-invoice", "reverse"].includes(action)'); expect(gateway).toContain('SIAT_ANULACION_PILOTO_HABILITADA');
    const ui = readFileSync("src/features/facturas/components/SiatShared.tsx", "utf8");
    expect(ui).toContain("capabilities.data?.reversion !== true"); expect(ui).toContain("destinationReady");
    expect(readFileSync("src/features/facturas/components/FiscalEvidencePanel.tsx", "utf8")).toContain("entrega no verificada");
    const queue = readFileSync("supabase/migrations/20261103020000_siat_aislar_tareas_paso9.sql", "utf8");
    expect(queue).toContain("'ANULAR_FACTURA'"); expect(queue).toContain("'REVERTIR_ANULACION'"); expect(queue).toContain("'REGISTRAR_EVENTO'");
  });
});

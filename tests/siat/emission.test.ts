import { describe, expect, it, vi } from "vitest";
import { assertActiveInvoiceFiscalCodes, classifyInvoiceReception, SiatEngine } from "../../supabase/functions/_shared/siat/engine.ts";
import type { SiatAdapter, SiatResponse } from "../../supabase/functions/_shared/siat/types.ts";
import type { SiatRepository } from "../../supabase/functions/_shared/siat/repository.ts";

async function applyReception(response: SiatResponse) {
  const repository = {
    updateInvoice: vi.fn().mockResolvedValue(undefined), finishAttempt: vi.fn().mockResolvedValue(undefined),
    audit: vi.fn().mockResolvedValue(undefined), enqueue: vi.fn().mockResolvedValue(undefined),
    completeJob: vi.fn().mockResolvedValue(undefined),
  } as unknown as SiatRepository;
  const engine = new SiatEngine(repository, {} as SiatAdapter, {}, async () => "");
  const internals = engine as unknown as {
    handleReception: (invoiceId: string, jobId: string, attemptId: string, snapshot: never, response: SiatResponse) => Promise<void>;
    persistRepresentation: (invoiceId: string, snapshot: never) => Promise<Record<string, unknown>>;
  };
  internals.persistRepresentation = vi.fn().mockResolvedValue({ pdf_storage_path: "test.pdf" });
  await internals.handleReception("invoice-1", "job-1", "attempt-1", {} as never, response);
  return { repository, persistRepresentation: internals.persistRepresentation };
}

describe("emisión individual SIAT", () => {
  it("marca VALIDADA únicamente con código 908, transacción exitosa y recepción", () => {
    expect(classifyInvoiceReception({ codigoEstado: 908, transaccion: true, codigoRecepcion: "REC-908" })).toEqual({
      state: "VALIDADA", accepted: true, observed: false, inconclusive: false,
    });
    expect(classifyInvoiceReception({ codigoEstado: 908, transaccion: false, codigoRecepcion: "REC-908" }).state).toBe("SIN_RESPUESTA");
    expect(classifyInvoiceReception({ codigoEstado: 908, transaccion: true, codigoRecepcion: null }).state).toBe("SIN_RESPUESTA");
  });

  it("conserva una respuesta 904 como OBSERVADA, nunca VALIDADA", () => {
    expect(classifyInvoiceReception({ codigoEstado: 904, transaccion: true, codigoRecepcion: "REC-904" })).toEqual({
      state: "OBSERVADA", accepted: false, observed: true, inconclusive: false,
    });
  });

  it("persiste 908 como VALIDADA y 904 como OBSERVADA, guardando mensajes", async () => {
    const accepted = await applyReception({ codigoEstado: 908, codigoDescripcion: "VALIDADO", codigoRecepcion: "REC-908", transaccion: true, mensajes: [], rawSanitizado: { codigoEstado: 908 } });
    expect(accepted.repository.updateInvoice).toHaveBeenCalledWith("invoice-1", expect.objectContaining({ estado_fiscal: "VALIDADA", codigo_recepcion: "REC-908" }));
    expect(accepted.persistRepresentation).toHaveBeenCalledOnce();

    const observed = await applyReception({ codigoEstado: 904, codigoDescripcion: "OBSERVADO", codigoRecepcion: "REC-904", transaccion: false, mensajes: [{ codigo: 1, descripcion: "Detalle observado" }], rawSanitizado: { codigoEstado: 904 } });
    expect(observed.repository.updateInvoice).toHaveBeenCalledWith("invoice-1", expect.objectContaining({ estado_fiscal: "OBSERVADA", mensajes_siat: [{ codigo: 1, descripcion: "Detalle observado" }] }));
    expect(observed.persistRepresentation).not.toHaveBeenCalled();
  });

  it("trata estados no concluyentes como SIN_RESPUESTA para conciliación", () => {
    expect(classifyInvoiceReception({ codigoEstado: 901, transaccion: true, codigoRecepcion: null })).toEqual({
      state: "SIN_RESPUESTA", accepted: false, observed: false, inconclusive: true,
    });
  });

  it("rechaza CUIS y CUFD vencidos o que no pertenecen al snapshot", () => {
    const now = Date.parse("2026-10-22T12:00:00.000Z");
    const invoice = { ambiente: "PRUEBAS", sucursal_id: "branch-1", punto_venta_id: null, cuis_id: "cuis-1", cuis: "CUIS-1", cufd_id: "cufd-1", cufd: "CUFD-1" };
    const cuis = { id: "cuis-1", codigo: "CUIS-1", estado: "VIGENTE", ambiente: "PRUEBAS", sucursal_id: "branch-1", punto_venta_id: null, fecha_expiracion: "2026-10-23T00:00:00.000Z" };
    const cufd = { id: "cufd-1", codigo: "CUFD-1", estado: "VIGENTE", ambiente: "PRUEBAS", sucursal_id: "branch-1", punto_venta_id: null, cuis_id: "cuis-1", fecha_inicio: "2026-10-21T00:00:00.000Z", fecha_expiracion: "2026-10-23T00:00:00.000Z" };
    expect(() => assertActiveInvoiceFiscalCodes(invoice, cuis, cufd, now)).not.toThrow();
    expect(() => assertActiveInvoiceFiscalCodes(invoice, { ...cuis, fecha_expiracion: "2026-10-22T11:59:59.000Z" }, cufd, now)).toThrow("CUIS_NO_VIGENTE");
    expect(() => assertActiveInvoiceFiscalCodes(invoice, cuis, { ...cufd, fecha_expiracion: "2026-10-22T11:59:59.000Z" }, now)).toThrow("CUFD_NO_VIGENTE");
    expect(() => assertActiveInvoiceFiscalCodes(invoice, cuis, { ...cufd, cuis_id: "another-cuis" }, now)).toThrow("CUFD_NO_CORRESPONDE");
  });

  it("no llama al adaptador ni procesa una factura cuando SIAT está deshabilitado", async () => {
    const repository = {
      invoice: vi.fn().mockResolvedValue({ estado_fiscal: "EN_COLA" }),
      configuration: vi.fn().mockResolvedValue({ siat_habilitado: false }),
      branch: vi.fn(), cufd: vi.fn(), updateInvoice: vi.fn(),
    } as unknown as SiatRepository;
    const adapter = { recepcionarFactura: vi.fn() } as unknown as SiatAdapter;
    const engine = new SiatEngine(repository, adapter, {}, async () => "");

    await expect(engine.emit({ id: "job-1", factura_id: "invoice-1" })).rejects.toThrow("SIAT_EMISION_NO_HABILITADA");
    expect(repository.branch).not.toHaveBeenCalled();
    expect(repository.updateInvoice).not.toHaveBeenCalled();
    expect(adapter.recepcionarFactura).not.toHaveBeenCalled();
  });
});

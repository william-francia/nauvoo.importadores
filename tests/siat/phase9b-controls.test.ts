import { afterEach, describe, expect, it, vi } from "vitest";
import { assertEventReadyForRegistration, assertRecoveryCufd } from "../../supabase/functions/_shared/siat/contingency-controls.ts";
import { createTar } from "../../supabase/functions/_shared/siat/tar.ts";
import { gzipBytes, sha256Hex } from "../../supabase/functions/_shared/siat/encoding.ts";
import { uploadImmutableFiscalArtifact } from "../../supabase/functions/_shared/siat/immutable-artifact.ts";
import { OfficialVigenteAdapter } from "../../supabase/functions/_shared/siat/official-vigente.adapter.ts";
import { assertManualTranscriptionAllowed, assertOfflineCufd, offlineDocumentType } from "../../agent-local/src/contingency-safety.ts";

const event = { tipo_evento_codigo: "1", descripcion: "Caso sintético", fecha_inicio: "2026-11-01T10:00:00Z", fecha_fin: "2026-11-01T11:00:00Z", evidencia_deteccion: { prueba: true }, cufd_id: "original" };
const original = { id: "original", fecha_inicio: "2026-11-01T00:00:00Z", fecha_expiracion: "2026-11-02T00:00:00Z" };
const localEvent = { fechaInicio: event.fecha_inicio, cufdId: "original" };
afterEach(() => vi.restoreAllMocks());
describe("controles locales de contingencia sin operaciones fiscales", () => {
  it.each([1,2,3,4,5,6,7])("reconoce el evento oficial %s con evidencia", (code) => {
    expect(() => assertEventReadyForRegistration({ ...event, tipo_evento_codigo: code }, Date.parse("2026-11-03T11:00:00Z"))).not.toThrow();
  });
  it("bloquea evidencia ausente, fecha futura, evento incorrecto o plazo vencido", () => {
    expect(() => assertEventReadyForRegistration({ ...event, evidencia_deteccion: {} }, Date.parse("2026-11-01T12:00:00Z"))).toThrow("EVIDENCIA");
    expect(() => assertEventReadyForRegistration(event, Date.parse("2026-11-01T10:30:00Z"))).toThrow("FECHAS");
    expect(() => assertEventReadyForRegistration({ ...event, tipo_evento_codigo: 8 }, Date.parse("2026-11-01T12:00:00Z"))).toThrow("TIPO");
    expect(() => assertEventReadyForRegistration(event, Date.parse("2026-11-03T11:00:00.001Z"))).toThrow("PLAZO");
  });
  it("mantiene CUFD original y exige uno nuevo después de recuperar", () => {
    expect(() => assertOfflineCufd(localEvent, original, "2026-11-01T20:00:00Z")).not.toThrow();
    expect(() => assertOfflineCufd(localEvent, original, "2026-11-02T00:00:00Z")).toThrow("EXTENSION_CUFD");
    expect(() => assertOfflineCufd(localEvent, { ...original, id: "otro" }, "2026-11-01T20:00:00Z")).toThrow("CUFD_EVENTO");
    expect(() => assertRecoveryCufd(event, { id: "nuevo", fecha_inicio: event.fecha_fin })).not.toThrow();
    expect(() => assertRecoveryCufd(event, { id: "original", fecha_inicio: event.fecha_fin })).toThrow("CUFD_NUEVO");
    expect(() => assertRecoveryCufd(event, { id: "nuevo", fecha_inicio: event.fecha_inicio })).toThrow("CUFD_NUEVO");
  });
  it("usa excepción 1 solo para NIT y bloquea transcripción manual incompleta", () => {
    expect(offlineDocumentType("NIT")).toEqual({ code: 5, exception: 1 });
    expect(offlineDocumentType("CI")).toEqual({ code: 1, exception: null });
    expect(() => offlineDocumentType("desconocido")).toThrow("TIPO_DOCUMENTO");
    expect(() => assertManualTranscriptionAllowed({ rangeId: "x" })).toThrow("TRANSCRIPCION_CAFC");
    expect(() => assertManualTranscriptionAllowed(null)).not.toThrow();
  });
  it("genera el mismo hash del paquete al reanudar en otro momento", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_000);
    try {
      const entries = [{ name: "001_CUF.xml", content: new TextEncoder().encode("<factura>prueba</factura>") }];
      const first = await sha256Hex(await gzipBytes(createTar(entries)));
      clock.mockReturnValue(1_800_000_000_000);
      const second = await sha256Hex(await gzipBytes(createTar(entries)));
      expect(second).toBe(first);
    } finally { clock.mockRestore(); }
  });
  it("no sobrescribe documentos al repetir una importación", async () => {
    const old = new Uint8Array([1, 2, 3]);
    const bucket = { upload: vi.fn(async () => ({ error: new Error("existe") })), download: vi.fn(async () => ({ data: new Blob([old]), error: null })) };
    await expect(uploadImmutableFiscalArtifact(bucket, "documento", old, "application/gzip")).resolves.toBeUndefined();
    await expect(uploadImmutableFiscalArtifact(bucket, "documento", new Uint8Array([4]), "application/gzip")).rejects.toThrow("NO_COINCIDE");
    expect(bucket.upload).toHaveBeenCalledWith("documento", old, { contentType: "application/gzip", upsert: false });
  });
  it("serializa y lee consulta de eventos con transporte simulado", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<Envelope><Body><transaccion>true</transaccion><listaEventos><codigoEvento>1</codigoEvento><descripcion>fallo</descripcion></listaEventos></Body></Envelope>"));
    const adapter = new OfficialVigenteAdapter("token-sintetico", { operaciones: "https://sin-red.invalid" });
    const context = { ambiente: "PRUEBAS" as const, versionNormativa: "SIAT_VIGENTE" as const, modalidad: "ELECTRONICA" as const, codigoSistema: "SIS", codigoSucursal: 0, codigoPuntoVenta: null, nit: "1", cuis: "CUIS", cufd: "CUFD" };
    const result = await adapter.consultarEventos(context, "2026-11-02");
    expect(result.response.transaccion).toBe(true); expect(result.eventos).toEqual([{ codigoEvento: "1", descripcion: "fallo" }]);
    const envelope = String(fetchMock.mock.calls[0]?.[1]?.body);
    expect(envelope).toContain("<siat:consultaEventoSignificativo>"); expect(envelope).toContain("<fechaEvento>2026-11-02</fechaEvento>");
    expect(envelope).toContain("<cufd>CUFD</cufd>"); expect(fetchMock).toHaveBeenCalledOnce();
  });
});

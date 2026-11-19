import { describe, expect, it, vi } from "vitest";
import { classifyPilotNit, pilotCertificateEvidenceMatches, pilotNitEvidenceMatches } from "../../supabase/functions/_shared/siat/pilot-approval.ts";
import { OfficialVigenteAdapter } from "../../supabase/functions/_shared/siat/official-vigente.adapter.ts";
import type { SiatResponse } from "../../supabase/functions/_shared/siat/types.ts";

const response = (transaccion: boolean | null, ...codes: number[]): SiatResponse => ({
  transaccion, codigoEstado: null, codigoDescripcion: null, codigoRecepcion: null,
  mensajes: codes.map((codigo) => ({ codigo, descripcion: "respuesta" })), rawSanitizado: {},
});

describe("verificación NIT piloto", () => {
  it("solo aprueba 986 con transacción verdadera", () => {
    expect(classifyPilotNit(response(true, 986)).resultado).toBe("ACTIVO");
    expect(classifyPilotNit(response(false, 986)).resultado).toBe("ERROR_SERVICIO");
    expect(classifyPilotNit(response(true, 986, 992)).resultado).toBe("ERROR_SERVICIO");
    expect(classifyPilotNit(response(false, 987)).resultado).toBe("INACTIVO");
    expect(classifyPilotNit(response(false, 994)).resultado).toBe("INEXISTENTE");
    for (const code of [992, 995, 999]) expect(classifyPilotNit(response(false, code)).resultado).toBe("ERROR_SERVICIO");
  });

  it("envía los siete campos y usa el parser SOAP existente", async () => {
    const originalFetch = globalThis.fetch;
    const called = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
      const body = String(options?.body);
      for (const tag of ["codigoAmbiente", "codigoModalidad", "codigoSistema", "codigoSucursal", "cuis", "nit", "nitParaVerificacion"]) expect(body).toContain(`<${tag}>`);
      expect(body).toContain("<codigoAmbiente>2</codigoAmbiente>");
      expect(body).toContain("<codigoModalidad>1</codigoModalidad>");
      expect(body).toContain("<codigoSucursal>0</codigoSucursal>");
      expect(body).toContain("<nit>72229012</nit>");
      expect(body).toContain("<nitParaVerificacion>9204357</nitParaVerificacion>");
      return new Response('<Envelope><Body><verificarNitResponse><RespuestaVerificarNit><mensajesList><codigo>986</codigo><descripcion>NIT Activo</descripcion></mensajesList><transaccion>true</transaccion></RespuestaVerificarNit></verificarNitResponse></Body></Envelope>', { status: 200 });
    });
    globalThis.fetch = called as typeof fetch;
    try {
      const adapter = new OfficialVigenteAdapter("test-token");
      const result = await adapter.verificarNit({ ambiente: "PRUEBAS", versionNormativa: "SIAT_VIGENTE", modalidad: "ELECTRONICA", codigoSistema: "SISTEMA", codigoSucursal: 0, codigoPuntoVenta: null, nit: "72229012", cuis: "CUIS" }, "9204357");
      expect(classifyPilotNit(result)).toEqual({ resultado: "ACTIVO", codigo: 986 });
      expect(called).toHaveBeenCalledTimes(1);
    } finally { globalThis.fetch = originalFetch; }
  });

  it("invalida evidencia si cambia NIT, vence la verificación o cambia el certificado", () => {
    const client = { id: "client", numero_documento: "9204357" };
    const control = { nit_cliente_verificado: true, nit_cliente_id: "client", nit_cliente_documento: "9204357", nit_ambiente: "PRUEBAS", nit_codigo_respuesta: 986, nit_verificado_at: new Date().toISOString(), eku_fiscal_aprobado: true, eku_cert_sha256: "a".repeat(64), eku_tipo_evidencia: "CONFIRMACION_VERBAL_REPORTADA_POR_USUARIO", eku_alcance: "PRUEBAS", eku_aprobado_por: "admin", eku_declaracion_at: new Date().toISOString(), eku_aprobado_at: new Date().toISOString() };
    expect(pilotNitEvidenceMatches(control, client, "PRUEBAS")).toBe(true);
    expect(pilotNitEvidenceMatches(control, { ...client, numero_documento: "1" }, "PRUEBAS")).toBe(false);
    expect(pilotNitEvidenceMatches({ ...control, nit_verificado_at: "2020-01-01" }, client, "PRUEBAS")).toBe(false);
    expect(pilotCertificateEvidenceMatches(control, "a".repeat(64))).toBe(true);
    expect(pilotCertificateEvidenceMatches(control, "b".repeat(64))).toBe(false);
    expect(pilotCertificateEvidenceMatches({ ...control, eku_alcance: "PRODUCCION" }, "a".repeat(64))).toBe(false);
  });
});

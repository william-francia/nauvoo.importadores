import { afterEach, describe, expect, it, vi } from "vitest";
import { OfficialVigenteAdapter } from "../../supabase/functions/_shared/siat/official-vigente.adapter.ts";
import { sanitizeErrorMessage, SoapClient } from "../../supabase/functions/_shared/siat/soap.ts";
import { AmbiguousSiatError } from "../../supabase/functions/_shared/siat/types.ts";

const context = { ambiente: "PRUEBAS" as const, versionNormativa: "SIAT_VIGENTE" as const, codigoSistema: "ABC", nit: "123", modalidad: "ELECTRONICA" as const, codigoSucursal: 0, codigoPuntoVenta: 0, cuis: "CUIS" };
const envelope = (body: string) => `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;

afterEach(() => vi.unstubAllGlobals());

describe("SOAP SIAT", () => {
  it("envía el token solo en backend y analiza CUIS/CUFD", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(envelope("<cuisResponse><RespuestaCuis><codigo>CUIS-OK</codigo><fechaVigencia>2026-09-22T00:00:00</fechaVigencia><transaccion>true</transaccion></RespuestaCuis></cuisResponse>"), { status: 200 }))
      .mockResolvedValueOnce(new Response(envelope("<cufdResponse><RespuestaCufd><codigo>CUFD-OK</codigo><codigoControl>CTRL</codigoControl><direccion>La Paz</direccion><fechaVigencia>2026-09-18T23:59:59</fechaVigencia><transaccion>true</transaccion></RespuestaCufd></cufdResponse>"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new OfficialVigenteAdapter("secret-token");
    expect((await adapter.solicitarCuis(context)).codigo).toBe("CUIS-OK");
    expect((await adapter.solicitarCufd(context)).codigoControl).toBe("CTRL");
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.apikey).toBe("TokenApi secret-token");
    expect(String(fetchMock.mock.calls[0][1].body)).not.toContain("secret-token");
    expect(String(fetchMock.mock.calls[0][1].body)).toContain("<codigoAmbiente>2</codigoAmbiente>");
    expect(String(fetchMock.mock.calls[0][1].body)).toContain("<codigoModalidad>1</codigoModalidad>");
    const cufdBody = String(fetchMock.mock.calls[1][1].body);
    expect(cufdBody.indexOf("<cuis>")).toBeLessThan(cufdBody.indexOf("<nit>"));
    expect(cufdBody).toContain("<SolicitudCufd>");
  });

  it("usa la operación vacía definida por el WSDL para verificar comunicación", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(envelope("<verificarComunicacionResponse><return><transaccion>true</transaccion></return></verificarComunicacionResponse>"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock); const adapter = new OfficialVigenteAdapter("token");
    expect((await adapter.verificarComunicacion()).transaccion).toBe(true);
    const body = String(fetchMock.mock.calls[0][1].body);
    expect(fetchMock.mock.calls[0][0]).toBe("https://pilotosiatservicios.impuestos.gob.bo/v2/FacturacionCodigos");
    expect(body).toContain("<siat:verificarComunicacion></siat:verificarComunicacion>");
    expect(body).not.toContain("SolicitudVerificarComunicacion");
  });

  it("conserva el endpoint piloto cuando un override no está configurado", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(envelope("<verificarComunicacionResponse><return><transaccion>true</transaccion></return></verificarComunicacionResponse>"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await new OfficialVigenteAdapter("token", { codigos: undefined }).verificarComunicacion();
    expect(fetchMock.mock.calls[0][0]).toBe("https://pilotosiatservicios.impuestos.gob.bo/v2/FacturacionCodigos");
  });

  it("prepara recepcionFactura con contrato piloto y archivo GZIP simulado", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(envelope("<recepcionFacturaResponse><return><codigoEstado>908</codigoEstado><codigoRecepcion>REC-908</codigoRecepcion><transaccion>true</transaccion></return></recepcionFacturaResponse>"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new OfficialVigenteAdapter("token-local");
    const result = await adapter.recepcionarFactura({
      context: { ...context, documentoSector: 1, tipoFactura: 1 }, cufd: "CUFD-REAL-NO-USADO", documentoSector: 1, tipoFactura: 1,
      archivo: new Uint8Array([0x1f, 0x8b, 0x08]), hashArchivo: "A".repeat(64), fechaEnvio: "2026-10-22T12:00:00.000Z",
    });
    const body = String(fetchMock.mock.calls[0][1].body);
    expect(result).toMatchObject({ codigoEstado: 908, codigoRecepcion: "REC-908", transaccion: true });
    expect(fetchMock.mock.calls[0][0]).toBe("https://pilotosiatservicios.impuestos.gob.bo/v2/ServicioFacturacionCompraVenta");
    expect((fetchMock.mock.calls[0][1].headers as Record<string, string>).apikey).toBe("TokenApi token-local");
    for (const field of ["codigoAmbiente", "codigoSistema", "nit", "codigoSucursal", "codigoPuntoVenta", "codigoDocumentoSector", "codigoEmision", "codigoModalidad", "tipoFacturaDocumento", "cuis", "cufd", "archivo", "fechaEnvio", "hashArchivo"]) expect(body).toContain(`<${field}>`);
    expect(body).toContain("<codigoAmbiente>2</codigoAmbiente>");
    expect(body).toContain("<codigoEmision>1</codigoEmision>");
    expect(body).toContain("<codigoModalidad>1</codigoModalidad>");
    expect(body).toContain("<codigoDocumentoSector>1</codigoDocumentoSector>");
    expect(body).toContain("<tipoFacturaDocumento>1</tipoFacturaDocumento>");
    expect(body).toContain(`<hashArchivo>${"A".repeat(64)}</hashArchivo>`);
    expect(body).not.toContain("token-local");
  });

  it("clasifica timeout posterior al envío como respuesta ambigua", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timeout", "AbortError")));
    const client = new SoapClient("https://pilotosiatservicios.impuestos.gob.bo/test", "token", 10);
    await expect(client.call("recepcionFactura", "ServicioRecepcionFactura", { archivo: "AA==" }, { ambiguousOnTimeout: true })).rejects.toBeInstanceOf(AmbiguousSiatError);
  });

  it("no confunde SOAP Fault con recepción válida", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(envelope("<soap:Fault><faultcode>Server</faultcode><faultstring>Solicitud inválida</faultstring></soap:Fault>"), { status: 200 })));
    const client = new SoapClient("https://pilotosiatservicios.impuestos.gob.bo/test", "token");
    await expect(client.call("recepcionFactura", "ServicioRecepcionFactura", { archivo: "AA==" })).rejects.toThrow("SIAT_SOAP_FAULT: Solicitud inválida");
  });

  it("redacta tokens y material PEM de los errores antes de propagarlos", () => {
    const message = sanitizeErrorMessage("falló TokenApi secreto-super-sensible; apikey: otra-clave -----BEGIN PRIVATE KEY-----\nclave\n-----END PRIVATE KEY-----");
    expect(message).toContain("TokenApi [REDACTED]");
    expect(message).toContain("[REDACTED]");
    expect(message).not.toContain("secreto-super-sensible");
    expect(message).not.toContain("otra-clave");
    expect(message).not.toContain("clave");
  });

  it("conserva el diagnóstico HTTP del SIN sin exponer secretos", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<fault><message>Token inválido</message></fault>", { status: 400 })));
    const client = new SoapClient("https://pilotosiatservicios.impuestos.gob.bo/test", "token");
    await expect(client.call("verificarComunicacion", null, {})).rejects.toThrow("SIAT_HTTP_400: Token inválido");
  });

  it("no procesa entidades XML externas", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(envelope('<!DOCTYPE x [<!ENTITY ext SYSTEM "file:///etc/passwd">]><x>&ext;</x>'), { status: 200 })));
    const client = new SoapClient("https://pilotosiatservicios.impuestos.gob.bo/test", "token");
    await expect(client.call("x", "X", {})).rejects.toThrow(/External entities are not supported/);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { OfficialVigenteAdapter } from "../../supabase/functions/_shared/siat/official-vigente.adapter.ts";
import { SoapClient } from "../../supabase/functions/_shared/siat/soap.ts";
import { AmbiguousSiatError } from "../../supabase/functions/_shared/siat/types.ts";

const context = { ambiente: "PRUEBAS" as const, versionNormativa: "SIAT_VIGENTE" as const, codigoSistema: "ABC", nit: "123", modalidad: "COMPUTARIZADA" as const, codigoSucursal: 0, codigoPuntoVenta: 0, cuis: "CUIS" };
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
    const cufdBody = String(fetchMock.mock.calls[1][1].body);
    expect(cufdBody.indexOf("<cuis>")).toBeLessThan(cufdBody.indexOf("<nit>"));
    expect(cufdBody).toContain("<SolicitudCufd>");
  });

  it("usa la operación vacía definida por el WSDL para verificar comunicación", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(envelope("<verificarComunicacionResponse><return><transaccion>true</transaccion></return></verificarComunicacionResponse>"), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock); const adapter = new OfficialVigenteAdapter("token");
    expect((await adapter.verificarComunicacion()).transaccion).toBe(true);
    const body = String(fetchMock.mock.calls[0][1].body);
    expect(body).toContain("<siat:verificarComunicacion></siat:verificarComunicacion>");
    expect(body).not.toContain("SolicitudVerificarComunicacion");
  });

  it("clasifica timeout posterior al envío como respuesta ambigua", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("timeout", "AbortError")));
    const client = new SoapClient("https://pilotosiatservicios.impuestos.gob.bo/test", "token", 10);
    await expect(client.call("recepcionFactura", "ServicioRecepcionFactura", { archivo: "AA==" }, { ambiguousOnTimeout: true })).rejects.toBeInstanceOf(AmbiguousSiatError);
  });

  it("no procesa entidades XML externas", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(envelope('<!DOCTYPE x [<!ENTITY ext SYSTEM "file:///etc/passwd">]><x>&ext;</x>'), { status: 200 })));
    const client = new SoapClient("https://pilotosiatservicios.impuestos.gob.bo/test", "token");
    await expect(client.call("x", "X", {})).rejects.toThrow(/External entities are not supported/);
  });
});

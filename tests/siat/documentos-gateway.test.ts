import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../../src/lib/supabase", () => ({ supabase: { functions: { invoke: mocks.invoke } } }));
import { obtenerXmlFiscalComprimido } from "../../src/features/facturas/services/siat.gateway.service";

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe("acceso seguro al XML", () => {
  it("no descarga desde un gateway que no declara el control de acceso actualizado", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    mocks.invoke.mockResolvedValue({ data: { url: "https://example.invalid/xml.gz" }, error: null });
    await expect(obtenerXmlFiscalComprimido("test")).rejects.toThrow("actualizar el gateway");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("recupera el archivo protegido cuando el gateway actualizado lo autoriza", async () => {
    const bytes = new Uint8Array([31, 139, 1]);
    const fetch = vi.fn().mockResolvedValue(new Response(bytes)); vi.stubGlobal("fetch", fetch);
    mocks.invoke.mockResolvedValue({ data: { url: "https://example.invalid/xml.gz", documentAccess: "ADMIN_VALIDATED_V1" }, error: null });
    expect(await obtenerXmlFiscalComprimido("test")).toEqual(bytes);
    expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith("siat-gateway", { body: { action: "download", facturaId: "test", type: "XML" } });
  });
});

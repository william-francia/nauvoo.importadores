import { describe, expect, it } from "vitest";
import { createTar } from "../../supabase/functions/_shared/siat/tar.ts";

describe("paquetes TAR SIAT", () => {
  it("genera USTAR alineado con cierre de dos bloques", () => {
    const tar = createTar([{ name: "factura-1.xml", content: new TextEncoder().encode("<factura/>") }]);
    expect(tar.byteLength % 512).toBe(0);
    expect(new TextDecoder().decode(tar.slice(257, 262))).toBe("ustar");
    expect(tar.slice(-1024).every(byte => byte === 0)).toBe(true);
  });
  it("rechaza nombres duplicados y más de 500 facturas", () => {
    const entry = { name: "factura.xml", content: new Uint8Array([1]) };
    expect(() => createTar([entry, entry])).toThrow(/duplicado/);
    expect(() => createTar(Array.from({ length: 501 }, (_, index) => ({ name: `f-${index}.xml`, content: new Uint8Array() })))).toThrow(/500/);
  });
});

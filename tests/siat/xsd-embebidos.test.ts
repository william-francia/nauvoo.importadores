import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { XSD_SIAT, xsdSiat } from "../../supabase/functions/_shared/siat/xsd-embebidos.ts";

describe("XSD incluidos para Edge sin archivos estáticos", () => {
  it("conserva exactamente los tres archivos oficiales incluidos en el proyecto", () => {
    for (const [name, value] of Object.entries(XSD_SIAT)) {
      expect(value).toBe(readFileSync(new URL(`../../supabase/functions/_shared/siat/artifacts/SIAT_VIGENTE/${name}`, import.meta.url), "utf8"));
      expect(xsdSiat(name)).toBe(value);
    }
    expect(Object.keys(XSD_SIAT)).toHaveLength(3);
    expect(() => xsdSiat("otro.xsd")).toThrow("XSD SIAT no disponible");
  });
});

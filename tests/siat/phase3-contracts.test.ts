import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../supabase/migrations/20260917300000_siat_fase_3_contingencia.sql", import.meta.url), "utf8");
const ingest = readFileSync(new URL("../../supabase/functions/siat-local-ingest/index.ts", import.meta.url), "utf8");
const engine = readFileSync(new URL("../../supabase/functions/_shared/siat/engine.ts", import.meta.url), "utf8");

describe("contratos de contingencia real", () => {
  it("versiona reglas oficiales y no habilita producción", () => {
    for (const rule of ["MAX_FACTURAS_PAQUETE_CONTINGENCIA", "PLAZO_REGISTRO_EVENTO_HORAS", "PLAZO_MANUAL_CAFC_HORAS", "MAX_EXTENSION_CUFD_CONTINGENCIA_HORAS", "FALLOS_ANTES_DE_OFFLINE"]) expect(migration).toContain(rule);
    expect(ingest).toContain("config.data.ambiente !== \"PRUEBAS\"");
  });
  it("protege ingest con HMAC, nonce y ventana temporal", () => {
    expect(ingest).toContain("SIAT_AGENT_SHARED_SECRET"); expect(ingest).toContain("siat_agent_nonces"); expect(ingest).toContain("300_000");
    expect(migration).toContain("PRIMARY KEY (agente_id, nonce)");
  });
  it("importa venta e inventario una sola vez", () => {
    expect(migration).toContain("siat_importaciones_offline"); expect(migration).toContain("idempotency_key text NOT NULL UNIQUE");
    expect(migration).toContain("app.siat_offline_import"); expect(migration).toMatch(/SELECT factura_id INTO v_existente[\s\S]+RETURN v_existente/);
  });
  it("agrupa paquetes homogéneos con máximo 500", () => {
    expect(migration).toMatch(/v_count NOT BETWEEN 1 AND 500/);
    for (const field of ["documento_sector", "sucursal_id", "punto_venta_id", "cufd_id", "modalidad", "cafc_id"]) expect(migration).toContain(field);
    expect(engine).toContain("slice(index, index + 500)"); expect(engine).toContain("createTar");
  });
  it("no confunde recepción con validación", () => {
    expect(engine).toContain("codigoEstado === 901"); expect(engine).toContain("codigoEstado !== 904"); expect(engine).toContain("codigoEstado === 908");
    expect(engine).toContain("VALIDAR_PAQUETE");
  });
  it("separa CAFC y evita reutilizar el número", () => {
    expect(migration).toContain("siat_cafc_usos"); expect(migration).toContain("UNIQUE (rango_cafc_id, numero)");
    expect(migration).toContain("evidencia_original_storage_path");
  });
  it("restringe RPC críticas a service_role y habilita RLS", () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.siat_importar_factura_offline[\s\S]+GRANT EXECUTE ON FUNCTION public\.siat_importar_factura_offline[\s\S]+service_role/);
    for (const table of ["siat_agentes_locales", "siat_agent_nonces", "siat_importaciones_offline", "siat_cafc_usos", "siat_evidencias_readiness"]) expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
  });
});

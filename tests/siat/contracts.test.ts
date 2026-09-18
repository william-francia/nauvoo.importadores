import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../supabase/migrations/20260917200000_siat_fase_2_motor_online.sql", import.meta.url), "utf8");
const baseMigration = readFileSync(new URL("../../supabase/migrations/20260916203000_siat_fase_1_base.sql", import.meta.url), "utf8");

describe("contratos transaccionales y de seguridad SIAT", () => {
  it("reserva numeración concurrente con clave única y actualización atómica", () => {
    expect(baseMigration).toContain("UNIQUE NULLS NOT DISTINCT");
    expect(migration).toMatch(/siat_reservar_numero[\s\S]+UPDATE public\.siat_secuencias[\s\S]+RETURNING siguiente_numero - 1/);
  });
  it("evita doble worker y conserva idempotencia", () => {
    expect(migration).toContain("FOR UPDATE SKIP LOCKED");
    expect(migration).toContain("idempotency_key");
    expect(migration).toContain("ON CONFLICT");
  });
  it("crea factura y outbox dentro de la confirmación de venta", () => {
    expect(migration).toContain("trg_siat_venta_confirmada_outbox");
    expect(migration).toMatch(/INSERT INTO public\.facturas_siat[\s\S]+INSERT INTO public\.siat_outbox/);
  });
  it("mantiene almacenamiento privado y RPC sensibles solo para service_role", () => {
    expect(migration).toMatch(/'siat-documentos', 'siat-documentos', false/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.siat_reclamar_outbox/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.siat_reclamar_outbox[\s\S]+service_role/);
  });
  it("bloquea emisión sin homologación y conserva la operación de inventario", () => {
    expect(migration).toMatch(/siat_producto_homologaciones[\s\S]+estado = 'HOMOLOGADO'/);
    expect(migration).not.toMatch(/CREATE TRIGGER[^;]+productos[^;]+homolog/i);
  });
  it("actualiza catálogos de forma atómica y conserva el histórico CUIS/CUFD", () => {
    expect(migration).toContain("siat_aplicar_catalogo");
    expect(migration).toContain("siat_aplicar_sincronizacion_completa");
    expect(migration).toContain("CREATE TEMP TABLE siat_items_nuevos ON COMMIT DROP");
    expect(baseMigration).toContain("CREATE TABLE public.siat_cuis");
    expect(baseMigration).toContain("CREATE TABLE public.siat_cufd");
    expect(migration).not.toMatch(/DELETE FROM public\.siat_cui[sd]/);
  });
  it("modela timeout, conciliación, anulación y reversión sin eliminar facturas", () => {
    for (const state of ["SIN_RESPUESTA", "CONCILIANDO", "ANULACION_PENDIENTE", "ANULADA", "REVERSION_PENDIENTE", "REVERTIDA"]) expect(baseMigration).toContain(state);
    expect(migration).toContain("siat_solicitar_operacion_factura");
    expect(migration).not.toMatch(/DELETE FROM public\.facturas_siat/);
  });
  it("conserva RLS y auditoría", () => {
    expect(baseMigration).toContain("ALTER TABLE public.siat_outbox ENABLE ROW LEVEL SECURITY");
    expect(baseMigration).toContain("CREATE TABLE public.siat_auditoria");
    expect(migration).toContain("INSERT INTO public.siat_auditoria");
    expect(migration).toContain("DROP POLICY IF EXISTS acceso_total_autenticados ON public.facturas_siat");
    expect(migration).toContain("siat_metodo_pago_mapeos");
    expect(migration).toContain("tarjeta_ofuscada");
  });
});

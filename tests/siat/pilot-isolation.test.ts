import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { SiatEngine } from "../../supabase/functions/_shared/siat/engine.ts";
import { SiatRepository } from "../../supabase/functions/_shared/siat/repository.ts";
import type { SiatAdapter } from "../../supabase/functions/_shared/siat/types.ts";

const migration = readFileSync(new URL("../../supabase/migrations/20261023010000_siat_piloto_aislado.sql", import.meta.url), "utf8");
const defaultFix = readFileSync(new URL("../../supabase/migrations/20261023013000_siat_estado_sincronizacion_online.sql", import.meta.url), "utf8");
const descriptionGuard = readFileSync(new URL("../../supabase/migrations/20261023014000_siat_piloto_descripcion_snapshot.sql", import.meta.url), "utf8");
const gateway = readFileSync(new URL("../../supabase/functions/siat-gateway/index.ts", import.meta.url), "utf8");

describe("emisión piloto aislada", () => {
  it("mantiene la FK comercial y exige un origen piloto explícito sin venta", () => {
    expect(migration).toContain("ALTER COLUMN venta_id DROP NOT NULL");
    expect(migration).toContain("origen_fiscal = 'VENTA' AND venta_id IS NOT NULL");
    expect(migration).toContain("origen_fiscal = 'PILOTO' AND venta_id IS NULL");
    expect(migration).toContain("AND ambiente = 'PRUEBAS' AND modalidad = 'ELECTRONICA'");
    expect(migration).not.toMatch(/DROP CONSTRAINT.*venta_id/i);
    expect(migration).not.toMatch(/INSERT INTO public\.(ventas|movimientos_inventario|stock_por_almacen)/i);
    expect(defaultFix).toContain("SET DEFAULT 'SINCRONIZADA'");
    expect(descriptionGuard).toContain("producto_descripcion_snapshot text NOT NULL");
    expect(descriptionGuard).toContain("v_nombre_actual IS DISTINCT FROM v_descripcion");
  });

  it("exige aprobación cerrada por defecto, service_role y una factura por autorización", () => {
    expect(migration).toContain("emision_habilitada boolean NOT NULL DEFAULT false");
    expect(migration).toContain("eku_fiscal_aprobado boolean NOT NULL DEFAULT false");
    expect(migration).toContain("nit_cliente_verificado boolean NOT NULL DEFAULT false");
    expect(migration).toContain("WHERE id = p_autorizacion_id FOR UPDATE");
    expect(migration).toContain("facturas_siat_piloto_autorizacion_unique");
    expect(migration).toContain("IF v_factura_id IS NOT NULL THEN RETURN v_factura_id");
    expect(migration).toContain("REVOKE ALL ON FUNCTION public.siat_crear_factura_piloto_outbox(uuid,uuid,text) FROM PUBLIC, anon, authenticated");
    expect(gateway).toContain('body.confirmacion !== "AUTORIZO EMITIR ESTA UNICA FACTURA EN SIAT PILOTO"');
  });

  it("no permite al worker saltarse el control piloto aunque SIAT normal esté deshabilitado", async () => {
    const repository = {
      invoice: vi.fn().mockResolvedValue({ estado_fiscal: "EN_COLA", origen_fiscal: "PILOTO", sucursal_id: "branch", cuis_id: "cuis", cufd_id: "cufd" }),
      configuration: vi.fn().mockResolvedValue({ ambiente: "PRUEBAS", siat_habilitado: false }),
      pilotEmissionAllowed: vi.fn().mockResolvedValue(false),
      branch: vi.fn(), cuis: vi.fn().mockResolvedValue({}), cufd: vi.fn().mockResolvedValue({}), updateInvoice: vi.fn(),
    } as unknown as SiatRepository;
    const adapter = { recepcionarFactura: vi.fn() } as unknown as SiatAdapter;
    const engine = new SiatEngine(repository, adapter, {}, async () => "");
    await expect(engine.emit({ id: "job", factura_id: "invoice" })).rejects.toThrow("PILOTO_EMISION_NO_AUTORIZADA");
    expect(repository.branch).not.toHaveBeenCalled();
    expect(adapter.recepcionarFactura).not.toHaveBeenCalled();
    vi.mocked(repository.pilotEmissionAllowed).mockResolvedValue(true);
    vi.mocked(repository.branch).mockRejectedValue(new Error("AFTER_PILOT_GATE"));
    await expect(engine.emit({ id: "job", factura_id: "invoice" })).rejects.toThrow("AFTER_PILOT_GATE");
  });

  it("verifica autorización, payload y control persistido antes de transmitir", async () => {
    const db = {
      from: vi.fn((table: string) => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: table === "siat_piloto_control"
          ? { emision_habilitada: true, autorizacion_habilitada_id: "auth-1", eku_fiscal_aprobado: true,
            eku_tipo_evidencia: "CONFIRMACION_VERBAL_REPORTADA_POR_USUARIO", eku_alcance: "PRUEBAS",
            eku_declaracion_at: new Date().toISOString(), eku_aprobado_por: "admin", nit_cliente_verificado: true,
            nit_cliente_id: "client-1", nit_cliente_documento: "9204357", nit_ambiente: "PRUEBAS",
            nit_codigo_respuesta: 986, nit_verificado_at: new Date().toISOString(),
            eku_cert_sha256: "a".repeat(64), eku_aprobado_at: new Date().toISOString() }
          : table === "clientes" ? { id: "client-1", codigo_cliente: "CLI-000006", nombre_razon_social: "William Benjamin Francia Poma", tipo_documento: "NIT", numero_documento: "9204357", complemento: null, activo: true }
          : { estado: "CONSUMIDA", cliente_id: "client-1" }, error: null }) }) }),
      })),
    };
    const repo = new SiatRepository(db as never);
    const invoice = { origen_fiscal: "PILOTO", ambiente: "PRUEBAS", venta_id: null, piloto_autorizacion_id: "auth-1", tipo_documento: "NIT", numero_documento: "9204357" };
    const job = { payload: { origenFiscal: "PILOTO", autorizacionId: "auth-1" } };
    expect(await repo.pilotEmissionAllowed(invoice, job, "a".repeat(64))).toBe(true);
    expect(await repo.pilotEmissionAllowed({ ...invoice, piloto_autorizacion_id: "other" }, { payload: { origenFiscal: "PILOTO", autorizacionId: "other" } }, "a".repeat(64))).toBe(false);
    expect(await repo.pilotEmissionAllowed(invoice, job, "b".repeat(64))).toBe(false);
    expect(await repo.pilotEmissionAllowed(invoice, { payload: { origenFiscal: "PILOTO", autorizacionId: "other" } }, "a".repeat(64))).toBe(false);
    expect(await repo.pilotEmissionAllowed({ ...invoice, venta_id: "commercial-sale" }, job, "a".repeat(64))).toBe(false);
  });
});

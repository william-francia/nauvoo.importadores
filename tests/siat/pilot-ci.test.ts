import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { pilotIdentityAllowed } from "../../supabase/functions/_shared/siat/pilot-approval.ts";
import { buildPilotPreview, type PilotPreviewInput } from "../../supabase/functions/_shared/siat/pilot-preview.ts";

const client = { id: "client", codigo_cliente: "CLI-000006", nombre_razon_social: "William Benjamin Francia Poma", tipo_documento: "CI", numero_documento: "9204357", complemento: null, activo: true };
const verifiedNit = { nit_cliente_verificado: true, nit_cliente_id: "client", nit_cliente_documento: "9204357", nit_ambiente: "PRUEBAS", nit_codigo_respuesta: 986, nit_verificado_at: new Date().toISOString() };
const catalogs: PilotPreviewInput["catalogs"] = [
  { catalog: "ACTIVIDADES", state: "VIGENTE", code: "4752100", description: "Actividad", active: true },
  { catalog: "PRODUCTOS_SERVICIOS", state: "VIGENTE", code: "1003451", description: "Producto", active: true, activity: "4752100" },
  { catalog: "UNIDADES_MEDIDA", state: "VIGENTE", code: "47", description: "Unidad", active: true },
  { catalog: "METODOS_PAGO", state: "VIGENTE", code: "1", description: "Efectivo", active: true },
  { catalog: "TIPOS_DOCUMENTO", state: "VIGENTE", code: "1", description: "CI", active: true },
  { catalog: "TIPOS_DOCUMENTO", state: "VIGENTE", code: "5", description: "NIT", active: true },
];

describe("identidad fiscal CI/NIT", () => {
  it("CI valido no consulta ni requiere verificarNit", () => {
    expect(pilotIdentityAllowed({ nit_cliente_verificado: false }, client, "PRUEBAS")).toBe(true);
    expect(pilotIdentityAllowed({}, { ...client, complemento: "inventado" }, "PRUEBAS")).toBe(false);
    expect(pilotIdentityAllowed({}, { ...client, numero_documento: "abc" }, "PRUEBAS")).toBe(false);
  });

  it("NIT requiere evidencia 986; el inexistente 994 sigue bloqueado", () => {
    const nit = { ...client, tipo_documento: "NIT" };
    expect(pilotIdentityAllowed(verifiedNit, nit, "PRUEBAS")).toBe(true);
    expect(pilotIdentityAllowed({ ...verifiedNit, nit_codigo_respuesta: 994 }, nit, "PRUEBAS")).toBe(false);
    expect(pilotIdentityAllowed({ nit_cliente_verificado: false }, nit, "PRUEBAS")).toBe(false);
  });

  it("preview CI usa codigo 1 y no bloquea por NIT", () => {
    const input: PilotPreviewInput = {
      config: { ambiente: "PRUEBAS", modalidad: "ELECTRONICA", version_normativa: "SIAT_VIGENTE", nit: "72229012", actividad_economica: "4752100", siat_habilitado: false },
      client, product: { codigo_interno: "ph1234", nombre: "Perno cabeza hexagonal", precio_pieza: 5, activo: true },
      catalogs, paymentCode: 1, cuis: { id: "cuis", ambiente: "PRUEBAS", estado: "VIGENTE" },
      cufd: { cuis_id: "cuis", ambiente: "PRUEBAS", estado: "VIGENTE", fecha_expiracion: "2027-01-01T00:00:00Z" },
      pendingJobs: 0, now: new Date("2026-10-23T00:00:00Z"), proposedPrice: 5, proposedDiscount: 0,
    };
    const result = buildPilotPreview(input);
    expect(result.cliente).toMatchObject({ nombre: "William Benjamin Francia Poma", tipoDocumento: "CI", codigoTipoDocumento: 1, documento: "9204357" });
    expect(result).toMatchObject({ codigoAmbiente: 2, emisor: { nit: "72229012", actividad: "4752100" }, producto: { codigo: "ph1234", codigoSin: "1003451", unidadSin: "47", cantidad: 1 }, pago: { codigoSin: 1 } });
    expect(result.montos.total).toBe(5);
    expect(result.blockers).not.toContain("NIT_CLIENTE_SIN_VERIFICAR");
    expect(result.blockers).toContain("CERTIFICADO_EKU_FISCAL_PENDIENTE");
    expect(buildPilotPreview({ ...input, client: { ...client, tipo_documento: "NIT" } }).blockers).toContain("NIT_CLIENTE_SIN_VERIFICAR");
  });

  it("RPC/XML conservan CI=1 y ventas normales tambien mapean CI=1/NIT=5", () => {
    const pilotSql = readFileSync(new URL("../../supabase/migrations/20261023023000_siat_piloto_ci_cliente.sql", import.meta.url), "utf8");
    const normalSql = readFileSync(new URL("../../supabase/migrations/20260917200000_siat_fase_2_motor_online.sql", import.meta.url), "utf8");
    expect(pilotSql).toContain("'codigoTipoDocumentoIdentidad',CASE WHEN v_cliente.tipo_documento = 'CI' THEN 1 ELSE 5 END");
    expect(pilotSql).toContain("v_cliente.nombre_razon_social, v_cliente.tipo_documento, v_cliente.numero_documento, v_cliente.complemento");
    expect(pilotSql).toContain("v_cliente.tipo_documento = 'CI' THEN '1' ELSE '5' END");
    expect(normalSql).toContain("WHEN 'CI' THEN 1");
    expect(normalSql).toContain("WHEN 'NIT' THEN 5");
  });

  it("la declaracion verbal no simula evidencia escrita y la habilitacion es por autorizacion", () => {
    const sql = readFileSync(new URL("../../supabase/migrations/20261023030000_siat_piloto_declaracion_verbal.sql", import.meta.url), "utf8");
    const gateway = readFileSync(new URL("../../supabase/functions/siat-gateway/index.ts", import.meta.url), "utf8");
    expect(sql).toContain("CONFIRMACION_VERBAL_REPORTADA_POR_USUARIO");
    expect(sql).toContain("eku_fecha_confirmacion IS NULL AND eku_referencia_documental IS NULL");
    expect(sql).toContain("eku_alcance = 'PRUEBAS'");
    expect(sql).toContain("autorizacion_habilitada_id = p_autorizacion_id");
    expect(sql).toContain("PILOTO_UNICA_FACTURA_YA_CREADA");
    expect(gateway).toContain('action === "pilot-enable-authorization"');
    expect(gateway).toContain('action === "pilot-issue"');
  });

  it("el panel conecta seleccion verbal, precio confirmado, autorizacion y consulta fiscal", () => {
    const ui = readFileSync(new URL("../../src/features/facturas/components/PilotPreviewSiat.tsx", import.meta.url), "utf8");
    const modal = readFileSync(new URL("../../src/features/facturas/components/ConfiguracionSiatModal.tsx", import.meta.url), "utf8");
    expect(modal).toContain("<PilotPreviewSiat />");
    expect(ui).toContain("Confirmación verbal reportada por el usuario");
    expect(ui).toContain("setPreviewConfirmado(event.target.checked ? data.previewHash : null)");
    expect(ui).toContain("Confirmar precio y preparar autorización individual (no emite)");
    expect(ui).toContain("Habilitar esta autorización (no emite)");
    expect(ui).toContain("Consultar resultado fiscal");
  });
});

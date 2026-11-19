import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertPilotPreviewAdmin, buildPilotPreview, pilotAuthorizationEnabled, pilotPreviewHash, type PilotPreviewInput } from "../../supabase/functions/_shared/siat/pilot-preview.ts";

const fixture = (): PilotPreviewInput => ({
  config: { ambiente: "PRUEBAS", modalidad: "ELECTRONICA", version_normativa: "SIAT_VIGENTE", nit: "72229012", actividad_economica: "4752100", siat_habilitado: false },
  client: { codigo_cliente: "CLI-000006", nombre_razon_social: "William Benjamin Francia Poma", tipo_documento: "NIT", numero_documento: "9204357", activo: true },
  product: { codigo_interno: "ph1234", nombre: "Perno cabeza hexagonal 1/4x2\"", precio_pieza: 5, activo: true },
  catalogs: [
    { catalog: "ACTIVIDADES", state: "VIGENTE", code: "4752100", description: "Ferretería", active: true },
    { catalog: "PRODUCTOS_SERVICIOS", state: "VIGENTE", code: "1003451", description: "Artículos para fijación", active: true, activity: "4752100" },
    { catalog: "UNIDADES_MEDIDA", state: "VIGENTE", code: "47", description: "PIEZAS", active: true },
    { catalog: "METODOS_PAGO", state: "VIGENTE", code: "1", description: "EFECTIVO", active: true },
    { catalog: "TIPOS_DOCUMENTO", state: "VIGENTE", code: "5", description: "NIT", active: true },
  ],
  paymentCode: 1,
  cuis: { id: "cuis-1", estado: "VIGENTE", ambiente: "PRUEBAS", fecha_expiracion: "2027-10-01T00:00:00Z" },
  cufd: { cuis_id: "cuis-1", estado: "VIGENTE", ambiente: "PRUEBAS", fecha_inicio: "2026-10-22T00:00:00Z", fecha_expiracion: "2026-10-24T00:00:00Z" },
  pendingJobs: 0,
  now: new Date("2026-10-23T00:00:00Z"),
});

describe("preview fiscal piloto aislado", () => {
  it("separa la autorización de anulación 9A de las dos facturas anteriores", async () => {
    const preview = buildPilotPreview(fixture());
    const first = await pilotPreviewHash(preview, false);
    const second = await pilotPreviewHash(preview, true);
    const third = await pilotPreviewHash(preview, false, true);
    expect(new Set([first, second, third]).size).toBe(3);
    expect(await pilotPreviewHash(preview, false, true)).toBe(third);
    expect(await pilotPreviewHash(buildPilotPreview({ ...fixture(), proposedPrice: 6 }), false, true)).not.toBe(third);
  });
  it("separa la autorización nueva del resumen consumido y conserva el hash entre consultas", async () => {
    const preview = buildPilotPreview(fixture());
    const first = await pilotPreviewHash(preview, false);
    const second = await pilotPreviewHash(preview, true);
    expect(second).not.toBe(first);
    expect(await pilotPreviewHash(preview, true)).toBe(second);
    expect(await pilotPreviewHash(buildPilotPreview({ ...fixture(), proposedPrice: 6 }), true)).not.toBe(second);
  });
  it("no muestra como habilitada una autorización consumida o vencida", () => {
    const control = { emision_habilitada: true, autorizacion_habilitada_id: "auth" };
    const now = new Date("2026-10-29T00:00:00Z");
    expect(pilotAuthorizationEnabled(control, { estado: "CONSUMIDA", expires_at: "2026-10-30T00:00:00Z" }, now)).toBe(false);
    expect(pilotAuthorizationEnabled(control, { estado: "PREPARADA", expires_at: "2026-10-28T00:00:00Z" }, now)).toBe(false);
    expect(pilotAuthorizationEnabled(control, { estado: "PREPARADA", expires_at: "2026-10-30T00:00:00Z" }, now)).toBe(true);
  });
  it("muestra el fixture, cálculos y bloqueos sin reservar número ni habilitar emisión", () => {
    const result = buildPilotPreview(fixture());
    expect(result).toMatchObject({ ambiente: "PRUEBAS", montos: { precio: 5, subtotal: 5, descuento: 0, total: 5, precioConfirmado: false }, codigos: { cuisVigente: true, cufdVigente: true }, puedeEmitir: false, numeroReservado: false });
    expect(result.producto).toMatchObject({ codigoSin: "1003451", actividad: "4752100", origen: "PENDIENTE", homologacionPersistida: false });
    expect(result.blockers).toContain("CERTIFICADO_EKU_FISCAL_PENDIENTE");
    expect(result.blockers).toContain("RUTA_EMISION_AISLADA_PENDIENTE");
  });
  it("aunque se levanten los controles, el preview no autoriza por sí mismo", () => {
    const result = buildPilotPreview({ ...fixture(), ekuFiscalApproved: true, nitClientVerified: true, emissionEnabled: true, routeReady: true });
    expect(result.blockers).toEqual(["AUTORIZACION_EXPLICITA_PENDIENTE"]);
    expect(result.puedeEmitir).toBe(false);
    expect(result.numeroReservado).toBe(false);
  });
  it("permite cambiar solo el precio propuesto y recalcula el total sin mutar el producto", () => {
    const input = { ...fixture(), proposedPrice: 6.25, proposedDiscount: 0.5 };
    expect(buildPilotPreview(input).montos).toMatchObject({ precio: 6.25, subtotal: 6.25, descuento: 0.5, total: 5.75 });
    expect(input.product?.precio_pieza).toBe(5);
    expect(() => buildPilotPreview({ ...input, proposedDiscount: 7 })).toThrow("PILOTO_TOTALES_INVALIDOS");
  });
  it("conserva el precio editable de ventas y usa el precio confirmado en el XML", () => {
    const draft = readFileSync(new URL("../../src/features/ventas/hooks/useVentaDraft.ts", import.meta.url), "utf8");
    const migration = readFileSync(new URL("../../supabase/migrations/20260917200000_siat_fase_2_motor_online.sql", import.meta.url), "utf8");
    const xml = readFileSync(new URL("../../supabase/functions/_shared/siat/invoice-xml.ts", import.meta.url), "utf8");
    expect(draft).toContain("actualizarPrecio:");
    expect(migration).toContain("'precioUnitario', d.precio_unitario::text");
    expect(xml).toContain('element("precioUnitario", formatMoney(line.precioUnitario))');
  });
  it("exige administrador para el preview", () => {
    expect(() => assertPilotPreviewAdmin("vendedor")).toThrow("reservada");
    expect(() => assertPilotPreviewAdmin("administrador")).not.toThrow();
  });
  it("bloquea producción, emisión general, catálogos inválidos y CUFD vencido", () => {
    const input = fixture();
    input.config.ambiente = "PRODUCCION";
    expect(() => buildPilotPreview(input)).toThrow("PILOTO_SOLO_PRUEBAS");
    input.config.ambiente = "PRUEBAS";
    input.config.siat_habilitado = true;
    input.config.modalidad = "COMPUTARIZADA";
    input.catalogs[1]!.activity = "475200";
    input.cufd!.fecha_expiracion = "2026-10-22T00:00:00Z";
    const result = buildPilotPreview(input);
    expect(result.blockers).toEqual(expect.arrayContaining(["CONFIGURACION_PILOTO_INVALIDA", "EMISION_GENERAL_DEBE_ESTAR_DESHABILITADA", "CATALOGOS_O_PAGO_NO_VIGENTES", "CUFD_NO_VIGENTE"]));
  });
});

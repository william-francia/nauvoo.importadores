// Gateway real ejecutado en Node con dependencias simuladas y PostgreSQL sintético aislado.
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { transcribirCafc, type FormularioCafc } from "../../src/features/facturas/services/cafc-transcripcion";
import { LocalAgentApp } from "../../agent-local/src/app.ts";
import type { AgentConfig } from "../../agent-local/src/config.ts";
import type { AgentStore } from "../../agent-local/src/store.ts";
import { publicCertificateSha256 } from "../../supabase/functions/_shared/siat/pilot-approval.ts";

const state = vi.hoisted(() => ({ db: null as unknown, handler: null as unknown, certificate: "", event: {} as Record<string, unknown>, cufd: {} as Record<string, unknown> }));
vi.mock("../../supabase/functions/_shared/siat/cafc-link-control.ts", () => ({ CAFC_LINK_ENABLED: true }));
vi.mock("../../agent-local/src/contingency-safety.ts", async load => ({ ...(await load<typeof import("../../agent-local/src/contingency-safety.ts")>()), assertContingencyPilotReady: () => {}, assertCafcEnabled: () => {} }));
vi.mock("../../supabase/functions/_shared/siat/runtime.ts", () => ({
  serviceClient: () => state.db, authenticatedUser: async () => ({ authId: "11111111-1111-4111-8111-111111111111", profile: { rol: "administrador" } }),
  corsHeaders: () => ({}), json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  officialAdapter: () => { throw new Error("SIN BLOQUEADO EN PRUEBA"); }, secureEquals: () => false, siatCredentialStatus: () => ({}),
}));
vi.mock("../../supabase/functions/_shared/siat/repository.ts", () => ({ SiatRepository: class { event() { return state.event; } cufd() { return state.cufd; } } }));

const psql = "C:/Program Files/PostgreSQL/18/bin/psql.exe";
const database = process.env.NUVOO_CAFC_TEST_DB ?? "";
const port = process.env.NUVOO_CAFC_TEST_PORT ?? "55449";
const args = ["-h", "127.0.0.1", "-p", port, "-U", "postgres", "-d", database, "-v", "ON_ERROR_STOP=1", "-qAtc"];
const psqlEnv = { ...process.env, PGCLIENTENCODING: process.platform === "win32" ? "WIN1252" : "UTF8" };
const sql = (query: string) => execFileSync(psql, [...args, query], { encoding: "utf8", env: psqlEnv }).trim();
const sqlAsync = promisify(execFile);
const admin = "11111111-1111-4111-8111-111111111111", branch = "22222222-2222-4222-8222-222222222222", agent = "33333333-3333-4333-8333-333333333333";
const cuis = "44444444-4444-4444-8444-444444444444", cufd = "55555555-5555-4555-8555-555555555555", range = "66666666-6666-4666-8666-666666666666";
const event = "77777777-7777-4777-8777-777777777777", client = "88888888-8888-4888-8888-888888888888", sale = "99999999-9999-4999-8999-999999999999";
let directory = "";
let certificateHash = "";
const artifacts = new Map<string, Uint8Array>();
const agentSession = { id: "test", userId: admin, userName: "Admin test", role: "administrador", expiresAt: "2099-01-01T00:00:00Z" };
const file = new File(["%PDF-1.4\nsintetico"], "original.pdf", { type: "application/pdf" });
const date = (offset: number) => new Date(Date.now() + offset).toISOString();
const issued = new Date(Date.now() - 60 * 60_000 - 4 * 3_600_000).toISOString().slice(0, 16);
const localEvent = { id: event, cafcId: range, cufdId: cufd, tipoEventoCodigo: "5", fechaInicio: date(-2 * 3_600_000), fechaFin: date(-30 * 60_000) };
const cufdRow = { id: cufd, codigo: "CUFD-TEST", codigo_control: "ABCD", direccion: "Direccion test", ambiente: "PRUEBAS", sucursal_id: branch, punto_venta_id: null, fecha_inicio: date(-3 * 3_600_000), fecha_expiracion: date(20 * 3_600_000) };
const bundle = { agentId: agent, config: { nit: "123456789", razon_social: "Emisor prueba", municipio: "La Paz", modalidad: "ELECTRONICA", documento_sector: 1, tipo_factura: 1 },
  branch: { id: branch, codigo: 0 }, point: null, clients: [{ id: client, nombre_razon_social: "Cliente test", tipo_documento: "CI", numero_documento: "12345", codigo_cliente: "CLI-TEST" }],
  products: [{ id: "producto", nombre: "Perno", codigo_interno: "P1" }], homologations: [{ producto_id: "producto", estado: "HOMOLOGADO", actividad_economica: "4752100", codigo_producto_sin: "1003451", unidad_medida_sin: "47" }],
  payments: [{ metodo_interno: "EFECTIVO", codigo_metodo_pago: 1 }], cafc: [{ id: range, autorizacion: "CAFC-TEST", rango_desde: 50, rango_hasta: 60, estado: "VIGENTE", sucursal_id: branch, punto_venta_id: null, vigente_desde: date(-2 * 86_400_000), vigente_hasta: date(2 * 86_400_000) }] };
const form = (number: number, saleId = sale): FormularioCafc => ({ ventaId: saleId, eventoId: event, cafcId: range, numeroFactura: number, fechaEmision: issued, clienteId: client, metodoPago: "EFECTIVO", tarjetaOfuscada: null, descuentoAdicional: 0, totalOriginal: "5", totalSujetoIva: "5", leyenda: "Leyenda de prueba", originalRevisado: true, original: file, items: [{ productoId: "producto", codigoOriginal: "P1", descripcionOriginal: "Perno", subtotalOriginal: "5", cantidad: 1, precioUnitario: 5, descuento: 0 }] });

if (process.env.NUVOO_CAFC_LOCAL_TEST === "yes") {
beforeAll(async () => {
  if (process.env.NUVOO_CAFC_LOCAL_TEST !== "yes" || !/^nuvoo_cafc_integration_[a-f0-9]{32}$/.test(database)) throw new Error("Solo ejecutar explícitamente en PostgreSQL sintético local.");
  if (sql("SELECT current_database()") !== database) throw new Error("Base sintética incorrecta");
  const dataDir = sql("SHOW data_directory").replaceAll("\\", "/").toLowerCase();
  if (!(port === "55449" && dataDir.endsWith("/temp/nuvoo-cafc-pg-task")) && !(port === "55479" && /\/temp\/nuvoo-numero-prueba-[0-9a-f]{32}$/.test(dataDir))) throw new Error("Servidor no corresponde al clúster sintético autorizado.");
  vi.stubEnv("SIAT_CONTINGENCIA_PILOTO_HABILITADA", "true"); vi.stubEnv("SIAT_CONTINGENCIA_AMBIENTE", "PRUEBAS");
  vi.stubGlobal("fetch", () => { throw new Error("RED EXTERNA BLOQUEADA EN PRUEBA"); });
  directory = mkdtempSync(join(tmpdir(), "nuvoo-cafc-integration-"));
  const openssl = "C:/Program Files/Git/usr/bin/openssl.exe", key = join(directory, "key.pem"), cert = join(directory, "cert.pem");
  execFileSync(openssl, ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=CAFC Test", "-keyout", key, "-out", cert], { stdio: "ignore", env: { SystemRoot: process.env.SystemRoot ?? "C:/Windows", TEMP: tmpdir(), TMP: tmpdir(), MSYS2_ARG_CONV_EXCL: "*" } });
  process.env.SIAT_PRIVATE_KEY_PEM = readFileSync(key, "utf8"); state.certificate = readFileSync(cert, "utf8"); process.env.SIAT_CERTIFICATE_PEM = state.certificate;
  certificateHash = await publicCertificateSha256(state.certificate);
  state.event = { id: event, cufd_id: cufd }; state.cufd = cufdRow;
  sql(`INSERT INTO public.usuarios VALUES(gen_random_uuid(),'${admin}',true,'administrador'); INSERT INTO public.clientes VALUES('${client}','Cliente test','CI','12345',NULL); INSERT INTO public.siat_configuracion VALUES(true,'PRUEBAS','ELECTRONICA',false,'123456789'); INSERT INTO public.siat_sucursales VALUES('${branch}',0); INSERT INTO public.siat_agentes_locales VALUES('${agent}','ACTIVO','${branch}',NULL,'TEST'); INSERT INTO public.siat_cuis VALUES('${cuis}','CUIS-TEST'); INSERT INTO public.siat_cufd VALUES('${cufd}','${cuis}','CUFD-TEST','PRUEBAS','${branch}',NULL,now()-interval '3 hours',now()+interval '20 hours'); INSERT INTO public.siat_rangos_cafc VALUES('${range}','${branch}',NULL,'VIGENTE',now()-interval '2 days',now()+interval '2 days',50,60,'CAFC-TEST'); INSERT INTO public.siat_eventos_significativos VALUES('${event}','${agent}','5',now()-interval '2 hours',now()-interval '30 minutes','${range}','${cufd}','${branch}',NULL,'Evento sintético','{}',NULL,'MANUAL_ADMINISTRATIVO'); INSERT INTO public.siat_metodo_pago_mapeos VALUES('EFECTIVO',1,'SIAT_VIGENTE'); INSERT INTO public.ventas VALUES('${sale}','${client}','confirmada',true,5,0,'EFECTIVO'); INSERT INTO public.detalle_ventas VALUES(gen_random_uuid(),'${sale}','P1','Perno',1,5,0,5); INSERT INTO public.movimientos_inventario VALUES(gen_random_uuid(),'${sale}',1);`);
  const bucket = { upload: async (path: string, bytes: Uint8Array) => { if (artifacts.has(path)) return { error: "exists" }; artifacts.set(path, bytes); sql(`INSERT INTO storage.objects VALUES('siat-documentos','${path}')`); return { error: null }; }, download: async (path: string) => ({ data: new Blob([new Uint8Array(artifacts.get(path) ?? [])]), error: artifacts.has(path) ? null : "missing" }) };
  state.db = { from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { eku_fiscal_aprobado: true, eku_cert_sha256: certificateHash, eku_alcance: "PRUEBAS", eku_tipo_evidencia: "ACEPTACION_SIAT_PILOTO", eku_aprobado_por: admin, eku_aprobado_at: "2026-01-01", eku_declaracion_at: "2026-01-01" }, error: null }) }) }) }), storage: { from: () => bucket },
    rpc: async (_name: string, data: { p: unknown; p_venta: string }) => { const encoded = Buffer.from(JSON.stringify(data.p)).toString("base64"); const query = `SELECT public.siat_9b_vincular_cafc(convert_from(decode('${encoded}','base64'),'UTF8')::jsonb,'${data.p_venta}'::uuid,'${admin}'::uuid,true)`; try { const result = await sqlAsync(psql, [...args, query], { env: psqlEnv }); return { data: JSON.parse(result.stdout.trim()), error: null }; } catch (error) { return { data: null, error }; } } };
  vi.stubGlobal("Deno", { env: { get: (name: string) => name === "SIAT_CERTIFICATE_PEM" ? state.certificate : "" }, serve: (handler: unknown) => { state.handler = handler; } });
  await import("../../supabase/functions/siat-gateway/index.ts");
}, 30_000);
afterAll(() => { delete process.env.SIAT_PRIVATE_KEY_PEM; delete process.env.SIAT_CERTIFICATE_PEM; vi.unstubAllGlobals(); if (directory.includes("nuvoo-cafc-integration-")) rmSync(directory, { recursive: true, force: true }); });
}

(process.env.NUVOO_CAFC_LOCAL_TEST === "yes" ? describe : describe.skip)("CAFC integrado con gateway simulado y PostgreSQL local", () => {
  it("rechaza la factura piloto 3 antes de almacenar adjuntos", async () => {
    const handler = state.handler as (request: Request) => Promise<Response>; const before = artifacts.size;
    const response = await handler(new Request("http://test.local", { method: "POST", body: JSON.stringify({ action: "9b-link-manual-cafc", confirmacion: true, originalRevisado: true, facturaId: "8c5c0f1d-efd5-492f-ad26-3013f33cc3fe", eventoId: event, cafcId: range, agenteId: agent, correlationId: admin, ventaId: sale, idempotencyKey: "cafc-prueba-protegida-0001" }) }));
    expect(response.ok).toBe(false); expect(await response.json()).toMatchObject({ error: "CAFC_IDENTIFICADORES_INVALIDOS" }); expect(artifacts.size).toBe(before);
  });
  it("simula la comprobación automática del agente sin abrir conexiones", async () => {
    const store = { getState: () => ({ state: "ONLINE", evidence: {} }), retirement: () => null, setState: vi.fn(async () => {}) };
    const app = new LocalAgentApp({} as AgentConfig, store as unknown as AgentStore);
    const localFetch = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", localFetch);
    const probe = vi.spyOn(app.remote, "action").mockResolvedValue({ siatOnline: true, detail: "simulado" });
    try { await app.checkConnectivity(); expect(localFetch).toHaveBeenCalledOnce(); expect(probe).toHaveBeenCalledOnce(); }
    finally { vi.stubGlobal("fetch", () => { throw new Error("RED EXTERNA BLOQUEADA EN PRUEBA"); }); }
  });
  it("vincula, rechaza venta ausente y evita duplicados concurrentes", async () => {
    const store = { getState: () => ({ state: "REGISTRANDO_EVENTO" }), getBootstrap: () => bundle, closedEvent: () => ({ ...localEvent, cufd: cufdRow }) };
    const app = new LocalAgentApp({} as AgentConfig, store as unknown as AgentStore);
    const preparar = (input: Parameters<typeof app.prepareManualCafc>[1]) => app.prepareManualCafc(agentSession, input);
    const invoke = async (input: Record<string, unknown>) => { const handler = state.handler as (request: Request) => Promise<Response>; const response = await handler(new Request("http://test.local", { method: "POST", body: JSON.stringify({ action: "9b-link-manual-cafc", ...input }) })); const body = await response.json(); if (!response.ok) throw new Error(JSON.stringify(body)); return body; };
    const vincular = (input: Record<string, unknown>) => invoke(input);
    const ok = await transcribirCafc(form(54), { preparar, vincular }); expect(ok.estado).toBe("VINCULADA");
    const missing = await transcribirCafc(form(55, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"), { preparar, vincular }); expect(missing.estado).toBe("PENDIENTE_CONCILIACION");
    // Un reintento simultáneo utiliza exactamente los mismos adjuntos preparados.
    const original = vi.fn(preparar); const captured = await transcribirCafc(form(54), { preparar: original, vincular }); expect(captured.estado).toBe("VINCULADA");
    const prepared = await original.mock.results[0].value; const concurrent = await Promise.all([invoke({ ...prepared, confirmacion: true }), invoke({ ...prepared, confirmacion: true })]);
    expect(concurrent.every(item => item.estado === "VINCULADA")).toBe(true);
    expect(sql(`SELECT (SELECT count(*) FROM public.ventas WHERE id='${sale}'),(SELECT count(*) FROM public.movimientos_inventario WHERE venta_id='${sale}'),(SELECT count(*) FROM public.facturas_siat WHERE venta_id='${sale}')`)).toBe("1|1|1");
  }, 60_000);
});

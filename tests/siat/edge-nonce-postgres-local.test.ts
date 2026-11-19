// Solo para el clúster PostgreSQL sintético indicado; nunca contacta Supabase ni SIN.
import { createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ handler: null as unknown, db: null as unknown }));
vi.mock("../../supabase/functions/_shared/siat/runtime.ts", () => ({
  json: (body: unknown, status = 200) => new Response(JSON.stringify(body), { status }),
  officialAdapter: () => { throw Error("SIN deshabilitado"); }, secureEquals: async (a: string, b: string) => a === b,
  serviceClient: () => state.db,
}));
const dbName = "nuvoo_numeracion_v11_test", agentId = "00000000-0000-4000-8000-000000000092";
const psql = "C:/Program Files/PostgreSQL/18/bin/psql.exe";
const args = ["-h", "127.0.0.1", "-p", "55479", "-U", "postgres", "-d", dbName, "-v", "ON_ERROR_STOP=1", "-qAtc"];
const sql = (query: string) => execFileSync(psql, [...args, query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const secret = "synthetic-agent-secret-0000000000000";
const nonce = `9bprobe_${randomBytes(16).toString("hex")}`;

if (process.env.NUVOO_NONCE_LOCAL_TEST === "yes") {
  beforeAll(async () => {
    if (!/\/nuvoo-numero-prueba-[a-f0-9]{32}$/i.test(sql("SHOW data_directory").replaceAll("\\", "/"))) throw Error("Clúster no sintético");
    state.db = {
      from: (table: string) => {
        if (table === "siat_agentes_locales") return { select: () => ({ eq: () => ({ neq: () => ({ single: async () => ({ data: { id: agentId }, error: null }) }) }) }) };
        if (table === "siat_configuracion") return { select: () => ({ eq: () => ({ single: async () => ({ data: { ambiente: "PRUEBAS", siat_habilitado: false }, error: null }) }) }) };
        if (table === "siat_agent_nonces") return { insert: async (row: { agente_id: string; nonce: string; fecha_solicitud: string; expira_at: string }) => {
          if (row.agente_id !== agentId || !/^9bprobe_[a-f0-9]{32}$/.test(row.nonce)) throw Error("Datos no sintéticos");
          try { sql(`INSERT INTO siat_agent_nonces VALUES ('${agentId}','${row.nonce}','${row.fecha_solicitud}','${row.expira_at}')`); return { error: null }; } catch { return { error: true }; }
        } };
        throw Error(`Tabla no permitida: ${table}`);
      },
      rpc: async (name: string, params: { p_agente: string; p_nonce: string }) => {
        if (name !== "siat_9b_verificar_nonce_prueba" || params.p_agente !== agentId || !/^9bprobe_[a-f0-9]{32}$/.test(params.p_nonce)) throw Error("RPC no permitida");
        return { data: JSON.parse(sql(`SELECT siat_9b_verificar_nonce_prueba('${agentId}','${params.p_nonce}')`)), error: null };
      },
    };
    vi.stubGlobal("Deno", { env: { get: (key: string) => key === "SIAT_AGENT_SHARED_SECRET" ? secret : "false" }, serve: (handler: unknown) => { state.handler = handler; } });
    vi.stubGlobal("fetch", () => { throw Error("Red externa deshabilitada"); });
    await import("../../supabase/functions/siat-local-ingest/index.ts");
  });
  afterAll(() => { vi.unstubAllGlobals(); });
}
(process.env.NUVOO_NONCE_LOCAL_TEST === "yes" ? describe : describe.skip)("Edge simulado con RPC y PostgreSQL sintético reales", () => {
  it("persiste, verifica, rechaza repetición y limpia solo el nonce vencido", async () => {
    const timestamp = String(Date.now()), body = JSON.stringify({ action: "probe-9b-persistencia", contrato: 2 });
    const signature = createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("hex");
    const request = () => new Request("http://local.invalid", { method: "POST", body, headers: { "x-siat-agent": "TEST-CAFC-HISTORICO", "x-siat-timestamp": timestamp, "x-siat-nonce": nonce, "x-siat-signature": signature } });
    const handler = state.handler as (request: Request) => Promise<Response>;
    const response = await handler(request()); expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ persistido: true, fiscal: false });
    expect(sql(`SELECT count(*) FROM siat_agent_nonces WHERE agente_id='${agentId}' AND nonce='${nonce}'`)).toBe("1");
    expect((await handler(request())).status).toBe(401);
    sql(`UPDATE siat_agent_nonces SET expira_at=now()-interval '1 second' WHERE agente_id='${agentId}' AND nonce='${nonce}'`);
    sql(`DELETE FROM siat_agent_nonces WHERE agente_id='${agentId}' AND nonce='${nonce}' AND expira_at<now()`);
    expect(sql(`SELECT count(*) FROM siat_agent_nonces WHERE agente_id='${agentId}' AND nonce='${nonce}'`)).toBe("0");
  });
});

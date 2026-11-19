import { createClient } from "npm:@supabase/supabase-js@2";
import { OFFICIAL_TEST_ENDPOINTS, OfficialVigenteAdapter } from "./official-vigente.adapter.ts";

export const corsHeaders = (origin: string | null) => {
  const allowed = (Deno.env.get("SIAT_ALLOWED_ORIGINS") ?? "http://localhost:5173").split(",").map((item) => item.trim());
  const selected = origin && allowed.includes(origin) ? origin : allowed[0];
  return { "access-control-allow-origin": selected, "access-control-allow-headers": "authorization, x-client-info, apikey, content-type, x-worker-secret", "access-control-allow-methods": "POST, OPTIONS", vary: "Origin" };
};

export const json = (body: unknown, status = 200, origin: string | null = null) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL"); const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY no configurados.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type SiatEndpoints = Partial<Record<keyof typeof OFFICIAL_TEST_ENDPOINTS, string>>;

interface SiatRuntimeConfiguration {
  tokenDelegado: string;
  privateKeyPem: string;
  certificatePem: string;
  workerSecret: string;
  schedulerSecret: string;
  agentSharedSecret: string;
  endpoints: SiatEndpoints;
  timeoutMs: number;
}

const configuredTimeout = () => {
  const value = Number(Deno.env.get("SIAT_TIMEOUT_MS") ?? "20000");
  return Number.isFinite(value) && value > 0 ? value : 20000;
};

export const siatRuntimeConfiguration = (): SiatRuntimeConfiguration => ({
  tokenDelegado: (Deno.env.get("SIAT_TOKEN_DELEGADO") ?? "").trim().replace(/^TokenApi\s+/i, ""),
  privateKeyPem: Deno.env.get("SIAT_PRIVATE_KEY_PEM") ?? "",
  certificatePem: Deno.env.get("SIAT_CERTIFICATE_PEM") ?? "",
  workerSecret: Deno.env.get("SIAT_WORKER_SECRET") ?? "",
  schedulerSecret: Deno.env.get("SIAT_SCHEDULER_SECRET") ?? "",
  agentSharedSecret: Deno.env.get("SIAT_AGENT_SHARED_SECRET") ?? "",
  endpoints: {
    codigos: Deno.env.get("SIAT_CODIGOS_URL") || undefined,
    sincronizacion: Deno.env.get("SIAT_SINCRONIZACION_URL") || undefined,
    operaciones: Deno.env.get("SIAT_OPERACIONES_URL") || undefined,
    compraVenta: Deno.env.get("SIAT_COMPRA_VENTA_URL") || undefined,
  },
  timeoutMs: configuredTimeout(),
});

export const siatCredentialStatus = () => {
  const configuration = siatRuntimeConfiguration();
  return {
    tokenConfigurado: Boolean(configuration.tokenDelegado),
    firmaConfigurada: Boolean(configuration.privateKeyPem && configuration.certificatePem),
  };
};

export function officialAdapter() {
  const configuration = siatRuntimeConfiguration();
  return new OfficialVigenteAdapter(configuration.tokenDelegado, configuration.endpoints, configuration.timeoutMs);
}

export async function authenticatedUser(request: Request, client = serviceClient()) {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) throw new Error("Sesión requerida.");
  const { data, error } = await client.auth.getUser(authorization.slice(7));
  if (error || !data.user) throw new Error("Sesión inválida.");
  const { data: profile, error: profileError } = await client.from("usuarios").select("id,rol,activo").eq("auth_user_id", data.user.id).eq("activo", true).single();
  if (profileError || !profile) throw new Error("Usuario no autorizado.");
  return { authId: data.user.id, profile };
}

export async function secureEquals(left: string, right: string) {
  const [a, b] = await Promise.all([crypto.subtle.digest("SHA-256", new TextEncoder().encode(left)), crypto.subtle.digest("SHA-256", new TextEncoder().encode(right))]);
  const aa = new Uint8Array(a); const bb = new Uint8Array(b); let difference = 0;
  for (let index = 0; index < aa.length; index += 1) difference |= aa[index] ^ bb[index];
  return difference === 0;
}

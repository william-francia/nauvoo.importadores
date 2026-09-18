import { resolve } from "node:path";

const required = (name: string, minimum = 1) => {
  const value = process.env[name]?.trim() ?? "";
  if (value.length < minimum) throw new Error(`${name} no está configurado de forma segura.`);
  return value;
};

export interface AgentConfig {
  port: number; host: string; dataDir: string; agentCode: string; sharedSecret: string;
  storageSecret: string; ingestUrl: string; supabaseUrl: string; supabaseAnonKey: string;
  allowedOrigins: Set<string>; sessionHours: number; version: string; defaultEventCode: string | null;
}

export function loadConfig(): AgentConfig {
  const port = Number(process.env.SIAT_AGENT_PORT ?? 4737);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("SIAT_AGENT_PORT inválido.");
  const supabaseUrl = required("SUPABASE_URL");
  return {
    port, host: process.env.SIAT_AGENT_HOST ?? "127.0.0.1",
    dataDir: resolve(process.env.SIAT_AGENT_DATA_DIR ?? ".siat-agent"),
    agentCode: required("SIAT_AGENT_CODE"), sharedSecret: required("SIAT_AGENT_SHARED_SECRET", 32),
    storageSecret: required("SIAT_AGENT_STORAGE_KEY", 32),
    ingestUrl: process.env.SIAT_AGENT_INGEST_URL ?? `${supabaseUrl}/functions/v1/siat-local-ingest`,
    supabaseUrl, supabaseAnonKey: required("SUPABASE_ANON_KEY"),
    allowedOrigins: new Set((process.env.SIAT_AGENT_ALLOWED_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173").split(",").map(value => value.trim()).filter(Boolean)),
    sessionHours: Number(process.env.SIAT_AGENT_SESSION_HOURS ?? 12), version: "1.0.0",
    defaultEventCode: process.env.SIAT_AGENT_DEFAULT_EVENT_CODE?.trim() || null,
  };
}

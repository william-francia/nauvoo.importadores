import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync } from "node:fs";
import { loadConfig } from "./config.ts";
import { LocalAgentApp } from "./app.ts";
import { AgentStore } from "./store.ts";
import type { LocalSession, OfflineSaleInput } from "./types.ts";

const config = loadConfig(); mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
const store = new AgentStore(config); await store.init(); const app = new LocalAgentApp(config, store); app.start();
const cookie = (request: IncomingMessage, name: string) => request.headers.cookie?.split(";").map(value => value.trim().split("=")).find(([key]) => key === name)?.[1] ?? null;
const json = (response: ServerResponse, status: number, body: unknown) => { response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); response.end(JSON.stringify(body)); };
const body = async (request: IncomingMessage) => { const chunks: Buffer[] = []; let size = 0; for await (const chunk of request) { size += chunk.length; if (size > 2_000_000) throw new Error("Solicitud demasiado grande."); chunks.push(chunk); } return JSON.parse(Buffer.concat(chunks).toString() || "{}") as Record<string, unknown>; };
const sessionOf = (request: IncomingMessage): LocalSession => { const raw = cookie(request, "siat_agent_session"); const session = raw && store.authenticate(raw); if (!session) throw new Error("SESIÓN_LOCAL_REQUERIDA"); return session; };

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (origin && config.allowedOrigins.has(origin)) { response.setHeader("access-control-allow-origin", origin); response.setHeader("access-control-allow-credentials", "true"); response.setHeader("vary", "Origin"); }
  response.setHeader("access-control-allow-headers", "content-type"); response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS"); response.setHeader("x-content-type-options", "nosniff"); response.setHeader("referrer-policy", "no-referrer");
  if (request.method === "OPTIONS") { response.writeHead(204); response.end(); return; }
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname === "/health" && request.method === "GET") return json(response, 200, { ok: true, version: config.version });
    if (url.pathname === "/v1/pair" && request.method === "POST") { const input = await body(request); const paired = await app.pair(String(input.accessToken ?? "")); response.setHeader("set-cookie", `siat_agent_session=${paired.id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${config.sessionHours * 3600}`); return json(response, 200, { user: paired.userName, role: paired.role, expiresAt: paired.expiresAt }); }
    const session = sessionOf(request);
    if (url.pathname === "/v1/status" && request.method === "GET") return json(response, 200, store.getState());
    if (url.pathname === "/v1/browser-heartbeat" && request.method === "POST") { const input = await body(request); await app.reportBrowser(Boolean(input.online)); return json(response, 200, { ok: true }); }
    if (url.pathname === "/v1/bootstrap" && request.method === "POST") return json(response, 200, await app.bootstrap(session));
    if (url.pathname === "/v1/products" && request.method === "GET") return json(response, 200, store.listProducts(url.searchParams.get("q") ?? ""));
    if (url.pathname === "/v1/clients" && request.method === "GET") return json(response, 200, store.listClients(url.searchParams.get("q") ?? ""));
    if (url.pathname === "/v1/cafc" && request.method === "GET") return json(response, 200, store.listCafc());
    if (url.pathname === "/v1/invoices" && request.method === "GET") return json(response, 200, store.listInvoices());
    if (url.pathname === "/v1/invoices" && request.method === "POST") return json(response, 201, await app.issuer.issue(await body(request) as unknown as OfflineSaleInput, session));
    if (url.pathname === "/v1/events/manual" && request.method === "POST") return json(response, 201, await app.manualEvent(session, await body(request)));
    if (url.pathname === "/v1/recover" && request.method === "POST") return json(response, 202, await app.recover({ manual: true, actor: session.userId }));
    const documentMatch = url.pathname.match(/^\/v1\/invoices\/([0-9a-f-]{36})\/(pdf|xml)$/i);
    if (documentMatch && request.method === "GET") { const type = documentMatch[2]?.toUpperCase() as "PDF" | "XML"; const bytes = app.document(String(documentMatch[1]), type); response.writeHead(200, { "content-type": type === "PDF" ? "application/pdf" : "application/xml", "content-disposition": `attachment; filename=factura-${documentMatch[1]}.${type.toLowerCase()}`, "cache-control": "no-store" }); response.end(bytes); return; }
    if (url.pathname === "/v1/backup" && request.method === "POST") { if (session.role.toLowerCase() !== "administrador") throw new Error("Operación reservada a administración."); const input = await body(request); return json(response, 200, { path: store.backup(String(input.destination ?? "")) }); }
    return json(response, 404, { error: "Ruta del agente no encontrada." });
  } catch (error) { const message = (error instanceof Error ? error.message : String(error)).replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 500); return json(response, message.includes("SESIÓN_LOCAL") ? 401 : 400, { error: message }); }
});
server.listen(config.port, config.host, () => process.stdout.write(`Agente SIAT local ${config.version} escuchando en http://${config.host}:${config.port}\n`));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { app.stop(); server.close(() => process.exit(0)); });

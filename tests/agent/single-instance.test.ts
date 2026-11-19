import { createHash } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

it("una segunda instancia no abre ni sobrescribe el almacenamiento del agente", async () => {
  const dir = mkdtempSync(join(tmpdir(), "nuvoo-agente-instancia-"));
  const port = await new Promise<number>((resolve, reject) => {
    const socket = createServer(); socket.on("error", reject);
    socket.listen(0, "127.0.0.1", () => { const address = socket.address(); if (!address || typeof address === "string") return reject(Error("Puerto no disponible")); socket.close(() => resolve(address.port)); });
  });
  const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEMP: tmpdir(), TMP: tmpdir(),
    SIAT_AGENT_DATA_DIR: dir, SIAT_AGENT_HOST: "127.0.0.1", SIAT_AGENT_PORT: String(port), SIAT_AGENT_CODE: "SYNTHETIC",
    SIAT_AGENT_SHARED_SECRET: "synthetic-shared-secret-not-real-000", SIAT_AGENT_STORAGE_KEY: "synthetic-storage-secret-not-real-00",
    SUPABASE_URL: "http://127.0.0.1:9", SUPABASE_ANON_KEY: "synthetic", SIAT_CONTINGENCIA_PILOTO_HABILITADA: "false" };
  const start = () => spawn(process.execPath, ["--import", "tsx", "agent-local/src/server.ts"], { cwd: process.cwd(), env, stdio: "ignore" });
  let first: ChildProcess | null = null, second: ChildProcess | null = null;
  try {
    first = start(); let available = false;
    for (let i = 0; i < 100 && !available; i++) { await new Promise(resolve => setTimeout(resolve, 100)); try { available = (await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) })).ok; } catch { /* aún iniciando */ } }
    expect(available).toBe(true);
    const path = join(dir, "agent.sqlite.enc"); const digest = () => createHash("sha256").update(readFileSync(path)).digest("hex");
    const before = digest(); second = start();
    const status = await Promise.race([new Promise<number | null>(resolve => second!.once("exit", resolve)), new Promise<never>((_, reject) => setTimeout(() => reject(Error("La segunda instancia no terminó")), 10000))]);
    expect(status).not.toBe(0); expect(digest()).toBe(before);
  } finally {
    if (second && second.exitCode === null) second.kill();
    if (first && first.exitCode === null) { const exited = new Promise(resolve => first!.once("exit", resolve)); first.kill(); await exited; }
    if (dir.startsWith(join(tmpdir(), "nuvoo-agente-instancia-"))) rmSync(dir, { recursive: true, force: true });
  }
}, 30000);

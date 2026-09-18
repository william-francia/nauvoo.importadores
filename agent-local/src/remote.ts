import { randomBytes } from "node:crypto";
import type { AgentConfig } from "./config.ts";
import { signAgentRequest } from "./security.ts";
import type { BootstrapBundle } from "./types.ts";

export class RemoteGateway {
  constructor(private readonly config: AgentConfig) {}
  async action<T>(payload: Record<string, unknown>, timeoutMs = 20_000): Promise<T> {
    const body = JSON.stringify(payload); const timestamp = String(Date.now());
    const nonce = randomBytes(18).toString("base64url");
    const response = await fetch(this.config.ingestUrl, {
      method: "POST", signal: AbortSignal.timeout(timeoutMs), body,
      headers: { "content-type": "application/json", "x-siat-agent": this.config.agentCode,
        "x-siat-timestamp": timestamp, "x-siat-nonce": nonce,
        "x-siat-signature": signAgentRequest(body, timestamp, nonce, this.config.sharedSecret) },
    });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(data.error ?? `Gateway local-ingest HTTP ${response.status}.`);
    return data as T;
  }
  bootstrap() { return this.action<BootstrapBundle>({ action: "bootstrap", reserveNumbers: true, versionAgente: this.config.version }, 40_000); }
}

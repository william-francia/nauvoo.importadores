import { randomBytes } from "node:crypto";
import type { AgentConfig } from "./config.ts";
import { signAgentRequest } from "./security.ts";
import type { BootstrapBundle } from "./types.ts";

export class RemoteGateway {
  constructor(private readonly config: AgentConfig) {}
  async action<T>(payload: Record<string, unknown>, timeoutMs = 20_000): Promise<T> {
    const body = JSON.stringify({ ...payload, contrato: 2 }); const timestamp = String(Date.now());
    const nonce = randomBytes(18).toString("base64url");
    const response = await fetch(this.config.ingestUrl, {
      method: "POST", signal: AbortSignal.timeout(timeoutMs), body,
      headers: { "content-type": "application/json", "x-siat-agent": this.config.agentCode,
        "x-siat-timestamp": timestamp, "x-siat-nonce": nonce,
        "x-siat-signature": signAgentRequest(body, timestamp, nonce, this.config.sharedSecret) },
    });
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) throw new Error(`Gateway local-ingest HTTP ${response.status}: ${data.error ?? "Solicitud rechazada"}`);
    return data as T;
  }
  bootstrap(reserveCount: number) {
    if (!Number.isSafeInteger(reserveCount) || reserveCount < 1 || reserveCount > 10000) throw new Error("CANTIDAD_RESERVA_OFFLINE_INVALIDA");
    return this.action<BootstrapBundle>({ action: "bootstrap", reserveNumbers: true, reserveCount, versionAgente: this.config.version }, 40_000);
  }
}

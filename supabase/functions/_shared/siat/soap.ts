import { XMLParser } from "fast-xml-parser";
import { AmbiguousSiatError } from "./types.ts";
import type { SiatMessage, SiatResponse } from "./types.ts";

const parser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
  processEntities: false,
  htmlEntities: false,
  allowBooleanAttributes: false,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

const escapeXml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&apos;");

const sensitiveKeys = /(token|apikey|cert|private|clave|archivo)/i;
export function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sensitiveKeys.test(key) ? "[REDACTED]" : sanitize(item)]));
  return typeof value === "string" && value.length > 1000 ? `${value.slice(0, 200)}…[TRUNCATED]` : value;
}

export function deepFind(value: unknown, target: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (key.toLowerCase() === target.toLowerCase()) return child;
    const nested = deepFind(child, target);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

const asBool = (value: unknown): boolean | null => value === true || String(value).toLowerCase() === "true" ? true : value === false || String(value).toLowerCase() === "false" ? false : null;
const asNumber = (value: unknown): number | null => value == null || value === "" || Number.isNaN(Number(value)) ? null : Number(value);
const asText = (value: unknown): string | null => value == null || value === "" ? null : String(value);

export function normalizeSiatResponse(raw: unknown): SiatResponse {
  const messagesRaw = deepFind(raw, "mensajesList") ?? deepFind(raw, "mensajes") ?? [];
  const values = Array.isArray(messagesRaw) ? messagesRaw : [messagesRaw];
  const mensajes: SiatMessage[] = values.filter(Boolean).map((item) => ({
    codigo: asNumber(deepFind(item, "codigo")) ?? undefined,
    descripcion: asText(deepFind(item, "descripcion")) ?? asText(item) ?? "Mensaje SIN sin descripción",
    numeroArchivo: asNumber(deepFind(item, "numeroArchivo")) ?? undefined,
    numeroDetalle: asNumber(deepFind(item, "numeroDetalle")) ?? undefined,
  }));
  return {
    transaccion: asBool(deepFind(raw, "transaccion")),
    codigoEstado: asNumber(deepFind(raw, "codigoEstado")),
    codigoDescripcion: asText(deepFind(raw, "codigoDescripcion")),
    codigoRecepcion: asText(deepFind(raw, "codigoRecepcion")),
    fechaRecepcion: asText(deepFind(raw, "fechaRecepcion")),
    mensajes,
    rawSanitizado: sanitize(raw) as Record<string, unknown>,
  };
}

export class SoapClient {
  constructor(private readonly endpoint: string, private readonly token: string, private readonly timeoutMs = 20_000) {
    if (!endpoint.startsWith("https://")) throw new Error("El endpoint SOAP debe utilizar HTTPS.");
  }

  async call(operation: string, requestName: string | null, fields: Record<string, unknown>, options: { ambiguousOnTimeout?: boolean; retries?: number } = {}): Promise<unknown> {
    const body = Object.entries(fields).filter(([, value]) => value !== undefined).map(([key, value]) => `<${key}>${escapeXml(value)}</${key}>`).join("");
    const requestBody = requestName ? `<Solicitud${requestName}>${body}</Solicitud${requestName}>` : body;
    const envelope = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:siat="https://siat.impuestos.gob.bo/"><soapenv:Header/><soapenv:Body><siat:${operation}>${requestBody}</siat:${operation}></soapenv:Body></soapenv:Envelope>`;
    const attempts = Math.max(1, Math.min(3, (options.retries ?? 0) + 1));
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(this.endpoint, {
          method: "POST", signal: controller.signal,
          headers: { "content-type": "text/xml; charset=utf-8", apikey: `TokenApi ${this.token}`, SOAPAction: "" },
          body: envelope,
        });
        const text = await response.text();
        if (!response.ok) throw new Error(`Servicio SIN respondió HTTP ${response.status}.`);
        const parsed = parser.parse(text);
        const fault = deepFind(parsed, "Fault");
        if (fault) throw new Error(`SOAP Fault: ${asText(deepFind(fault, "faultstring")) ?? "respuesta rechazada"}`);
        return parsed;
      } catch (error) {
        lastError = error;
        const timedOut = error instanceof DOMException && error.name === "AbortError";
        if (timedOut && options.ambiguousOnTimeout) throw new AmbiguousSiatError();
        if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** (attempt - 1)));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError instanceof Error ? lastError : new Error("No fue posible comunicarse con el SIN.");
  }
}

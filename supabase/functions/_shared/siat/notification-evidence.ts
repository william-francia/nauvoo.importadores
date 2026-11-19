import { sha256Hex } from "./encoding.ts";

export type NotificationChannel = "CORREO" | "WHATSAPP";
export function normalizeRecipient(channel: NotificationChannel, raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (channel === "CORREO") {
    const email = value.toLowerCase();
    if (email.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)) throw new Error("DESTINATARIO_CORREO_INVALIDO");
    return email;
  }
  const phone = value.replace(/[\s()-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("DESTINATARIO_WHATSAPP_REQUIERE_CODIGO_PAIS");
  return phone;
}

export function maskRecipient(value: string): string {
  if (value.includes("@")) { const [local, domain] = value.split("@"); return `${local.slice(0, 1)}***@***.${domain.split(".").pop()}`; }
  return `***${value.slice(-2)}`;
}

export async function evidenceDigest(raw: unknown): Promise<string> {
  const value = String(raw ?? "").trim();
  if (value.length < 12 || value.length > 1000) throw new Error("EVIDENCIA_REQUIERE_REFERENCIA_VERIFICABLE");
  return sha256Hex(new TextEncoder().encode(value));
}

export async function recipientHmac(secret: string, channel: NotificationChannel, recipient: string): Promise<string> {
  if (secret.length < 32) throw new Error("NOTIFICACION_CLAVE_PROTECCION_NO_CONFIGURADA");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${channel}:${recipient}`));
  return [...new Uint8Array(signed)].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
}

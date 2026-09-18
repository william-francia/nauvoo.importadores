import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const keyOf = (secret: string) => createHash("sha256").update(secret, "utf8").digest();

export function encryptBytes(data: Uint8Array, secret: string): Buffer {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", keyOf(secret), iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]); const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from("SIAT1"), iv, tag, encrypted]);
}

export function decryptBytes(data: Uint8Array, secret: string): Buffer {
  const input = Buffer.from(data);
  if (input.subarray(0, 5).toString() !== "SIAT1" || input.length < 33) throw new Error("Respaldo local inválido.");
  const decipher = createDecipheriv("aes-256-gcm", keyOf(secret), input.subarray(5, 17));
  decipher.setAuthTag(input.subarray(17, 33));
  return Buffer.concat([decipher.update(input.subarray(33)), decipher.final()]);
}

export const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex").toUpperCase();
export const sessionHash = (value: string, secret: string) => createHmac("sha256", secret).update(value).digest("hex");
export const signAgentRequest = (body: string, timestamp: string, nonce: string, secret: string) => createHmac("sha256", secret).update(`${timestamp}.${nonce}.${body}`).digest("hex");
export const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

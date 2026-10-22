import { createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";

export type SignatureCredentialStatus = { nit: "NIT_VERIFICACION_MANUAL"; nitCoincidenciaTextual: boolean; eku: "NO_DECLARADO" | "EKU_VERIFICACION_MANUAL" };

type Tlv = { tag: number; start: number; end: number };
function tlv(bytes: Uint8Array, offset: number): Tlv {
  if (offset + 2 > bytes.length) throw new Error("CERTIFICADO_PEM_INVALIDO");
  const tag = bytes[offset]!; let length = bytes[offset + 1]!; let start = offset + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (!count || count > 4 || start + count > bytes.length) throw new Error("CERTIFICADO_PEM_INVALIDO");
    length = 0;
    for (let index = 0; index < count; index++) length = length * 256 + bytes[start++]!;
  }
  if (start + length > bytes.length) throw new Error("CERTIFICADO_PEM_INVALIDO");
  return { tag, start, end: start + length };
}
function children(bytes: Uint8Array, node: Tlv): Tlv[] {
  const result: Tlv[] = [];
  for (let offset = node.start; offset < node.end;) { const child = tlv(bytes, offset); result.push(child); offset = child.end; }
  return result;
}
function oid(bytes: Uint8Array, node: Tlv): string {
  const values = bytes.subarray(node.start, node.end);
  if (node.tag !== 6 || !values.length) throw new Error("CERTIFICADO_PEM_INVALIDO");
  const result = [Math.floor(values[0]! / 40), values[0]! % 40]; let current = 0;
  for (const byte of values.subarray(1)) { current = current * 128 + (byte & 127); if (!(byte & 128)) { result.push(current); current = 0; } }
  return result.join(".");
}
function extensions(cert: X509Certificate): Map<string, Uint8Array> {
  const bytes = cert.raw; const root = tlv(bytes, 0); const tbs = children(bytes, root)[0];
  if (!tbs || root.tag !== 0x30 || tbs.tag !== 0x30) throw new Error("CERTIFICADO_PEM_INVALIDO");
  const context = children(bytes, tbs).find((item) => item.tag === 0xa3);
  const result = new Map<string, Uint8Array>();
  if (!context) return result;
  const list = children(bytes, context)[0];
  if (!list || list.tag !== 0x30) throw new Error("CERTIFICADO_PEM_INVALIDO");
  for (const item of children(bytes, list)) {
    const parts = children(bytes, item); const value = parts.at(-1);
    if (!parts[0] || !value || value.tag !== 4) throw new Error("CERTIFICADO_PEM_INVALIDO");
    result.set(oid(bytes, parts[0]), bytes.subarray(value.start, value.end));
  }
  return result;
}

export function validateSignatureCredentials(privateKeyPem?: string, certificatePem?: string, now = new Date()): SignatureCredentialStatus {
  if (!privateKeyPem?.trim() || !certificatePem?.trim()) throw new Error("FIRMA_DIGITAL_NO_CONFIGURADA");
  if (!/^-----BEGIN PRIVATE KEY-----\r?\n[\s\S]+\r?\n-----END PRIVATE KEY-----\s*$/.test(privateKeyPem) ||
      !/^-----BEGIN CERTIFICATE-----\r?\n[\s\S]+\r?\n-----END CERTIFICATE-----\s*$/.test(certificatePem)) throw new Error("FIRMA_PEM_INVALIDO");
  try {
    const key = createPrivateKey({ key: privateKeyPem, format: "pem" });
    const cert = new X509Certificate(certificatePem);
    if (key.asymmetricKeyType !== "rsa" || cert.publicKey.asymmetricKeyType !== "rsa") throw new Error("FIRMA_CLAVE_INCOMPATIBLE");
    const instant = now.getTime();
    if (!Number.isFinite(instant) || instant < Date.parse(cert.validFrom) || instant > Date.parse(cert.validTo)) throw new Error("FIRMA_CERTIFICADO_NO_VIGENTE");
    if (!createPublicKey(key).equals(cert.publicKey)) throw new Error("FIRMA_CLAVE_NO_CORRESPONDE");
    const values = extensions(cert);
    const usage = values.get("2.5.29.15");
    if (usage) {
      const bitString = tlv(usage, 0);
      if (bitString.tag !== 3 || bitString.start + 1 >= bitString.end || !(usage[bitString.start + 1]! & 0xc0)) throw new Error("FIRMA_USO_NO_PERMITIDO");
    }
    // Coincidencia textual no equivale a identidad tributaria certificada sin conocer el OID oficial.
    const text = [cert.subject, ...Array.from(values.values(), (value) => Buffer.from(value).toString("latin1"))].join(" ");
    const nitCoincidenciaTextual = /(?:^|\D)72229012(?:\D|$)/.test(text);
    return { nit: "NIT_VERIFICACION_MANUAL", nitCoincidenciaTextual, eku: values.has("2.5.29.37") ? "EKU_VERIFICACION_MANUAL" : "NO_DECLARADO" };
  } catch (error) {
    if (error instanceof Error && /^FIRMA_|^CERTIFICADO_/.test(error.message)) throw error;
    throw new Error("FIRMA_PEM_INVALIDO", { cause: error });
  }
}

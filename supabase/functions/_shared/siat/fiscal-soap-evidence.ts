import { fromBase64, sha256Hex, toBase64 } from "./encoding.ts";
import type { FiscalResponseCapture } from "./types.ts";

type Rpc = (name: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
const owned = (bytes: Uint8Array): ArrayBuffer => Uint8Array.from(bytes).buffer as ArrayBuffer;

// La clave nunca se envía a SQL. El contexto autenticado impide mover evidencia entre intentos.
export async function prepareFiscalSoapEvidence(keyBase64: string, rpc: Rpc, invoice: string, operation: "ANULACION" | "REVERSION", attempt: string): Promise<FiscalResponseCapture> {
  let bytes: Uint8Array;
  try { bytes = fromBase64(keyBase64); } catch { throw new Error("SOAP_EVIDENCIA_CLAVE_INVALIDA"); }
  if (bytes.length !== 32 || toBase64(bytes) !== keyBase64) throw new Error("SOAP_EVIDENCIA_CLAVE_INVALIDA");
  const key = await crypto.subtle.importKey("raw", owned(bytes), "AES-GCM", false, ["encrypt"]);
  const keyId = (await sha256Hex(bytes)).slice(0, 16);
  const aad = new TextEncoder().encode(`SIAT-9A|${invoice}|${operation}|${attempt}`);
  const reserved = await rpc("siat_9a_reservar_soap", { p_factura: invoice, p_operacion: operation, p_intento: attempt, p_clave_id: keyId });
  if (reserved.error) throw new Error("SOAP_EVIDENCIA_RESERVA_FALLIDA");
  return async (response) => {
    let nonce: string | null = null; let encrypted: string | null = null; let hash: string | null = null;
    if (response.body !== null) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: owned(iv), additionalData: owned(aad) }, key, owned(response.body));
      nonce = toBase64(iv); encrypted = toBase64(new Uint8Array(ciphertext)); hash = await sha256Hex(response.body);
    }
    const result = await rpc("siat_9a_guardar_soap", { p_intento: attempt, p_estado: response.body !== null ? "RECIBIDA" : response.reason ?? "SIN_RESPUESTA", p_http: response.status, p_nonce: nonce, p_cifrado: encrypted, p_sha256: hash });
    if (result.error) throw new Error("SOAP_EVIDENCIA_GUARDADO_FALLIDO");
  };
}

export async function openFiscalSoapEvidence(keyBase64: string, evidence: Record<string, unknown>): Promise<Uint8Array> {
  let raw: Uint8Array;
  try { raw = fromBase64(keyBase64); } catch { throw new Error("SOAP_EVIDENCIA_CLAVE_INVALIDA"); }
  if (raw.length !== 32 || toBase64(raw) !== keyBase64 || (await sha256Hex(raw)).slice(0, 16) !== evidence.clave_id || evidence.estado !== "RECIBIDA") throw new Error("SOAP_EVIDENCIA_NO_DISPONIBLE");
  const key = await crypto.subtle.importKey("raw", owned(raw), "AES-GCM", false, ["decrypt"]);
  const aad = new TextEncoder().encode(`SIAT-9A|${evidence.factura_id}|${evidence.operacion}|${evidence.intento_id}`);
  try {
    const clear = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: owned(fromBase64(String(evidence.nonce))), additionalData: owned(aad) }, key, owned(fromBase64(String(evidence.cifrado)))));
    if (await sha256Hex(clear) !== evidence.sha256) throw new Error("integridad");
    return clear;
  } catch { throw new Error("SOAP_EVIDENCIA_INTEGRIDAD_INVALIDA"); }
}

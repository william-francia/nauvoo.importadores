import { certificateDerFromPem } from "./signature-credentials.ts";
import type { SiatResponse } from "./types.ts";

export type PilotNitResult = "ACTIVO" | "INACTIVO" | "INEXISTENTE" | "ERROR_SERVICIO";

export function classifyPilotNit(response: SiatResponse): { resultado: PilotNitResult; codigo: number | null } {
  const codes = response.mensajes.map((message) => message.codigo).filter((code): code is number => code !== undefined);
  if (codes.some((code) => [992, 995, 999].includes(code))) return { resultado: "ERROR_SERVICIO", codigo: codes.find((code) => [992, 995, 999].includes(code))! };
  if (codes.includes(987)) return { resultado: "INACTIVO", codigo: 987 };
  if (codes.includes(994)) return { resultado: "INEXISTENTE", codigo: 994 };
  if (response.transaccion === true && codes.includes(986) && codes.every((code) => code === 986)) return { resultado: "ACTIVO", codigo: 986 };
  return { resultado: "ERROR_SERVICIO", codigo: codes[0] ?? null };
}

export async function publicCertificateSha256(pem: string): Promise<string> {
  const der = certificateDerFromPem(pem);
  const bytes = new Uint8Array(der.length);
  bytes.set(der);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function pilotNitEvidenceMatches(control: Record<string, unknown>, client: Record<string, unknown>, environment: unknown): boolean {
  const checkedAt = Date.parse(String(control.nit_verificado_at ?? ""));
  return control.nit_cliente_verificado === true && control.nit_cliente_id === client.id
    && control.nit_cliente_documento === client.numero_documento && control.nit_ambiente === environment
    && control.nit_codigo_respuesta === 986 && Number.isFinite(checkedAt)
    && checkedAt <= Date.now() && Date.now() - checkedAt < 24 * 60 * 60 * 1000;
}

export function pilotIdentityAllowed(control: Record<string, unknown>, client: Record<string, unknown>, environment: unknown): boolean {
  if (client.numero_documento !== "9204357" || client.nombre_razon_social !== "William Benjamin Francia Poma"
    || client.activo !== true || client.codigo_cliente !== "CLI-000006") return false;
  if (client.tipo_documento === "CI") return /^\d{4,12}$/.test(String(client.numero_documento))
    && (client.complemento == null || String(client.complemento).trim() === "");
  return client.tipo_documento === "NIT" && pilotNitEvidenceMatches(control, client, environment);
}

export function pilotCertificateEvidenceMatches(control: Record<string, unknown>, fingerprint: string): boolean {
  return control.eku_fiscal_aprobado === true && /^[a-f0-9]{64}$/.test(fingerprint)
    && control.eku_cert_sha256 === fingerprint && control.eku_alcance === "PRUEBAS"
    && ["ACEPTACION_SIAT_PILOTO", "CONFIRMACION_VERBAL_REPORTADA_POR_USUARIO"].includes(String(control.eku_tipo_evidencia))
    && Boolean(control.eku_aprobado_por) && Boolean(control.eku_aprobado_at) && Boolean(control.eku_declaracion_at);
}

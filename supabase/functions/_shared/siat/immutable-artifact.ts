import { sha256Hex } from "./encoding.ts";

type Bucket = {
  upload(path: string, bytes: Uint8Array, options: { contentType: string; upsert: false }): PromiseLike<{ error: unknown }>;
  download(path: string): PromiseLike<{ data: Blob | null; error: unknown }>;
};

export async function uploadImmutableFiscalArtifact(bucket: Bucket, path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const uploaded = await bucket.upload(path, bytes, { contentType, upsert: false });
  if (!uploaded.error) return;
  // Si ya existe, aceptar únicamente el mismo contenido; ante cualquier duda bloquear.
  const existing = await bucket.download(path);
  if (existing.error || !existing.data || await sha256Hex(new Uint8Array(await existing.data.arrayBuffer())) !== await sha256Hex(bytes)) throw new Error("ADJUNTO_EXISTENTE_NO_COINCIDE_O_NO_DISPONIBLE");
}

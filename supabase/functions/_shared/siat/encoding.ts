export async function gzipBytes(value: string | Uint8Array): Promise<Uint8Array> {
  const source = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const buffer = new ArrayBuffer(source.byteLength);
  new Uint8Array(buffer).set(source);
  const stream = new Blob([buffer]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function gunzipBytes(value: Uint8Array): Promise<Uint8Array> {
  const buffer = new ArrayBuffer(value.byteLength);
  new Uint8Array(buffer).set(value);
  const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export async function sha256Hex(value: Uint8Array): Promise<string> {
  const owned = new ArrayBuffer(value.byteLength);
  new Uint8Array(owned).set(value);
  const digest = await crypto.subtle.digest("SHA-256", owned);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export const toBase64 = (value: Uint8Array) => {
  let binary = "";
  for (let index = 0; index < value.length; index += 0x8000) {
    binary += String.fromCharCode(...value.subarray(index, index + 0x8000));
  }
  return btoa(binary);
};

export const fromBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

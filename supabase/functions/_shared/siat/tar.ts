const BLOCK = 512;
const encoder = new TextEncoder();

const writeText = (buffer: Uint8Array, offset: number, length: number, value: string) => {
  const bytes = encoder.encode(value);
  if (bytes.length > length) throw new Error(`El valor TAR excede ${length} bytes.`);
  buffer.set(bytes, offset);
};

const writeOctal = (buffer: Uint8Array, offset: number, length: number, value: number) => {
  const octal = Math.max(0, Math.trunc(value)).toString(8).padStart(length - 1, "0");
  writeText(buffer, offset, length, `${octal}\0`);
};

export interface TarEntry {
  name: string;
  content: Uint8Array;
}

export function createTar(entries: TarEntry[]): Uint8Array {
  if (!entries.length || entries.length > 500) throw new Error("Un paquete TAR debe contener entre 1 y 500 facturas.");
  const names = new Set<string>();
  const parts: Uint8Array[] = [];
  for (const entry of entries) {
    if (!/^[A-Za-z0-9_.-]+\.xml$/.test(entry.name) || names.has(entry.name)) throw new Error("Nombre de factura inválido o duplicado dentro del TAR.");
    names.add(entry.name);
    const header = new Uint8Array(BLOCK);
    writeText(header, 0, 100, entry.name);
    writeOctal(header, 100, 8, 0o600);
    writeOctal(header, 108, 8, 0);
    writeOctal(header, 116, 8, 0);
    writeOctal(header, 124, 12, entry.content.byteLength);
    writeOctal(header, 136, 12, Math.floor(Date.now() / 1000));
    header.fill(0x20, 148, 156);
    header[156] = "0".charCodeAt(0);
    writeText(header, 257, 6, "ustar\0");
    writeText(header, 263, 2, "00");
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    writeText(header, 148, 8, `${checksum.toString(8).padStart(6, "0")}\0 `);
    parts.push(header, entry.content);
    const padding = (BLOCK - (entry.content.byteLength % BLOCK)) % BLOCK;
    if (padding) parts.push(new Uint8Array(padding));
  }
  parts.push(new Uint8Array(BLOCK * 2));
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.byteLength; }
  return result;
}

export function officialQrUrl(ambiente: "PRUEBAS" | "PRODUCCION", nit: string, cuf: string, numeroFactura: string, size = 2): string {
  if (ambiente === "PRODUCCION") throw new Error("PENDIENTE_DE_VERIFICACION_OFICIAL: URL QR de producción requiere autorización del SIN.");
  const query = new URLSearchParams({ nit, cuf, numero: numeroFactura, t: String(size) });
  return `https://pilotosiat.impuestos.gob.bo/consulta/QR?${query.toString()}`;
}

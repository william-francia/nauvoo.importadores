export function prepararAvisoFiscal(input: { estadoFiscal: string; numeroFactura: string; cuf: string | null; motivo: string | null; emisor: string; nitEmisor: string }): string | null {
  const numero = String(input.numeroFactura ?? "").trim(); const cuf = String(input.cuf ?? "").trim();
  const emisor = String(input.emisor ?? "").trim(); const nit = String(input.nitEmisor ?? "").trim();
  if (!numero || !cuf || !emisor || !/^\d+$/.test(nit)) return null;
  if (input.estadoFiscal === "ANULADA") {
    const motivo = String(input.motivo ?? "").trim();
    if (!motivo) return null;
    return `${emisor} (NIT ${nit}) informa la anulación de la factura N.º ${numero}, código de autorización ${cuf}. Motivo: ${motivo}.`;
  }
  if (input.estadoFiscal === "REVERTIDA") return `${emisor} (NIT ${nit}) informa la reversión de la anulación de la factura N.º ${numero}, código de autorización ${cuf}.`;
  return null;
}

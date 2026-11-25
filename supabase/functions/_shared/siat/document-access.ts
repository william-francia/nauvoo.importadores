export function assertFiscalDocumentAccess(role: string, invoice: Record<string, unknown>): void {
  if (role.toLowerCase() !== "administrador") throw new Error("Documentos fiscales reservados a administración.");
  if (invoice.ambiente !== "PRUEBAS" || !["VALIDADA", "ANULADA", "REVERTIDA"].includes(String(invoice.estado_fiscal)) || invoice.codigo_estado !== 908
    || invoice.transaccion !== true || !invoice.codigo_recepcion || !invoice.cuf || !invoice.numero_factura
    || invoice.xml_firmado !== true || !invoice.xml_hash || !invoice.xml_storage_path) {
    throw new Error("Documento fiscal validado no disponible.");
  }
}

import { originalSignedXml, snapshotFromSignedXml } from "../../../../supabase/functions/_shared/siat/fiscal-document.ts";
import { generateFiscalPdf } from "../../../../supabase/functions/_shared/siat/fiscal-pdf.ts";
import { officialQrUrl } from "../../../../supabase/functions/_shared/siat/qr.ts";
import type { FacturaSiatDetalle } from "../types/siat.types";
import { obtenerXmlFiscalComprimido } from "./siat.gateway.service";
import { listarUnidadesFacturaSiat } from "./siat.service";

export type AccionDocumentoFiscal = "VER" | "PDF_CARTA" | "PDF_ROLLO" | "XML" | "CONSULTA";

export async function prepararDocumentoFiscal(factura: FacturaSiatDetalle, action: AccionDocumentoFiscal, widthMm = 80) {
  const gzip = await obtenerXmlFiscalComprimido(factura.id);
  const xml = await originalSignedXml(gzip, factura.xmlHash);
  const snapshot = snapshotFromSignedXml(xml, factura);
  const qr = officialQrUrl("PRUEBAS", snapshot.nit, snapshot.cuf, snapshot.numeroFactura, action === "PDF_ROLLO" ? 1 : 2);
  if (action === "CONSULTA") return { url: qr };
  if (action === "XML") return { bytes: xml, mime: "application/xml", filename: `factura-${snapshot.numeroFactura}.xml` };
  const units = await listarUnidadesFacturaSiat().catch(() => []);
  const labeledSnapshot = { ...snapshot, detalle: snapshot.detalle.map((item) => ({ ...item, unidadDescripcion: units.find((unit) => unit.codigo === item.unidadMedidaSin)?.descripcion })) };
  const bytes = await generateFiscalPdf(labeledSnapshot, qr, { format: action === "PDF_ROLLO" ? "rollo" : "carta", widthMm });
  return { bytes, mime: "application/pdf", filename: `factura-${snapshot.numeroFactura}${action === "PDF_ROLLO" ? "-rollo" : ""}.pdf` };
}

export async function ejecutarAccionDocumentoFiscal(factura: FacturaSiatDetalle, action: AccionDocumentoFiscal, widthMm = 80, openedWindow?: Window | null) {
  // Abrir durante el gesto del usuario evita que el navegador bloquee la vista previa.
  const target = action === "VER" || action === "CONSULTA" ? openedWindow === undefined ? window.open("", "_blank") : openedWindow : null;
  if ((action === "VER" || action === "CONSULTA") && !target) throw new Error("El navegador bloqueó la nueva ventana.");
  if (target) target.opener = null;
  try {
    const result = await prepararDocumentoFiscal(factura, action, widthMm);
    if (result.url && target) { target.location.href = result.url; return; }
    if (!result.bytes || !result.mime || !result.filename) throw new Error("Documento fiscal no disponible.");
    const bytes = new Uint8Array(result.bytes);
    const url = URL.createObjectURL(new Blob([bytes.buffer], { type: result.mime }));
    if (target) target.location.href = url;
    else {
      const link = document.createElement("a"); link.href = url; link.download = result.filename;
      document.body.appendChild(link); link.click(); link.remove();
    }
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) { target?.close(); throw error; }
}

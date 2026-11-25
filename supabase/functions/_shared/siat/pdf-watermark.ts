import { degrees, PDFDocument, rgb, StandardFonts } from "pdf-lib";

export async function cancelledWatermark(bytes: Uint8Array, cancelled: boolean): Promise<Uint8Array> {
  if (!cancelled) return bytes;
  const doc = await PDFDocument.load(bytes);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.min(width * 0.2, 110);
    const textWidth = font.widthOfTextAtSize("ANULADO", size);
    page.drawText("ANULADO", {
      x: Math.max(4, (width - textWidth * 0.72) / 2), y: height * 0.37,
      size, font, color: rgb(0.78, 0.05, 0.09), opacity: 0.23, rotate: degrees(38),
    });
  }
  return doc.save();
}

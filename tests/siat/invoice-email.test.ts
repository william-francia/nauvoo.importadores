import { describe, expect, it, vi } from "vitest";
import { resendInvoiceDocument, type InvoiceEmailDependencies } from "../../supabase/functions/_shared/siat/invoice-email.ts";
import { generateInvoiceXml } from "../../supabase/functions/_shared/siat/invoice-xml.ts";
import { gzipBytes, sha256Hex } from "../../supabase/functions/_shared/siat/encoding.ts";
import type { InvoiceSnapshot } from "../../supabase/functions/_shared/siat/types.ts";

const id = "11111111-1111-4111-8111-111111111111";
const request = { facturaId: id, idempotencia: "22222222-2222-4222-8222-222222222222", destinatario: "buyer@example.invalid", confirmacion: true };
async function fixture() {
  const snapshot: InvoiceSnapshot = {
    id, correlationId: "test", nit: "123456789", razonSocial: "Empresa sintética", municipio: "La Paz", telefono: null,
    numeroFactura: "42", cuf: "CUFTEST", cufd: "CUFDTEST", codigoSucursal: 0, codigoPuntoVenta: 0, direccion: "Dirección sintética",
    fechaEmision: "2026-11-25T12:00:00-04:00", modalidad: "ELECTRONICA", documentoSector: 1, tipoFactura: 1,
    cliente: { nombreRazonSocial: "Comprador sintético", codigoTipoDocumentoIdentidad: 1, numeroDocumento: "1234567", complemento: null, codigoCliente: "TEST" },
    pago: { codigoMetodoPago: 1, numeroTarjeta: null, codigoMoneda: 1, tipoCambio: "1" },
    totales: { montoTotal: "5", montoTotalSujetoIva: "5", montoTotalMoneda: "5", descuentoAdicional: "0", montoGiftCard: null },
    leyenda: "Leyenda sintética", usuario: "Prueba", detalle: [{ actividadEconomica: "123456", codigoProductoSin: "1234", codigoProducto: "TEST", descripcion: "Producto sintético", cantidad: "1", unidadMedidaSin: "47", precioUnitario: "5", descuento: null, subtotal: "5" }],
  };
  // Estructura sintética exclusivamente para verificar entrega; nunca se firma ni se envía al SIN.
  const xml = new TextEncoder().encode(generateInvoiceXml(snapshot).replace("</facturaElectronicaCompraVenta>", '<ds:Signature xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignatureValue>TEST</ds:SignatureValue></ds:Signature></facturaElectronicaCompraVenta>'));
  const gzip = await gzipBytes(xml);
  const row = { id, ambiente: "PRUEBAS", estado_fiscal: "VALIDADA", codigo_estado: 908, transaccion: true, codigo_recepcion: "TEST-RECEPCION", numero_factura: "42", cuf: snapshot.cuf, xml_firmado: true, xml_hash: await sha256Hex(gzip), xml_storage_path: "synthetic/file.xml.gz", cliente_snapshot: snapshot.cliente, monto_total: 5, fecha_emision: snapshot.fechaEmision, codigo_sucursal: 0, codigo_punto_venta: 0 };
  const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: "synthetic-provider-id-12345" })));
  const rpc = vi.fn<InvoiceEmailDependencies["rpc"]>().mockImplementation(async name => ({ data: name === "siat_reservar_correo_documento" ? { claimed: true, estado: "ENVIANDO" } : "ENVIADA", error: null }));
  const deps: InvoiceEmailDependencies = { role: "administrador", actor: id, apiKey: "synthetic-only", from: "test@example.invalid", hmacKey: "s".repeat(32), invoice: vi.fn().mockResolvedValue(row), gzip: vi.fn().mockResolvedValue(gzip), rpc, transport };
  return { deps, row, xml, transport, rpc };
}

describe("reenvío fiscal con proveedor simulado y persistencia idempotente", () => {
  it("adjunta PDF y los bytes originales del XML; aceptación no equivale a entrega", async () => {
    const { deps, xml, transport, rpc } = await fixture();
    expect(await resendInvoiceDocument(request, deps)).toEqual({ estado: "ENVIADA", entregaConfirmada: false, reutilizado: false });
    const sent = JSON.parse(String(transport.mock.calls[0][1]?.body));
    expect(Buffer.from(sent.attachments[1].content, "base64")).toEqual(Buffer.from(xml));
    expect(Buffer.from(sent.attachments[0].content, "base64").subarray(0, 4).toString()).toBe("%PDF");
    expect(sent.to).toContain(request.destinatario);
    expect(transport.mock.calls[0][1]?.headers).toMatchObject({ "idempotency-key": `siat-documento/${request.idempotencia}` });
    expect(rpc.mock.calls[0][1].p_destino_hmac).toMatch(/^[A-F0-9]{64}$/);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(request.destinatario);
    expect(rpc.mock.calls[1][1].p_evidencia_hash).toMatch(/^[A-F0-9]{64}$/);
  });
  it.each(["rol", "confirmacion", "configuracion", "rechazada", "hash"])("bloquea antes de enviar: %s", async reason => {
    const { deps, row, transport, rpc } = await fixture();
    if (reason === "rol") deps.role = "vendedor";
    if (reason === "configuracion") deps.apiKey = "";
    if (reason === "rechazada") row.estado_fiscal = "RECHAZADA";
    if (reason === "hash") row.xml_hash = "A".repeat(64);
    await expect(resendInvoiceDocument({ ...request, confirmacion: reason !== "confirmacion" }, deps)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled(); expect(rpc).not.toHaveBeenCalled();
  });
  it("un reintento ya aceptado devuelve el resultado persistido sin enviar nuevamente", async () => {
    const { deps, rpc, transport } = await fixture();
    rpc.mockResolvedValue({ data: { claimed: false, estado: "ENVIADA" }, error: null });
    expect(await resendInvoiceDocument(request, deps)).toMatchObject({ estado: "ENVIADA", reutilizado: true });
    expect(transport).not.toHaveBeenCalled();
  });
  it.each(["ENVIANDO", "INCIERTA"])("no reintenta un intento %s", async estado => {
    const { deps, rpc, transport } = await fixture();
    rpc.mockResolvedValue({ data: { claimed: false, estado }, error: null });
    await expect(resendInvoiceDocument(request, deps)).rejects.toThrow("REQUIERE_REVISION");
    expect(transport).not.toHaveBeenCalled();
  });
  it.each(["timeout", "rechazo", "persistencia"])("conserva incertidumbre sin reintentos tras %s", async reason => {
    const { deps, rpc, transport } = await fixture();
    if (reason === "timeout") transport.mockRejectedValue(Error("timeout"));
    if (reason === "rechazo") transport.mockResolvedValue(new Response("rejected", { status: 400 }));
    if (reason === "persistencia") rpc.mockImplementation(async (name, args) => ({ data: name === "siat_reservar_correo_documento" ? { claimed: true } : null, error: args.p_estado === "ENVIADA" ? Error("database unavailable") : null }));
    await expect(resendInvoiceDocument(request, deps)).rejects.toThrow("REQUIERE_REVISION");
    expect(transport).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenLastCalledWith("siat_finalizar_correo_documento", expect.objectContaining({ p_estado: "INCIERTA" }));
  });
  it("dos solicitudes concurrentes usan una sola reserva y un único envío", async () => {
    const { deps, rpc, transport } = await fixture();
    let claimed = false;
    rpc.mockImplementation(async name => {
      if (name !== "siat_reservar_correo_documento") return { data: "ENVIADA", error: null };
      const first = !claimed; claimed = true;
      return { data: { claimed: first, estado: "ENVIANDO" }, error: null };
    });
    const results = await Promise.allSettled([resendInvoiceDocument(request, deps), resendInvoiceDocument(request, deps)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(transport).toHaveBeenCalledOnce();
  });
});

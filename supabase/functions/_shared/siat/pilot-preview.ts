export type PilotPreviewInput = {
  config: Record<string, unknown>;
  client: Record<string, unknown> | null;
  product: Record<string, unknown> | null;
  catalogs: Array<{ catalog: string; state: string; code: string; description: string; active: boolean; activity?: string | null }>;
  paymentCode: number | null;
  cuis: Record<string, unknown> | null;
  cufd: Record<string, unknown> | null;
  pendingJobs: number;
  now: Date;
  proposedPrice?: number;
  proposedDiscount?: number;
  ekuFiscalApproved?: boolean;
  nitClientVerified?: boolean;
  emissionEnabled?: boolean;
  routeReady?: boolean;
};

export function assertPilotPreviewAdmin(role: string): void {
  if (role.toLowerCase() !== "administrador") throw new Error("Operación reservada a administración.");
}

export async function pilotPreviewHash(preview: ReturnType<typeof buildPilotPreview>, secondPilot: boolean, cancellationPilot = false): Promise<string> {
  const fields = [preview.ambiente, preview.cliente.codigo, preview.cliente.nombre, preview.cliente.codigoTipoDocumento, preview.cliente.documento,
    preview.producto.codigo, preview.producto.descripcion, preview.producto.actividad, preview.producto.codigoSin, preview.producto.unidadSin,
    preview.producto.cantidad, preview.montos.precio, preview.montos.descuento, preview.montos.total, preview.pago.codigoSin];
  if (cancellationPilot) fields.push("TERCERA_FACTURA_PILOTO_ANULACION_9A_08DD889E");
  else if (secondPilot) fields.push("SEGUNDA_FACTURA_PILOTO_C2279BBB");
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(fields))));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function pilotAuthorizationEnabled(control: Record<string, unknown>, authorization: Record<string, unknown> | null, now: Date): boolean {
  return control.emision_habilitada === true && Boolean(control.autorizacion_habilitada_id)
    && authorization?.estado === "PREPARADA" && Date.parse(String(authorization.expires_at)) > now.getTime();
}

const requiredCatalog = (items: PilotPreviewInput["catalogs"], catalog: string, code: string) =>
  items.find((item) => item.catalog === catalog && item.code === code && item.state === "VIGENTE" && item.active);

const validAmount = (value: number, label: string) => {
  if (!Number.isFinite(value) || value < 0 || Math.abs(Math.round(value * 100) - value * 100) > 1e-7) throw new Error(`PILOTO_${label}_INVALIDO`);
  return Math.round(value * 100);
};

const validCode = (row: Record<string, unknown> | null, now: Date) =>
  Boolean(row && row.estado === "VIGENTE" && row.ambiente === "PRUEBAS" &&
    (!row.fecha_inicio || Date.parse(String(row.fecha_inicio)) <= now.getTime()) &&
    (!row.fecha_expiracion || Date.parse(String(row.fecha_expiracion)) > now.getTime()));

export function buildPilotPreview(input: PilotPreviewInput) {
  const { config, client, product, catalogs, cuis, cufd, now } = input;
  if (config.ambiente !== "PRUEBAS") throw new Error("PILOTO_SOLO_PRUEBAS");
  const blockers: string[] = [];
  if (config.modalidad !== "ELECTRONICA" || config.version_normativa !== "SIAT_VIGENTE") blockers.push("CONFIGURACION_PILOTO_INVALIDA");
  if (String(config.nit ?? "") !== "72229012" || String(config.actividad_economica ?? "") !== "4752100") blockers.push("EMISOR_NO_COINCIDE");
  if (config.siat_habilitado !== false) blockers.push("EMISION_GENERAL_DEBE_ESTAR_DESHABILITADA");
  const isCi = client?.tipo_documento === "CI";
  const isNit = client?.tipo_documento === "NIT";
  if (!client || client.codigo_cliente !== "CLI-000006" || client.nombre_razon_social !== "William Benjamin Francia Poma"
    || (!isCi && !isNit) || client.numero_documento !== "9204357" || client.activo !== true
    || isCi && (!/^\d{4,12}$/.test(String(client.numero_documento)) || client.complemento != null && String(client.complemento).trim() !== "")) blockers.push("CLIENTE_PILOTO_NO_VALIDO");
  if (!product || product.codigo_interno !== "ph1234" || product.activo !== true) blockers.push("PRODUCTO_FIXTURE_NO_DISPONIBLE");
  const activity = requiredCatalog(catalogs, "ACTIVIDADES", "4752100");
  const service = requiredCatalog(catalogs, "PRODUCTOS_SERVICIOS", "1003451");
  const unit = requiredCatalog(catalogs, "UNIDADES_MEDIDA", "47");
  const payment = requiredCatalog(catalogs, "METODOS_PAGO", "1");
  const document = requiredCatalog(catalogs, "TIPOS_DOCUMENTO", isCi ? "1" : "5");
  if (!activity || !service || service.activity !== "4752100" || !unit || !payment || !document || input.paymentCode !== 1) blockers.push("CATALOGOS_O_PAGO_NO_VIGENTES");
  const cuisValid = validCode(cuis, now);
  const cufdValid = validCode(cufd, now) && Boolean(cuis && cufd && cufd.fecha_expiracion && cufd.cuis_id === cuis.id);
  if (!cuisValid) blockers.push("CUIS_NO_VIGENTE");
  if (!cufdValid) blockers.push("CUFD_NO_VIGENTE");
  if (input.pendingJobs > 0) blockers.push("OUTBOX_CON_TAREAS_PENDIENTES");
  const priceCents = validAmount(input.proposedPrice ?? Number(product?.precio_pieza), "PRECIO");
  const discountCents = validAmount(input.proposedDiscount ?? 0, "DESCUENTO");
  if (priceCents <= 0 || discountCents > priceCents) throw new Error("PILOTO_TOTALES_INVALIDOS");
  if (!input.ekuFiscalApproved) blockers.push("CERTIFICADO_EKU_FISCAL_PENDIENTE");
  if (isNit && !input.nitClientVerified) blockers.push("NIT_CLIENTE_SIN_VERIFICAR");
  if (!input.emissionEnabled) blockers.push("PILOTO_EMISION_CERRADA");
  if (!input.routeReady) blockers.push("RUTA_EMISION_AISLADA_PENDIENTE");
  blockers.push("AUTORIZACION_EXPLICITA_PENDIENTE");
  return {
    tipo: "FIXTURE_FISCAL_NO_COMERCIAL" as const,
    ambiente: "PRUEBAS" as const,
    codigoAmbiente: 2 as const,
    emisor: { nit: "72229012", actividad: "4752100" },
    cliente: { codigo: String(client?.codigo_cliente ?? ""), nombre: String(client?.nombre_razon_social ?? ""), tipoDocumento: isCi ? "CI" : "NIT", codigoTipoDocumento: isCi ? 1 : 5, documento: String(client?.numero_documento ?? "") },
    producto: { codigo: "ph1234", descripcion: String(product?.nombre ?? ""), actividad: "4752100", codigoSin: "1003451", unidadSin: "47", cantidad: 1, origen: "PENDIENTE" as const, homologacionPersistida: false },
    pago: { metodo: "EFECTIVO", codigoSin: 1 },
    montos: { moneda: "BOB", precio: priceCents / 100, subtotal: priceCents / 100, descuento: discountCents / 100, total: (priceCents - discountCents) / 100, precioConfirmado: false },
    codigos: { cuisVigente: cuisValid, cufdVigente: cufdValid, cufdVence: cufdValid ? String(cufd?.fecha_expiracion) : null },
    certificadoFiscal: input.ekuFiscalApproved ? "EKU_APROBADO" as const : "EKU_PENDIENTE" as const,
    advertencias: ["ORIGEN_NO_DECLARADO_FIXTURE_PILOTO"],
    tareasPendientes: input.pendingJobs,
    puedeEmitir: false as const,
    numeroReservado: false as const,
    blockers,
  };
}

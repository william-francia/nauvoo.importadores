import { supabase } from "../../../lib/supabase";
import { CATALOGOS_HOMOLOGACION, SIAT_CONFIGURACION_INICIAL } from "../constants/siat.constants";
import { obtenerSaludGatewaySiat } from "./siat.gateway.service";
import type { HomologacionProductoInput } from "../schemas/siat.schemas";
import type {
  AuditoriaSiat,
  CatalogoOpcionSiat,
  CatalogosHomologacion,
  ContingenciaOpciones,
  EstadoFiscal,
  EstadoSiatResumen,
  EventoSignificativoSiat,
  FacturaSiatDetalle,
  FacturaSiatResumen,
  PaqueteSiat,
  ProductoHomologacion,
  MetodoPagoMapeoSiat,
  SiatConfiguracion,
  SucursalSiat,
  VentaOfflineSiat,
} from "../types/siat.types";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function relation(value: unknown): JsonObject {
  return Array.isArray(value) ? object(value[0]) : object(value);
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

function number(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function technicalMessage(error: { message?: string; code?: string } | null | undefined) {
  return `${error?.code ?? ""} ${error?.message ?? ""}`.toLocaleLowerCase("es");
}

function siatError(error: { message?: string; code?: string } | null | undefined, fallback: string) {
  if (import.meta.env.DEV && error) console.error("SIAT data error", error);
  const technical = technicalMessage(error);
  if (["schema cache", "relation", "does not exist", "could not find the table", "pgrst205", "42p01"].some((item) => technical.includes(item))) {
    return new Error("Módulo SIAT pendiente de configuración.");
  }
  return new Error(fallback);
}

function mapFactura(raw: unknown): FacturaSiatResumen {
  const row = object(raw);
  const venta = relation(row.venta);
  const cliente = relation(venta.cliente);
  const snapshot = object(row.cliente_snapshot);
  return {
    id: text(row.id),
    ventaId: text(row.venta_id),
    numeroFactura: row.numero_factura == null ? "Sin asignar" : text(row.numero_factura),
    fechaEmision: text(row.fecha_emision),
    cliente: text(snapshot.nombreRazonSocial ?? row.nombre_razon_social ?? cliente.nombre_razon_social, "Sin cliente"),
    documento: text(snapshot.numeroDocumento ?? row.numero_documento ?? cliente.numero_documento, "—"),
    codigoVenta: text(venta.codigo_venta, "—"),
    total: number(row.monto_total),
    moneda: text(object(row.pago_snapshot).moneda, "BOB"),
    cuf: row.cuf ? text(row.cuf) : null,
    estadoFiscal: text(row.estado_fiscal, "BORRADOR") as EstadoFiscal,
    estadoComercial: text(venta.estado, "—"),
    ambiente: text(row.ambiente, "PRUEBAS") as FacturaSiatResumen["ambiente"],
    tipoEmision: text(row.tipo_emision, "ONLINE") as FacturaSiatResumen["tipoEmision"],
    eventoId: row.evento_id ? text(row.evento_id) : null,
    codigoRecepcion: row.codigo_recepcion ? text(row.codigo_recepcion) : null,
    mensajesSiat: Array.isArray(row.mensajes_siat) ? row.mensajes_siat : [],
    sucursal: text(row.codigo_sucursal, "0"),
    puntoVenta: text(row.codigo_punto_venta, "0"),
  };
}

const FACTURA_SELECT = `
  id, venta_id, numero_factura, fecha_emision, nombre_razon_social,
  numero_documento, monto_total, cuf, estado_fiscal, ambiente, tipo_emision,
  evento_id, codigo_recepcion, mensajes_siat, codigo_sucursal, codigo_punto_venta,
  cliente_snapshot, pago_snapshot,
  venta:ventas(codigo_venta,estado,cliente:clientes(nombre_razon_social,numero_documento))
`;

export async function listarFacturasSiat(): Promise<FacturaSiatResumen[]> {
  const { data, error } = await supabase.from("facturas_siat").select(FACTURA_SELECT).order("fecha_emision", { ascending: false }).limit(500);
  if (error) throw siatError(error, "No se pudieron cargar las facturas fiscales.");
  return (data ?? []).map(mapFactura);
}

export async function obtenerFacturaSiat(id: string): Promise<FacturaSiatDetalle> {
  const [{ data, error }, auditResult] = await Promise.all([
    supabase.from("facturas_siat").select(`${FACTURA_SELECT},detalle_snapshot,totales_snapshot,cufd,xml_documento,xml_storage_path,pdf_storage_path,cantidad_intentos,motivo_anulacion`).eq("id", id).single(),
    supabase.from("siat_auditoria").select("id,accion,resultado,created_at,actor_auth_user_id,contexto").eq("entidad", "facturas_siat").eq("entidad_id", id).order("created_at", { ascending: false }).limit(100),
  ]);
  if (error) throw siatError(error, "No se pudo cargar el detalle fiscal.");
  const row = object(data);
  const base = mapFactura(row);
  const auditoria: AuditoriaSiat[] = auditResult.error ? [] : (auditResult.data ?? []).map((raw) => {
    const item = object(raw);
    return { id: text(item.id), accion: text(item.accion), resultado: text(item.resultado), fecha: text(item.created_at), actor: text(item.actor_auth_user_id, "Sistema"), contexto: object(item.contexto) };
  });
  return {
    ...base,
    clienteSnapshot: object(row.cliente_snapshot),
    detalleSnapshot: Array.isArray(row.detalle_snapshot) ? row.detalle_snapshot : [],
    totalesSnapshot: object(row.totales_snapshot),
    pagoSnapshot: object(row.pago_snapshot),
    cufdUtilizado: row.cufd ? text(row.cufd) : null,
    cantidadIntentos: number(row.cantidad_intentos),
    motivoAnulacion: row.motivo_anulacion ? text(row.motivo_anulacion) : null,
    pdfDisponible: Boolean(row.pdf_storage_path),
    xmlDisponible: Boolean(row.xml_storage_path || row.xml_documento),
    auditoria,
  };
}

export async function obtenerRolActual(): Promise<string | null> {
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return null;
  const { data, error } = await supabase.from("usuarios").select("rol,activo").eq("auth_user_id", authData.user.id).maybeSingle();
  if (error) throw new Error("No se pudieron verificar los permisos del usuario.");
  return data?.activo ? text(data.rol) : null;
}

export async function obtenerConfiguracionSiat(): Promise<SiatConfiguracion> {
  const { data, error } = await supabase.from("siat_configuracion").select("*").eq("id", true).maybeSingle();
  if (error) throw siatError(error, "No se pudo cargar la configuración SIAT.");
  if (!data) return SIAT_CONFIGURACION_INICIAL;
  const row = object(data);
  return {
    nit: text(row.nit), razonSocial: text(row.razon_social), nombreComercial: text(row.nombre_comercial),
    municipio: text(row.municipio), domicilio: text(row.domicilio), telefono: text(row.telefono), codigoSistema: text(row.codigo_sistema),
    modalidad: text(row.modalidad, "COMPUTARIZADA") as SiatConfiguracion["modalidad"], documentoSector: text(row.documento_sector),
    tipoFactura: text(row.tipo_factura), actividadEconomica: text(row.actividad_economica), ambiente: text(row.ambiente, "PRUEBAS") as SiatConfiguracion["ambiente"],
    versionNormativa: text(row.version_normativa, "SIAT_VIGENTE") as SiatConfiguracion["versionNormativa"], zonaHoraria: "America/La_Paz",
    siatHabilitado: Boolean(row.siat_habilitado),
    sucursalPredeterminadaId: text(row.sucursal_predeterminada_id),
    puntoVentaPredeterminadoId: text(row.punto_venta_predeterminado_id),
  };
}

export async function guardarConfiguracionSiat(input: SiatConfiguracion): Promise<void> {
  const { error } = await supabase.from("siat_configuracion").upsert({
    id: true, nit: input.nit.trim() || null, razon_social: input.razonSocial.trim() || null, nombre_comercial: input.nombreComercial.trim() || null,
    municipio: input.municipio.trim() || null, domicilio: input.domicilio.trim() || null, telefono: input.telefono.trim() || null,
    codigo_sistema: input.codigoSistema.trim() || null, modalidad: input.modalidad, documento_sector: input.documentoSector ? Number(input.documentoSector) : null,
    tipo_factura: input.tipoFactura ? Number(input.tipoFactura) : null, actividad_economica: input.actividadEconomica.trim() || null,
    ambiente: "PRUEBAS", version_normativa: input.versionNormativa, zona_horaria: "America/La_Paz", siat_habilitado: input.siatHabilitado,
    sucursal_predeterminada_id: input.sucursalPredeterminadaId || null,
    punto_venta_predeterminado_id: input.puntoVentaPredeterminadoId || null,
  });
  if (error) throw siatError(error, "No se pudo guardar la configuración SIAT.");
}

export async function listarSucursalesSiat(): Promise<SucursalSiat[]> {
  const { data, error } = await supabase.from("siat_sucursales").select("id,codigo,nombre,municipio,direccion,activo,puntos:siat_puntos_venta(id,codigo,nombre,activo)").order("codigo");
  if (error) throw siatError(error, "No se pudieron cargar las sucursales tributarias.");
  return (data ?? []).map((raw) => {
    const row = object(raw);
    return { id: text(row.id), codigo: number(row.codigo), nombre: text(row.nombre), municipio: row.municipio ? text(row.municipio) : null, direccion: row.direccion ? text(row.direccion) : null, activo: Boolean(row.activo), puntosVenta: (Array.isArray(row.puntos) ? row.puntos : []).map((value) => { const point = object(value); return { id: text(point.id), codigo: number(point.codigo), nombre: text(point.nombre), activo: Boolean(point.activo) }; }) };
  });
}

export async function guardarSucursalSiat(input: { codigo: number; nombre: string; municipio: string; direccion: string }): Promise<void> {
  const { error } = await supabase.from("siat_sucursales").upsert({ codigo: input.codigo, nombre: input.nombre.trim(), municipio: input.municipio.trim() || null, direccion: input.direccion.trim() || null, activo: true }, { onConflict: "codigo" });
  if (error) throw siatError(error, "No se pudo guardar la sucursal tributaria.");
}

export async function guardarPuntoVentaSiat(input: { sucursalId: string; codigo: number; nombre: string }): Promise<void> {
  const { error } = await supabase.from("siat_puntos_venta").upsert({ sucursal_id: input.sucursalId, codigo: input.codigo, nombre: input.nombre.trim(), activo: true }, { onConflict: "sucursal_id,codigo" });
  if (error) throw siatError(error, "No se pudo guardar el punto de venta.");
}

export async function obtenerEstadoSiat(): Promise<EstadoSiatResumen> {
  const [health, config, cuis, cufd, sync, invoices, event, packages] = await Promise.all([
    obtenerSaludGatewaySiat(),
    supabase.from("siat_configuracion").select("ambiente,siat_habilitado").eq("id", true).maybeSingle(),
    supabase.from("siat_cuis").select("estado,fecha_expiracion").eq("estado", "VIGENTE").order("fecha_expiracion", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("siat_cufd").select("estado,fecha_expiracion").eq("estado", "VIGENTE").order("fecha_expiracion", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("siat_sincronizaciones").select("fecha_fin").eq("estado", "COMPLETADA").order("fecha_fin", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("facturas_siat").select("id", { count: "exact", head: true }).in("estado_fiscal", ["EN_COLA", "GENERANDO", "VALIDANDO_XSD", "ENVIANDO", "SIN_RESPUESTA", "OFFLINE", "PAQUETE_PENDIENTE"]),
    supabase.from("siat_eventos_significativos").select("id,descripcion,tipo_evento_codigo").in("estado", ["REGISTRADO", "ACTIVO", "ENVIADO"]).order("fecha_inicio", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("siat_paquetes").select("id", { count: "exact", head: true }).in("estado", ["PENDIENTE", "GENERANDO", "EN_COLA", "ENVIADO", "RECEPCIONADO", "VALIDANDO"]),
  ]);
  const failed = [config, cuis, cufd, sync, invoices, event, packages].find((result) => result.error);
  if (failed?.error) throw siatError(failed.error, "No se pudo consultar el estado SIAT.");
  const configRow = object(config.data);
  const eventRow = object(event.data);
  const now = Date.now();
  const isCurrent = (value: unknown) => Boolean(value) && new Date(text(value)).getTime() > now;
  return {
    servicio: health.habilitado && health.secretos.token ? "OPERATIVO" : configRow.siat_habilitado ? "GATEWAY_PENDIENTE" : "EN_CONFIGURACION",
    ambiente: text(configRow.ambiente, "PRUEBAS") as EstadoSiatResumen["ambiente"],
    cuis: !cuis.data ? "NO_CONFIGURADO" : isCurrent(object(cuis.data).fecha_expiracion) || !object(cuis.data).fecha_expiracion ? "VIGENTE" : "VENCIDO",
    cufd: !cufd.data ? "NO_CONFIGURADO" : isCurrent(object(cufd.data).fecha_expiracion) ? "VIGENTE" : "VENCIDO",
    ultimaSincronizacion: sync.data ? text(object(sync.data).fecha_fin) : null,
    facturasPendientes: invoices.count ?? 0,
    contingenciaActiva: Boolean(event.data),
    eventoActual: event.data ? text(eventRow.descripcion ?? eventRow.tipo_evento_codigo, "Evento activo") : null,
    paquetesPendientes: packages.count ?? 0,
  };
}

export async function listarMotivosAnulacion(): Promise<CatalogoOpcionSiat[]> {
  return catalogOptions("MOTIVOS_ANULACION");
}

export async function obtenerMapeosMetodosPago(): Promise<{ opciones: CatalogoOpcionSiat[]; mapeos: MetodoPagoMapeoSiat[] }> {
  const [opciones, result] = await Promise.all([
    catalogOptions("METODOS_PAGO"),
    supabase.from("siat_metodo_pago_mapeos").select("metodo_interno,codigo_metodo_pago").eq("version_normativa", "SIAT_VIGENTE"),
  ]);
  if (result.error) throw siatError(result.error, "No se pudieron cargar los mapeos de pago.");
  return { opciones, mapeos: (result.data ?? []).map((item) => ({ metodoInterno: text(item.metodo_interno) as MetodoPagoMapeoSiat["metodoInterno"], codigoMetodoPago: text(item.codigo_metodo_pago) })) };
}

export async function guardarMapeosMetodosPago(mapeos: MetodoPagoMapeoSiat[]): Promise<void> {
  if (mapeos.some((item) => !item.codigoMetodoPago)) throw new Error("Mapea todos los métodos de pago antes de guardar.");
  const { error } = await supabase.from("siat_metodo_pago_mapeos").upsert(mapeos.map((item) => ({ metodo_interno: item.metodoInterno, codigo_metodo_pago: Number(item.codigoMetodoPago), version_normativa: "SIAT_VIGENTE" })), { onConflict: "metodo_interno" });
  if (error) throw siatError(error, "No se pudieron guardar los mapeos de pago.");
}

export async function listarPaquetesSiat(): Promise<PaqueteSiat[]> {
  const { data, error } = await supabase.from("siat_paquetes").select("id,evento_id,codigo_recepcion,estado,cantidad_facturas,intentos,fecha_envio,fecha_validacion,ultimo_error").order("created_at", { ascending: false }).limit(500);
  if (error) throw siatError(error, "No se pudieron cargar los paquetes SIAT.");
  return (data ?? []).map((raw) => { const row = object(raw); return { id: text(row.id), eventoId: row.evento_id ? text(row.evento_id) : null, codigoRecepcion: row.codigo_recepcion ? text(row.codigo_recepcion) : null, estado: text(row.estado), cantidadFacturas: number(row.cantidad_facturas), intentos: number(row.intentos), fechaEnvio: row.fecha_envio ? text(row.fecha_envio) : null, fechaValidacion: row.fecha_validacion ? text(row.fecha_validacion) : null, ultimoError: row.ultimo_error ? text(row.ultimo_error) : null }; });
}

export async function listarEventosSiat(): Promise<EventoSignificativoSiat[]> {
  const [eventsResult, invoicesResult, packages] = await Promise.all([
    supabase.from("siat_eventos_significativos").select("id,tipo_evento_codigo,descripcion,observaciones,fecha_inicio,fecha_fin,estado,cufd_id,codigo_recepcion,sucursal:siat_sucursales(codigo,nombre),punto:siat_puntos_venta(codigo,nombre),cufd:siat_cufd(fecha_expiracion)").order("fecha_inicio", { ascending: false }).limit(500),
    supabase.from("facturas_siat").select("id,evento_id").not("evento_id", "is", null),
    listarPaquetesSiat(),
  ]);
  if (eventsResult.error || invoicesResult.error) throw siatError(eventsResult.error ?? invoicesResult.error, "No se pudieron cargar los eventos significativos.");
  const invoiceCounts = new Map<string, number>();
  for (const raw of invoicesResult.data ?? []) { const row = object(raw); const id = text(row.evento_id); invoiceCounts.set(id, (invoiceCounts.get(id) ?? 0) + 1); }
  return (eventsResult.data ?? []).map((raw) => {
    const row = object(raw); const branch = relation(row.sucursal); const point = relation(row.punto); const cufdRow = relation(row.cufd); const eventPackages = packages.filter((item) => item.eventoId === text(row.id));
    return { id: text(row.id), sucursal: branch.nombre ? `${text(branch.codigo)} · ${text(branch.nombre)}` : "—", puntoVenta: point.nombre ? `${text(point.codigo)} · ${text(point.nombre)}` : "—", tipoEventoCodigo: row.tipo_evento_codigo ? text(row.tipo_evento_codigo) : null, descripcion: row.descripcion ? text(row.descripcion) : null, observaciones: row.observaciones ? text(row.observaciones) : null, fechaInicio: text(row.fecha_inicio), fechaFin: row.fecha_fin ? text(row.fecha_fin) : null, estado: text(row.estado), cufdId: row.cufd_id ? text(row.cufd_id) : null, cufdVigente: Boolean(cufdRow.fecha_expiracion) && new Date(text(cufdRow.fecha_expiracion)).getTime() > Date.now(), codigoRecepcion: row.codigo_recepcion ? text(row.codigo_recepcion) : null, cantidadFacturas: invoiceCounts.get(text(row.id)) ?? 0, cantidadPaquetes: eventPackages.length, paquetesRecepcionados: eventPackages.filter((item) => ["RECEPCIONADO", "VALIDANDO", "VALIDADO"].includes(item.estado)).length, paquetesValidados: eventPackages.filter((item) => item.estado === "VALIDADO").length };
  });
}

export async function listarVentasOffline(): Promise<VentaOfflineSiat[]> {
  const [invoicesResult, linksResult] = await Promise.all([
    supabase.from("facturas_siat").select(FACTURA_SELECT).eq("tipo_emision", "OFFLINE").order("fecha_emision", { ascending: false }).limit(500),
    supabase.from("siat_paquete_facturas").select("factura_id,paquete_id"),
  ]);
  if (invoicesResult.error || linksResult.error) throw siatError(invoicesResult.error ?? linksResult.error, "No se pudieron cargar las ventas offline.");
  const packageByInvoice = new Map((linksResult.data ?? []).map((raw) => { const row = object(raw); return [text(row.factura_id), text(row.paquete_id)] as const; }));
  return (invoicesResult.data ?? []).map((raw) => { const invoice = mapFactura(raw); return { ...invoice, usuario: "—", evento: invoice.eventoId ?? "—", paquete: packageByInvoice.get(invoice.id) ?? "—" }; });
}

async function catalogOptions(code: string): Promise<CatalogoOpcionSiat[]> {
  const { data: catalog, error: catalogError } = await supabase.from("siat_catalogos").select("id").eq("codigo", code).eq("version_normativa", "SIAT_VIGENTE").maybeSingle();
  if (catalogError) throw siatError(catalogError, "No se pudo cargar el catálogo SIAT.");
  if (!catalog) return [];
  const { data, error } = await supabase.from("siat_catalogo_items").select("codigo,descripcion").eq("catalogo_id", catalog.id).eq("activo", true).order("descripcion");
  if (error) throw siatError(error, "No se pudo cargar el catálogo SIAT.");
  return (data ?? []).map((item) => ({ codigo: text(item.codigo), descripcion: text(item.descripcion) }));
}

export async function listarCatalogosHomologacion(): Promise<CatalogosHomologacion> {
  const [actividades, productosServicios, unidadesMedida] = await Promise.all([
    catalogOptions(CATALOGOS_HOMOLOGACION.actividades), catalogOptions(CATALOGOS_HOMOLOGACION.productosServicios), catalogOptions(CATALOGOS_HOMOLOGACION.unidadesMedida),
  ]);
  return { actividades, productosServicios, unidadesMedida };
}

export async function listarHomologacionesProductos(): Promise<ProductoHomologacion[]> {
  const [products, homologations] = await Promise.all([
    supabase.from("productos").select("id,codigo_interno,nombre").eq("activo", true).order("nombre"),
    supabase.from("siat_producto_homologaciones").select("*").eq("version_normativa", "SIAT_VIGENTE"),
  ]);
  if (products.error || homologations.error) throw siatError(products.error ?? homologations.error, "No se pudo cargar la homologación de productos.");
  const byProduct = new Map((homologations.data ?? []).map((raw) => { const row = object(raw); return [text(row.producto_id), row] as const; }));
  return (products.data ?? []).map((raw) => { const product = object(raw); const homologation = object(byProduct.get(text(product.id))); return { productoId: text(product.id), codigoInterno: text(product.codigo_interno), nombre: text(product.nombre), codigoProductoSin: text(homologation.codigo_producto_sin), actividadEconomica: text(homologation.actividad_economica), unidadMedidaSin: text(homologation.unidad_medida_sin), origen: text(homologation.origen, "IMPORTADO") as ProductoHomologacion["origen"], versionCatalogo: text(homologation.version_catalogo), versionNormativa: text(homologation.version_normativa, "SIAT_VIGENTE") as ProductoHomologacion["versionNormativa"], estado: text(homologation.estado, "PENDIENTE") as ProductoHomologacion["estado"] }; });
}

export async function guardarHomologacionProducto(producto: Pick<ProductoHomologacion, "productoId" | "codigoInterno">, input: HomologacionProductoInput): Promise<void> {
  const { error } = await supabase.from("siat_producto_homologaciones").upsert({ producto_id: producto.productoId, codigo_interno_snapshot: producto.codigoInterno, codigo_producto_sin: input.codigoProductoSin, actividad_economica: input.actividadEconomica, unidad_medida_sin: input.unidadMedidaSin, origen: input.origen, version_catalogo: input.versionCatalogo.trim() || null, version_normativa: "SIAT_VIGENTE", estado: "HOMOLOGADO", fecha_homologacion: new Date().toISOString() }, { onConflict: "producto_id,version_normativa" });
  if (error) throw siatError(error, "No se pudo guardar la homologación del producto.");
}

export async function obtenerOpcionesContingencia(): Promise<ContingenciaOpciones> {
  const [sucursales, tiposEvento, cufdResult] = await Promise.all([
    listarSucursalesSiat(), catalogOptions("EVENTOS_SIGNIFICATIVOS"),
    supabase.from("siat_cufd").select("id,codigo,sucursal_id,punto_venta_id,fecha_expiracion").eq("estado", "VIGENTE").order("fecha_expiracion", { ascending: false }),
  ]);
  if (cufdResult.error) throw siatError(cufdResult.error, "No se pudieron cargar los CUFD vigentes.");
  return { sucursales, tiposEvento, cufd: (cufdResult.data ?? []).map((raw) => { const row = object(raw); return { id: text(row.id), etiqueta: `${text(row.codigo).slice(0, 10)}… · vence ${new Date(text(row.fecha_expiracion)).toLocaleString("es-BO")}`, sucursalId: text(row.sucursal_id), puntoVentaId: row.punto_venta_id ? text(row.punto_venta_id) : null }; }) };
}

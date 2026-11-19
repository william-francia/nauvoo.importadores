/** Controles restrictivos para la futura recuperación; no habilitan 9B. */
export function assertEventReadyForRegistration(event: Record<string, unknown>, now = Date.now()): void {
  const code = String(event.tipo_evento_codigo ?? "");
  const start = Date.parse(String(event.fecha_inicio ?? "")); const end = Date.parse(String(event.fecha_fin ?? ""));
  const evidence = event.evidencia_deteccion;
  if (!/^[1-7]$/.test(code) || !String(event.descripcion ?? "").trim()) throw new Error("EVENTO_TIPO_O_DESCRIPCION_INVALIDOS");
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(now) || end < start || end > now) throw new Error("EVENTO_FECHAS_INVALIDAS");
  if (now > end + 48 * 60 * 60 * 1000) throw new Error("EVENTO_PLAZO_REGISTRO_VENCIDO");
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence) || Object.keys(evidence).length === 0) throw new Error("EVENTO_EVIDENCIA_REQUERIDA");
}

export function assertRecoveryCufd(event: Record<string, unknown>, current: Record<string, unknown>): void {
  const recovered = Date.parse(String(event.fecha_fin ?? "")); const start = Date.parse(String(current.fecha_inicio ?? ""));
  if (!event.cufd_id || !current.id || event.cufd_id === current.id || !Number.isFinite(recovered) || !Number.isFinite(start) || start < recovered) throw new Error("CUFD_NUEVO_RECUPERACION_REQUERIDO");
}

export function assertCompletePackageLinks(count: unknown, links: Array<{ posicion: number; factura: Record<string, unknown> }>): void {
  const expected = Number(count);
  if (!Number.isInteger(expected) || expected < 1 || expected > 500 || links.length !== expected) throw new Error("PAQUETE_COBERTURA_INCOMPLETA");
  const ids = new Set<string>(); const positions = new Set<number>();
  for (const link of links) {
    const id = String(link.factura?.id ?? "");
    if (!id || ids.has(id) || !Number.isInteger(link.posicion) || link.posicion < 1 || link.posicion > expected || positions.has(link.posicion)
      || !["EMPAQUETADA", "VALIDADA"].includes(String(link.factura.estado_fiscal))) throw new Error("PAQUETE_COBERTURA_INCONSISTENTE");
    ids.add(id); positions.add(link.posicion);
  }
}

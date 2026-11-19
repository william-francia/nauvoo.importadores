-- Preparación local del Paso 9. El gateway conserva el bloqueo de transmisión.
-- La declaración sobre DDJJ es del administrador; no representa una consulta al SIN.
REVOKE ALL ON FUNCTION public.siat_solicitar_operacion_factura(uuid, text, uuid, integer) FROM service_role;

CREATE OR REPLACE FUNCTION public.siat_solicitar_operacion_factura_confirmada(
  p_factura_id uuid, p_operacion text, p_actor_auth_user_id uuid,
  p_motivo_codigo integer, p_confirmacion boolean, p_no_utilizada_ddjj boolean,
  p_idempotencia uuid, p_sucursal_operacion uuid DEFAULT NULL, p_punto_venta_operacion uuid DEFAULT NULL
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_factura public.facturas_siat%ROWTYPE;
  v_existente public.siat_outbox%ROWTYPE;
  v_tarea text;
  v_estado text;
  v_clave text;
  v_limite timestamptz;
  v_sucursal uuid;
  v_punto uuid;
BEGIN
  IF p_factura_id IN ('c2279bbb-e851-468b-afe6-8ebf0b436d28'::uuid, '08dd889e-f2f7-4acb-be2e-2f911aae9919'::uuid) THEN
    RAISE EXCEPTION 'Las facturas piloto anteriores están protegidas para esta etapa.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE auth_user_id = p_actor_auth_user_id AND activo AND rol = 'administrador') THEN
    RAISE EXCEPTION 'Operación reservada a un administrador activo.';
  END IF;
  IF p_confirmacion IS DISTINCT FROM true OR p_idempotencia IS NULL THEN
    RAISE EXCEPTION 'Se requiere confirmación expresa e identificador idempotente.';
  END IF;
  SELECT * INTO v_factura FROM public.facturas_siat WHERE id = p_factura_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Factura fiscal no encontrada.'; END IF;
  IF v_factura.ambiente <> 'PRUEBAS' OR v_factura.origen_fiscal IS DISTINCT FROM 'PILOTO' OR NOT EXISTS (SELECT 1 FROM public.siat_configuracion WHERE id = true AND ambiente = 'PRUEBAS') THEN
    RAISE EXCEPTION 'Operación disponible únicamente en PILOTO.';
  END IF;
  IF p_sucursal_operacion IS NULL AND p_punto_venta_operacion IS NOT NULL THEN RAISE EXCEPTION 'Seleccione la sucursal del punto de venta.'; END IF;
  v_sucursal := COALESCE(p_sucursal_operacion, v_factura.sucursal_id);
  v_punto := CASE WHEN p_sucursal_operacion IS NULL THEN v_factura.punto_venta_id ELSE p_punto_venta_operacion END;
  IF NOT EXISTS (SELECT 1 FROM public.siat_sucursales s WHERE s.id = v_sucursal AND s.activo) THEN RAISE EXCEPTION 'Sucursal de operación no habilitada.'; END IF;
  IF v_punto IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.siat_puntos_venta p WHERE p.id = v_punto AND p.sucursal_id = v_sucursal AND p.activo) THEN RAISE EXCEPTION 'Punto de venta de operación no habilitado.'; END IF;
  v_clave := 'paso9:' || p_idempotencia::text;
  SELECT * INTO v_existente FROM public.siat_outbox WHERE idempotency_key = v_clave;
  IF FOUND THEN
    IF v_existente.factura_id IS DISTINCT FROM p_factura_id OR v_existente.payload->>'actor' IS DISTINCT FROM p_actor_auth_user_id::text
      OR v_existente.payload->>'operacion' IS DISTINCT FROM p_operacion
      OR v_existente.payload->>'motivo' IS DISTINCT FROM p_motivo_codigo::text
      OR v_existente.payload->>'sucursalOperacionId' IS DISTINCT FROM v_sucursal::text
      OR v_existente.payload->>'puntoVentaOperacionId' IS DISTINCT FROM v_punto::text THEN
      RAISE EXCEPTION 'Identificador idempotente utilizado para otra solicitud.';
    END IF;
    RETURN v_factura.estado_fiscal;
  END IF;
  IF v_factura.fecha_emision IS NULL OR v_factura.fecha_emision > now() THEN RAISE EXCEPTION 'Fecha de emisión inválida.'; END IF;
  -- Hasta el final del día nueve del mes siguiente, hora de Bolivia.
  v_limite := (date_trunc('month', v_factura.fecha_emision AT TIME ZONE 'America/La_Paz') + interval '1 month 9 days') AT TIME ZONE 'America/La_Paz';
  IF now() >= v_limite THEN RAISE EXCEPTION 'Plazo fiscal vencido.'; END IF;
  IF v_factura.fecha_reversion IS NOT NULL THEN RAISE EXCEPTION 'Una factura revertida no admite otra anulación o reversión.'; END IF;
  IF p_operacion = 'ANULAR' THEN
    IF v_factura.estado_fiscal <> 'VALIDADA' THEN RAISE EXCEPTION 'Solo se puede solicitar la anulación de una factura validada.'; END IF;
    IF v_factura.codigo_estado IS DISTINCT FROM 908 OR v_factura.transaccion IS DISTINCT FROM true OR NULLIF(trim(v_factura.codigo_recepcion), '') IS NULL THEN
      RAISE EXCEPTION 'Falta evidencia persistida de validación oficial 908 y recepción.';
    END IF;
    IF p_no_utilizada_ddjj IS DISTINCT FROM true THEN RAISE EXCEPTION 'Falta la declaración administrativa de que no fue utilizada en una DDJJ.'; END IF;
    IF p_motivo_codigo IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.siat_catalogos c JOIN public.siat_catalogo_items i ON i.catalogo_id = c.id
      WHERE c.codigo = 'MOTIVOS_ANULACION' AND c.estado = 'VIGENTE' AND i.codigo = p_motivo_codigo::text AND i.activo = true
    ) THEN RAISE EXCEPTION 'Motivo no incluido en el catálogo SIAT vigente.'; END IF;
    v_estado := 'ANULACION_PENDIENTE'; v_tarea := 'ANULAR_FACTURA';
    UPDATE public.facturas_siat SET estado_fiscal = v_estado, motivo_anulacion_codigo = p_motivo_codigo, fecha_solicitud_anulacion = now() WHERE id = p_factura_id;
  ELSIF p_operacion = 'REVERTIR_ANULACION' THEN
    IF v_factura.estado_fiscal <> 'ANULADA' THEN RAISE EXCEPTION 'Solo una factura anulada puede solicitar reversión.'; END IF;
    IF p_motivo_codigo IS NOT NULL THEN RAISE EXCEPTION 'La reversión no admite motivo de anulación.'; END IF;
    v_estado := 'REVERSION_PENDIENTE'; v_tarea := 'REVERTIR_ANULACION';
    UPDATE public.facturas_siat SET estado_fiscal = v_estado WHERE id = p_factura_id;
  ELSE RAISE EXCEPTION 'Operación fiscal no permitida.'; END IF;
  INSERT INTO public.siat_outbox (factura_id, tipo_tarea, payload, estado, idempotency_key)
    VALUES (p_factura_id, v_tarea, jsonb_build_object('facturaId', p_factura_id, 'motivo', p_motivo_codigo, 'actor', p_actor_auth_user_id, 'operacion', p_operacion, 'confirmacionExpresa', true, 'declaracionNoUtilizadaDDJJ', p_no_utilizada_ddjj, 'sucursalOperacionId', v_sucursal, 'puntoVentaOperacionId', v_punto), 'PENDIENTE', v_clave);
  INSERT INTO public.siat_auditoria (actor_auth_user_id, entidad, entidad_id, accion, estado_anterior, estado_nuevo, contexto)
    VALUES (p_actor_auth_user_id, 'facturas_siat', p_factura_id::text, 'SOLICITUD_' || p_operacion,
      jsonb_build_object('estado', v_factura.estado_fiscal), jsonb_build_object('estado', v_estado),
      jsonb_build_object('motivo', p_motivo_codigo, 'confirmacionExpresa', true, 'declaracionNoUtilizadaDDJJ', CASE WHEN p_operacion = 'ANULAR' THEN p_no_utilizada_ddjj ELSE NULL END, 'ambiente', 'PRUEBAS', 'sucursalOperacionId', v_sucursal, 'puntoVentaOperacionId', v_punto, 'notificacionComprador', 'PENDIENTE'));
  RETURN v_estado;
END;
$$;
REVOKE ALL ON FUNCTION public.siat_solicitar_operacion_factura_confirmada(uuid, text, uuid, integer, boolean, boolean, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siat_solicitar_operacion_factura_confirmada(uuid, text, uuid, integer, boolean, boolean, uuid, uuid, uuid) TO service_role;

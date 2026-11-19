-- Preparación 9A: solo referencias protegidas; no envía mensajes ni habilita emisión.
CREATE TABLE public.siat_9a_notificaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id uuid NOT NULL REFERENCES public.facturas_siat(id) ON DELETE RESTRICT,
  operacion text NOT NULL CHECK (operacion IN ('ANULACION', 'REVERSION')),
  canal text NOT NULL CHECK (canal IN ('CORREO', 'WHATSAPP')),
  destinatario_hmac text NOT NULL CHECK (destinatario_hmac ~ '^[A-F0-9]{64}$'),
  destinatario_mascara text NOT NULL CHECK (length(destinatario_mascara) BETWEEN 4 AND 40 AND position('*' in destinatario_mascara) > 0),
  estado text NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'ENVIADA', 'ENTREGA_CONFIRMADA')),
  evidencia_tipo text, evidencia_hash text, registrado_por uuid NOT NULL,
  preparado_at timestamptz NOT NULL DEFAULT now(), enviado_at timestamptz, enviado_por uuid,
  confirmado_at timestamptz, confirmado_por uuid, evidencia_entrega_hash text, envio_intentado_at timestamptz, intento_id uuid, intento_por uuid,
  UNIQUE (factura_id, operacion)
);
ALTER TABLE public.siat_9a_notificaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.siat_9a_notificaciones FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.siat_9a_notificaciones FROM service_role;
GRANT SELECT ON public.siat_9a_notificaciones TO service_role;

-- Se habilita la consulta de destinatarios solo después de crear su tabla.
-- El parámetro sigue siendo falso por defecto y 9B y reversión permanecen bloqueados.
CREATE OR REPLACE FUNCTION public.siat_reclamar_outbox_9a(p_worker_id text, p_lock_segundos integer DEFAULT 90, p_habilitar_anulacion boolean DEFAULT false)
RETURNS SETOF public.siat_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF COALESCE(trim(p_worker_id), '') = '' OR p_lock_segundos NOT BETWEEN 15 AND 600 THEN
    RAISE EXCEPTION 'Parámetros de worker inválidos.';
  END IF;
  SELECT id INTO v_id FROM public.siat_outbox
  WHERE estado IN ('PENDIENTE', 'REINTENTAR') AND disponible_desde <= now()
    AND (locked_until IS NULL OR locked_until < now())
    AND tipo_tarea NOT IN ('REVERTIR_ANULACION', 'CONCILIAR_REVERSION')
    AND (tipo_tarea NOT IN ('ANULAR_FACTURA', 'CONCILIAR_ANULACION') OR (
      p_habilitar_anulacion IS TRUE AND factura_id NOT IN ('c2279bbb-e851-468b-afe6-8ebf0b436d28'::uuid, '08dd889e-f2f7-4acb-be2e-2f911aae9919'::uuid)
      AND EXISTS (SELECT 1 FROM public.siat_9a_notificaciones n WHERE n.factura_id=siat_outbox.factura_id AND n.operacion='ANULACION' AND n.estado='PENDIENTE')
      AND ((tipo_tarea='ANULAR_FACTURA' AND payload->>'confirmacionExpresa'='true' AND payload->>'declaracionNoUtilizadaDDJJ'='true')
        OR (tipo_tarea='CONCILIAR_ANULACION' AND EXISTS (SELECT 1 FROM public.siat_outbox previo WHERE previo.factura_id=siat_outbox.factura_id AND previo.tipo_tarea='ANULAR_FACTURA' AND previo.payload->>'confirmacionExpresa'='true' AND previo.payload->>'transmisionFiscalIniciadaAt' IS NOT NULL)))
    ))
    AND tipo_tarea NOT IN ('REGISTRAR_EVENTO', 'CONCILIAR_EVENTO', 'GENERAR_PAQUETES_EVENTO', 'ENVIAR_PAQUETE', 'VALIDAR_PAQUETE', 'CONCILIAR_FACTURA_PAQUETE')
  ORDER BY disponible_desde, created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_id IS NULL THEN RETURN; END IF;
  RETURN QUERY UPDATE public.siat_outbox
    SET estado = 'PROCESANDO', locked_by = p_worker_id,
        locked_until = now() + make_interval(secs => p_lock_segundos), intentos = intentos + 1
    WHERE id = v_id RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION public.siat_reclamar_outbox_9a(text, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siat_reclamar_outbox_9a(text, integer, boolean) TO service_role;

CREATE TABLE public.siat_9a_revisiones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), factura_id uuid NOT NULL REFERENCES public.facturas_siat(id) ON DELETE RESTRICT,
  operacion text NOT NULL CHECK (operacion IN ('ANULACION', 'REVERSION')),
  evidencia_tipo text NOT NULL CHECK (evidencia_tipo IN ('RESPUESTA_ORIGINAL', 'CONSULTA_SIN', 'OTRA')),
  evidencia_hash text NOT NULL CHECK (evidencia_hash ~ '^[A-F0-9]{64}$'),
  dictamen text NOT NULL CHECK (dictamen IN ('NO_CONCLUYENTE', 'EVIDENCIA_PARA_REVISION')),
  actor_auth_user_id uuid NOT NULL, creado_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.siat_9a_revisiones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.siat_9a_revisiones FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.siat_9a_revisiones FROM service_role;

CREATE OR REPLACE FUNCTION public.siat_9a_guardar_notificacion(
  p_factura uuid, p_actor uuid, p_operacion text, p_canal text, p_destino_hmac text, p_destino_mascara text,
  p_accion text, p_confirmacion boolean, p_evidencia_hash text DEFAULT NULL, p_fecha_envio timestamptz DEFAULT NULL
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_factura public.facturas_siat%ROWTYPE; v_notif public.siat_9a_notificaciones%ROWTYPE; v_estado text;
BEGIN
  IF p_factura IN ('c2279bbb-e851-468b-afe6-8ebf0b436d28'::uuid, '08dd889e-f2f7-4acb-be2e-2f911aae9919'::uuid) THEN RAISE EXCEPTION 'Factura piloto anterior protegida.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE auth_user_id=p_actor AND activo AND rol='administrador') OR p_confirmacion IS DISTINCT FROM true THEN RAISE EXCEPTION 'Confirmación de administrador requerida.'; END IF;
  IF p_operacion NOT IN ('ANULACION','REVERSION') OR p_canal NOT IN ('CORREO','WHATSAPP') OR p_destino_hmac !~ '^[A-F0-9]{64}$' OR p_destino_hmac IS NULL THEN RAISE EXCEPTION 'Datos de notificación inválidos.'; END IF;
  SELECT * INTO v_factura FROM public.facturas_siat WHERE id=p_factura FOR UPDATE;
  IF NOT FOUND OR v_factura.ambiente <> 'PRUEBAS' OR v_factura.origen_fiscal IS DISTINCT FROM 'PILOTO' OR NOT EXISTS (SELECT 1 FROM public.siat_configuracion WHERE id=true AND ambiente='PRUEBAS') THEN RAISE EXCEPTION 'Factura piloto no disponible.'; END IF;
  SELECT * INTO v_notif FROM public.siat_9a_notificaciones WHERE factura_id=p_factura AND operacion=p_operacion FOR UPDATE;
  IF p_accion = 'PREPARAR' THEN
    IF (p_operacion='ANULACION' AND v_factura.estado_fiscal NOT IN ('VALIDADA','ANULADA','REVERTIDA')) OR (p_operacion='REVERSION' AND v_factura.estado_fiscal <> 'ANULADA') THEN RAISE EXCEPTION 'No se puede preparar el destinatario en este estado.'; END IF;
    IF v_notif.id IS NOT NULL AND (v_notif.estado <> 'PENDIENTE' OR v_notif.envio_intentado_at IS NOT NULL) THEN RAISE EXCEPTION 'Notificación ya registrada o con envío incierto.'; END IF;
    INSERT INTO public.siat_9a_notificaciones (factura_id, operacion, canal, destinatario_hmac, destinatario_mascara, registrado_por)
      VALUES (p_factura,p_operacion,p_canal,p_destino_hmac,p_destino_mascara,p_actor)
      ON CONFLICT (factura_id,operacion) DO UPDATE SET canal=excluded.canal, destinatario_hmac=excluded.destinatario_hmac, destinatario_mascara=excluded.destinatario_mascara, registrado_por=p_actor, preparado_at=now();
    v_estado := 'PENDIENTE';
  ELSIF p_accion = 'REGISTRAR_ENVIO_MANUAL' THEN
    IF (p_operacion='ANULACION' AND v_factura.estado_fiscal NOT IN ('ANULADA','REVERTIDA')) OR (p_operacion='REVERSION' AND v_factura.estado_fiscal <> 'REVERTIDA') THEN RAISE EXCEPTION 'El SIN aún no confirmó la operación.'; END IF;
    IF v_notif.id IS NULL OR v_notif.canal <> p_canal OR v_notif.destinatario_hmac <> p_destino_hmac OR p_evidencia_hash IS NULL OR p_evidencia_hash !~ '^[A-F0-9]{64}$' OR p_fecha_envio IS NULL OR p_fecha_envio > now() THEN RAISE EXCEPTION 'Destinatario, fecha o evidencia no coinciden.'; END IF;
    IF v_notif.envio_intentado_at IS NOT NULL AND v_notif.estado = 'PENDIENTE' THEN RAISE EXCEPTION 'Envío automático incierto: requiere revisión antes de registrar otro envío.'; END IF;
    IF v_notif.estado = 'ENVIADA' AND v_notif.evidencia_hash = p_evidencia_hash AND v_notif.enviado_at = p_fecha_envio THEN RETURN 'ENVIADA'; END IF;
    IF v_notif.estado <> 'PENDIENTE' THEN RAISE EXCEPTION 'La notificación ya fue registrada.'; END IF;
    UPDATE public.siat_9a_notificaciones SET estado='ENVIADA', evidencia_tipo='COMPROBANTE_MANUAL_DECLARADO', evidencia_hash=p_evidencia_hash, enviado_at=p_fecha_envio, enviado_por=p_actor WHERE id=v_notif.id;
    v_estado := 'ENVIADA';
  ELSIF p_accion = 'CONFIRMAR_ENTREGA_MANUAL' THEN
    IF (p_operacion='ANULACION' AND v_factura.estado_fiscal NOT IN ('ANULADA','REVERTIDA')) OR (p_operacion='REVERSION' AND v_factura.estado_fiscal <> 'REVERTIDA') THEN RAISE EXCEPTION 'El SIN aún no confirmó la operación.'; END IF;
    IF v_notif.id IS NULL OR v_notif.canal <> p_canal OR v_notif.destinatario_hmac IS DISTINCT FROM p_destino_hmac OR p_evidencia_hash IS NULL OR p_evidencia_hash !~ '^[A-F0-9]{64}$' OR p_fecha_envio IS NULL OR p_fecha_envio > now() OR p_fecha_envio < v_notif.enviado_at THEN RAISE EXCEPTION 'Destinatario, fecha o evidencia de entrega inválidos.'; END IF;
    IF v_notif.estado = 'ENTREGA_CONFIRMADA' AND v_notif.evidencia_entrega_hash = p_evidencia_hash AND v_notif.confirmado_at = p_fecha_envio THEN RETURN 'ENTREGA_CONFIRMADA'; END IF;
    IF v_notif.estado <> 'ENVIADA' OR v_notif.enviado_at IS NULL THEN RAISE EXCEPTION 'El envío debe estar registrado antes de confirmar la entrega.'; END IF;
    UPDATE public.siat_9a_notificaciones SET estado='ENTREGA_CONFIRMADA', evidencia_entrega_hash=p_evidencia_hash, confirmado_at=p_fecha_envio, confirmado_por=p_actor WHERE id=v_notif.id;
    v_estado := 'ENTREGA_CONFIRMADA';
  ELSE RAISE EXCEPTION 'Acción de notificación no admitida.'; END IF;
  INSERT INTO public.siat_auditoria (actor_auth_user_id,entidad,entidad_id,accion,estado_nuevo,contexto)
    VALUES (p_actor,'facturas_siat',p_factura::text,'NOTIFICACION_'||p_accion,jsonb_build_object('estado',v_estado),jsonb_build_object('operacion',p_operacion,'canal',p_canal,'destinatario',p_destino_mascara,'evidenciaHash',p_evidencia_hash,'declaracionAdministrativa',true));
  RETURN v_estado;
END;
$$;
REVOKE ALL ON FUNCTION public.siat_9a_guardar_notificacion(uuid,uuid,text,text,text,text,text,boolean,text,timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siat_9a_guardar_notificacion(uuid,uuid,text,text,text,text,text,boolean,text,timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.siat_9a_validar_destino() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE op text;
BEGIN
  IF NEW.estado_fiscal IS NOT DISTINCT FROM OLD.estado_fiscal THEN RETURN NEW; END IF;
  op := CASE NEW.estado_fiscal WHEN 'ANULACION_PENDIENTE' THEN 'ANULACION' WHEN 'REVERSION_PENDIENTE' THEN 'REVERSION' ELSE NULL END;
  IF op IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.siat_9a_notificaciones WHERE factura_id=NEW.id AND operacion=op AND estado='PENDIENTE') THEN
    RAISE EXCEPTION 'Falta destinatario privado declarado para la notificación.';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_siat_9a_validar_destino BEFORE UPDATE OF estado_fiscal ON public.facturas_siat FOR EACH ROW EXECUTE FUNCTION public.siat_9a_validar_destino();

CREATE OR REPLACE FUNCTION public.siat_9a_guardar_revision(p_factura uuid, p_actor uuid, p_tipo text, p_hash text, p_dictamen text, p_confirmacion boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_factura public.facturas_siat%ROWTYPE; v_op text; v_id uuid;
BEGIN
  IF p_factura IN ('c2279bbb-e851-468b-afe6-8ebf0b436d28'::uuid, '08dd889e-f2f7-4acb-be2e-2f911aae9919'::uuid) THEN RAISE EXCEPTION 'Factura piloto anterior protegida.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE auth_user_id=p_actor AND activo AND rol='administrador') OR p_confirmacion IS DISTINCT FROM true THEN RAISE EXCEPTION 'Confirmación de administrador requerida.'; END IF;
  IF p_tipo NOT IN ('RESPUESTA_ORIGINAL','CONSULTA_SIN','OTRA') OR p_hash IS NULL OR p_hash !~ '^[A-F0-9]{64}$' OR p_dictamen NOT IN ('NO_CONCLUYENTE','EVIDENCIA_PARA_REVISION') THEN RAISE EXCEPTION 'Evidencia o dictamen inválidos.'; END IF;
  SELECT * INTO v_factura FROM public.facturas_siat WHERE id=p_factura FOR UPDATE;
  IF NOT FOUND OR v_factura.ambiente <> 'PRUEBAS' OR v_factura.origen_fiscal IS DISTINCT FROM 'PILOTO' OR NOT EXISTS (SELECT 1 FROM public.siat_configuracion WHERE id=true AND ambiente='PRUEBAS') THEN RAISE EXCEPTION 'Factura piloto no disponible.'; END IF;
  v_op := CASE v_factura.estado_fiscal WHEN 'ANULACION_PENDIENTE' THEN 'ANULACION' WHEN 'REVERSION_PENDIENTE' THEN 'REVERSION' ELSE NULL END;
  IF v_op IS NULL THEN RAISE EXCEPTION 'No hay operación incierta para revisión.'; END IF;
  INSERT INTO public.siat_9a_revisiones (factura_id,operacion,evidencia_tipo,evidencia_hash,dictamen,actor_auth_user_id)
    VALUES (p_factura,v_op,p_tipo,p_hash,p_dictamen,p_actor) RETURNING id INTO v_id;
  INSERT INTO public.siat_auditoria (actor_auth_user_id,entidad,entidad_id,accion,estado_anterior,estado_nuevo,contexto)
    VALUES (p_actor,'facturas_siat',p_factura::text,'REVISION_ADMINISTRATIVA_SIN_CAMBIO',jsonb_build_object('estado',v_factura.estado_fiscal),jsonb_build_object('estado',v_factura.estado_fiscal),jsonb_build_object('operacion',v_op,'evidenciaTipo',p_tipo,'evidenciaHash',p_hash,'dictamen',p_dictamen));
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.siat_9a_guardar_revision(uuid,uuid,text,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siat_9a_guardar_revision(uuid,uuid,text,text,text,boolean) TO service_role;

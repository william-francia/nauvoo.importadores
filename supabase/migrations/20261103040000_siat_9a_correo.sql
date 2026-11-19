-- Reserva durable previa al proveedor: no se reintenta automáticamente tras timeout.
CREATE OR REPLACE FUNCTION public.siat_9a_reservar_correo(p_factura uuid,p_actor uuid,p_operacion text,p_destino_hmac text,p_confirmacion boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE f public.facturas_siat%ROWTYPE; n public.siat_9a_notificaciones%ROWTYPE; intento uuid:=gen_random_uuid();
BEGIN
  IF p_factura IN ('c2279bbb-e851-468b-afe6-8ebf0b436d28'::uuid,'08dd889e-f2f7-4acb-be2e-2f911aae9919'::uuid) THEN RAISE EXCEPTION 'Factura piloto anterior protegida.'; END IF;
  IF p_confirmacion IS DISTINCT FROM true OR NOT EXISTS (SELECT 1 FROM public.usuarios WHERE auth_user_id=p_actor AND activo AND rol='administrador') THEN RAISE EXCEPTION 'Confirmación de administrador requerida.'; END IF;
  SELECT * INTO f FROM public.facturas_siat WHERE id=p_factura FOR UPDATE;
  IF NOT FOUND OR f.ambiente <> 'PRUEBAS' OR f.origen_fiscal IS DISTINCT FROM 'PILOTO' OR NOT EXISTS (SELECT 1 FROM public.siat_configuracion WHERE id=true AND ambiente='PRUEBAS') THEN RAISE EXCEPTION 'Factura piloto no disponible.'; END IF;
  IF (p_operacion='ANULACION' AND f.estado_fiscal NOT IN ('ANULADA','REVERTIDA')) OR (p_operacion='REVERSION' AND f.estado_fiscal <> 'REVERTIDA') OR p_operacion NOT IN ('ANULACION','REVERSION') THEN RAISE EXCEPTION 'Operación fiscal no confirmada.'; END IF;
  SELECT * INTO n FROM public.siat_9a_notificaciones WHERE factura_id=p_factura AND operacion=p_operacion FOR UPDATE;
  IF n.id IS NULL OR n.canal <> 'CORREO' OR n.destinatario_hmac IS DISTINCT FROM p_destino_hmac OR n.estado <> 'PENDIENTE' OR n.envio_intentado_at IS NOT NULL THEN RAISE EXCEPTION 'Correo ya intentado o destinatario no coincide; revise el estado.'; END IF;
  UPDATE public.siat_9a_notificaciones SET intento_id=intento, intento_por=p_actor, envio_intentado_at=now() WHERE id=n.id;
  INSERT INTO public.siat_auditoria(actor_auth_user_id,entidad,entidad_id,accion,contexto) VALUES(p_actor,'facturas_siat',p_factura::text,'CORREO_RESERVADO',jsonb_build_object('operacion',p_operacion,'destinatario',n.destinatario_mascara));
  RETURN intento;
END;
$$;
REVOKE ALL ON FUNCTION public.siat_9a_reservar_correo(uuid,uuid,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siat_9a_reservar_correo(uuid,uuid,text,text,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.siat_9a_confirmar_correo_proveedor(p_intento uuid,p_actor uuid,p_evidencia_hash text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n public.siat_9a_notificaciones%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE auth_user_id=p_actor AND activo AND rol='administrador') OR p_evidencia_hash IS NULL OR p_evidencia_hash !~ '^[A-F0-9]{64}$' THEN RAISE EXCEPTION 'Administrador o evidencia inválidos.'; END IF;
  SELECT * INTO n FROM public.siat_9a_notificaciones WHERE intento_id=p_intento FOR UPDATE;
  IF n.id IS NULL OR n.intento_por IS DISTINCT FROM p_actor OR n.estado <> 'PENDIENTE' OR n.canal <> 'CORREO' THEN RAISE EXCEPTION 'Intento no disponible para confirmación.'; END IF;
  UPDATE public.siat_9a_notificaciones SET estado='ENVIADA', evidencia_tipo='PROVEEDOR_ACEPTO', evidencia_hash=p_evidencia_hash, enviado_at=now(), enviado_por=p_actor WHERE id=n.id;
  INSERT INTO public.siat_auditoria(actor_auth_user_id,entidad,entidad_id,accion,estado_nuevo,contexto) VALUES(p_actor,'facturas_siat',n.factura_id::text,'CORREO_ACEPTADO_PROVEEDOR',jsonb_build_object('estado','ENVIADA'),jsonb_build_object('operacion',n.operacion,'evidenciaHash',p_evidencia_hash,'entregaConfirmada',false));
  RETURN 'ENVIADA';
END;
$$;
REVOKE ALL ON FUNCTION public.siat_9a_confirmar_correo_proveedor(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siat_9a_confirmar_correo_proveedor(uuid,uuid,text) TO service_role;

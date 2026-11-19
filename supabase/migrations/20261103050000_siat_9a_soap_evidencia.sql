-- Respuestas exclusivamente cifradas en el runtime; jamás recibe la clave.
CREATE TABLE public.siat_9a_soap_evidencias (
  intento_id uuid PRIMARY KEY REFERENCES public.siat_outbox(id) ON DELETE RESTRICT,
  factura_id uuid NOT NULL REFERENCES public.facturas_siat(id) ON DELETE RESTRICT,
  operacion text NOT NULL CHECK (operacion IN ('ANULACION','REVERSION')),
  clave_id text NOT NULL CHECK (clave_id ~ '^[A-F0-9]{16}$'),
  estado text NOT NULL DEFAULT 'RESERVADA' CHECK (estado IN ('RESERVADA','RECIBIDA','TIMEOUT','SIN_RESPUESTA','BLOQUEADO_SENSIBLE')),
  http_estado integer CHECK (http_estado BETWEEN 100 AND 599),
  nonce text, cifrado text, sha256 text,
  creado_at timestamptz NOT NULL DEFAULT now(), finalizado_at timestamptz,
  CHECK ((estado='RECIBIDA' AND nonce IS NOT NULL AND cifrado IS NOT NULL AND sha256 IS NOT NULL AND sha256 ~ '^[A-F0-9]{64}$' AND http_estado IS NOT NULL)
    OR (estado<>'RECIBIDA' AND nonce IS NULL AND cifrado IS NULL AND sha256 IS NULL))
);
ALTER TABLE public.siat_9a_soap_evidencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.siat_9a_soap_evidencias FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.siat_9a_reservar_soap(p_factura uuid,p_operacion text,p_intento uuid,p_clave_id text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e public.siat_9a_soap_evidencias%ROWTYPE;
BEGIN
  IF p_factura IN ('c2279bbb-e851-468b-afe6-8ebf0b436d28'::uuid,'08dd889e-f2f7-4acb-be2e-2f911aae9919'::uuid) OR p_operacion NOT IN ('ANULACION','REVERSION') OR p_clave_id !~ '^[A-F0-9]{16}$' OR NOT EXISTS (
    SELECT 1 FROM public.siat_outbox o JOIN public.facturas_siat f ON f.id=o.factura_id
    WHERE o.id=p_intento AND o.factura_id=p_factura AND o.estado='PROCESANDO' AND f.ambiente='PRUEBAS' AND f.origen_fiscal='PILOTO'
      AND o.tipo_tarea=CASE p_operacion WHEN 'ANULACION' THEN 'ANULAR_FACTURA' ELSE 'REVERTIR_ANULACION' END
  ) THEN RAISE EXCEPTION 'Intento fiscal no autorizado.'; END IF;
  INSERT INTO public.siat_9a_soap_evidencias(intento_id,factura_id,operacion,clave_id) VALUES(p_intento,p_factura,p_operacion,p_clave_id) ON CONFLICT DO NOTHING;
  SELECT * INTO e FROM public.siat_9a_soap_evidencias WHERE intento_id=p_intento FOR UPDATE;
  IF e.factura_id<>p_factura OR e.operacion<>p_operacion OR e.clave_id<>p_clave_id THEN RAISE EXCEPTION 'Intento de evidencia no disponible.'; END IF;
END; $$;

CREATE FUNCTION public.siat_9a_guardar_soap(p_intento uuid,p_estado text,p_http integer,p_nonce text,p_cifrado text,p_sha256 text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e public.siat_9a_soap_evidencias%ROWTYPE;
BEGIN
  SELECT * INTO e FROM public.siat_9a_soap_evidencias WHERE intento_id=p_intento FOR UPDATE;
  IF NOT FOUND OR p_estado NOT IN ('RECIBIDA','TIMEOUT','SIN_RESPUESTA','BLOQUEADO_SENSIBLE') THEN RAISE EXCEPTION 'Evidencia no autorizada.'; END IF;
  IF e.estado<>'RESERVADA' THEN
    IF e.estado=p_estado AND e.http_estado IS NOT DISTINCT FROM p_http AND e.sha256 IS NOT DISTINCT FROM p_sha256 THEN RETURN; END IF;
    RAISE EXCEPTION 'La evidencia ya fue registrada.';
  END IF;
  UPDATE public.siat_9a_soap_evidencias SET estado=p_estado,http_estado=p_http,nonce=p_nonce,cifrado=p_cifrado,sha256=p_sha256,finalizado_at=now() WHERE intento_id=p_intento;
  INSERT INTO public.siat_auditoria(entidad,entidad_id,accion,contexto,resultado)
    VALUES('facturas_siat',e.factura_id::text,'EVIDENCIA_SOAP_9A',jsonb_build_object('intento',p_intento,'operacion',e.operacion,'estado',p_estado,'http',p_http,'sha256',p_sha256),CASE WHEN p_estado='RECIBIDA' THEN 'EXITOSO' ELSE 'PENDIENTE' END);
END; $$;
CREATE FUNCTION public.siat_9a_leer_soap(p_intento uuid,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e public.siat_9a_soap_evidencias%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE auth_user_id=p_actor AND activo AND rol='administrador') THEN RAISE EXCEPTION 'Administrador requerido.'; END IF;
  SELECT * INTO e FROM public.siat_9a_soap_evidencias WHERE intento_id=p_intento;
  IF NOT FOUND THEN RAISE EXCEPTION 'Evidencia no disponible.'; END IF;
  INSERT INTO public.siat_auditoria(actor_auth_user_id,entidad,entidad_id,accion,contexto) VALUES(p_actor,'facturas_siat',e.factura_id::text,'LECTURA_EVIDENCIA_SOAP_9A',jsonb_build_object('intento',p_intento,'operacion',e.operacion,'estado',e.estado));
  RETURN to_jsonb(e);
END; $$;
REVOKE ALL ON FUNCTION public.siat_9a_reservar_soap(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.siat_9a_guardar_soap(uuid,text,integer,text,text,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.siat_9a_leer_soap(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.siat_9a_reservar_soap(uuid,text,uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.siat_9a_guardar_soap(uuid,text,integer,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.siat_9a_leer_soap(uuid,uuid) TO service_role;

-- Entrega de documentos: no cambia facturas, ventas, inventario ni la anulación 9A.
CREATE TABLE public.siat_documento_correos (
  id uuid PRIMARY KEY,
  factura_id uuid NOT NULL REFERENCES public.facturas_siat(id),
  actor_auth_user_id uuid NOT NULL REFERENCES auth.users(id),
  destinatario_hmac text NOT NULL CHECK (destinatario_hmac ~ '^[A-F0-9]{64}$'),
  destinatario_mascara text NOT NULL CHECK (length(destinatario_mascara) BETWEEN 3 AND 254),
  estado text NOT NULL DEFAULT 'ENVIANDO' CHECK (estado IN ('ENVIANDO','ENVIADA','INCIERTA')),
  evidencia_hash text CHECK (evidencia_hash IS NULL OR evidencia_hash ~ '^[A-F0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  finalizado_at timestamptz,
  CHECK (estado <> 'ENVIADA' OR evidencia_hash IS NOT NULL)
);
CREATE INDEX siat_documento_correos_factura ON public.siat_documento_correos(factura_id, created_at DESC);
ALTER TABLE public.siat_documento_correos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.siat_documento_correos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.siat_documento_correos TO authenticated;
GRANT ALL ON public.siat_documento_correos TO service_role;
CREATE POLICY siat_documento_correos_admin ON public.siat_documento_correos FOR SELECT TO authenticated
  USING (EXISTS(SELECT 1 FROM public.usuarios WHERE auth_user_id=auth.uid() AND activo AND rol='administrador'));

CREATE FUNCTION public.siat_reservar_correo_documento(p_id uuid,p_factura uuid,p_actor uuid,p_destino_hmac text,p_destino_mascara text,p_confirmacion boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE f public.facturas_siat%ROWTYPE; anterior public.siat_documento_correos%ROWTYPE;
BEGIN
  IF p_confirmacion IS DISTINCT FROM true OR NOT EXISTS(SELECT 1 FROM public.usuarios WHERE auth_user_id=p_actor AND activo AND rol='administrador') THEN RAISE EXCEPTION 'Administrador y confirmación requeridos.'; END IF;
  IF p_destino_hmac IS NULL OR p_destino_hmac !~ '^[A-F0-9]{64}$' THEN RAISE EXCEPTION 'Destinatario inválido.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('siat-documento-correo:'||p_factura::text,0));
  SELECT * INTO f FROM public.facturas_siat WHERE id=p_factura;
  IF NOT FOUND OR f.ambiente IS DISTINCT FROM 'PRUEBAS' OR f.estado_fiscal IS DISTINCT FROM 'VALIDADA'
    OR f.codigo_estado IS DISTINCT FROM 908 OR f.transaccion IS DISTINCT FROM true OR f.codigo_recepcion IS NULL
    OR f.xml_firmado IS DISTINCT FROM true OR f.xml_storage_path IS NULL OR f.xml_hash IS NULL THEN RAISE EXCEPTION 'Documento validado no disponible.'; END IF;
  SELECT * INTO anterior FROM public.siat_documento_correos WHERE id=p_id;
  IF FOUND THEN
    IF anterior.factura_id IS DISTINCT FROM p_factura OR anterior.actor_auth_user_id IS DISTINCT FROM p_actor OR anterior.destinatario_hmac IS DISTINCT FROM p_destino_hmac THEN RAISE EXCEPTION 'Idempotencia no coincide.'; END IF;
    RETURN jsonb_build_object('claimed',false,'estado',anterior.estado);
  END IF;
  IF EXISTS(SELECT 1 FROM public.siat_documento_correos WHERE factura_id=p_factura AND destinatario_hmac=p_destino_hmac
    AND (estado IN ('ENVIANDO','INCIERTA') OR created_at > now()-interval '1 minute')) THEN RAISE EXCEPTION 'Envío previo pendiente, incierto o reciente; no repetir.'; END IF;
  INSERT INTO public.siat_documento_correos(id,factura_id,actor_auth_user_id,destinatario_hmac,destinatario_mascara)
    VALUES(p_id,p_factura,p_actor,p_destino_hmac,p_destino_mascara);
  INSERT INTO public.siat_auditoria(actor_auth_user_id,entidad,entidad_id,accion,contexto)
    VALUES(p_actor,'siat_documento_correos',p_id::text,'ENVIO_DOCUMENTO_RESERVADO',jsonb_build_object('facturaId',p_factura,'destinatario',p_destino_mascara));
  RETURN jsonb_build_object('claimed',true,'estado','ENVIANDO');
END; $$;

CREATE FUNCTION public.siat_finalizar_correo_documento(p_id uuid,p_actor uuid,p_estado text,p_evidencia_hash text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE anterior public.siat_documento_correos%ROWTYPE;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.usuarios WHERE auth_user_id=p_actor AND activo AND rol='administrador')
    OR p_estado IS NULL OR p_estado NOT IN ('ENVIADA','INCIERTA')
    OR (p_estado='ENVIADA' AND (p_evidencia_hash IS NULL OR p_evidencia_hash !~ '^[A-F0-9]{64}$')) THEN RAISE EXCEPTION 'Evidencia o administrador inválido.'; END IF;
  SELECT * INTO anterior FROM public.siat_documento_correos WHERE id=p_id FOR UPDATE;
  IF NOT FOUND OR anterior.actor_auth_user_id IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'Intento no autorizado.'; END IF;
  IF anterior.estado='ENVIADA' THEN RETURN anterior.estado; END IF;
  IF anterior.estado<>'ENVIANDO' THEN RAISE EXCEPTION 'Resultado requiere revisión administrativa.'; END IF;
  UPDATE public.siat_documento_correos SET estado=p_estado,evidencia_hash=p_evidencia_hash,finalizado_at=now() WHERE id=p_id;
  INSERT INTO public.siat_auditoria(actor_auth_user_id,entidad,entidad_id,accion,contexto)
    VALUES(p_actor,'siat_documento_correos',p_id::text,'ENVIO_DOCUMENTO_RESULTADO',jsonb_build_object('estado',p_estado,'entregaConfirmada',false,'evidenciaHash',p_evidencia_hash));
  RETURN p_estado;
END; $$;
REVOKE ALL ON FUNCTION public.siat_reservar_correo_documento(uuid,uuid,uuid,text,text,boolean) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.siat_finalizar_correo_documento(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.siat_reservar_correo_documento(uuid,uuid,uuid,text,text,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.siat_finalizar_correo_documento(uuid,uuid,text,text) TO service_role;

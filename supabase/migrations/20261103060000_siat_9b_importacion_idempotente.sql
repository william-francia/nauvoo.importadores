-- El flujo sigue bloqueado en gateway/worker. Solo prepara la importación segura.
ALTER FUNCTION public.siat_importar_factura_offline(text,jsonb) RENAME TO siat_importar_factura_offline_v1_interna;
REVOKE ALL ON FUNCTION public.siat_importar_factura_offline_v1_interna(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.siat_9b_importacion_huellas (
  idempotency_key text PRIMARY KEY,
  agente_id uuid NOT NULL REFERENCES public.siat_agentes_locales(id) ON DELETE RESTRICT,
  factura_id uuid NOT NULL REFERENCES public.facturas_siat(id) ON DELETE RESTRICT,
  contenido_sha256 text NOT NULL CHECK (contenido_sha256 ~ '^[A-F0-9]{64}$'),
  creado_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.siat_9b_importacion_huellas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.siat_9b_importacion_huellas FROM PUBLIC,anon,authenticated,service_role;

-- Los consumidores anteriores no aportan huellas verificables; fallan de forma explícita.
CREATE FUNCTION public.siat_importar_factura_offline(p_agente_codigo text,p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  RAISE EXCEPTION 'IMPORTACION_OFFLINE_CONTRATO_V1_DESHABILITADO';
END; $$;
REVOKE ALL ON FUNCTION public.siat_importar_factura_offline(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.siat_importar_factura_offline(text,jsonb) TO service_role;

CREATE FUNCTION public.siat_importar_factura_offline_v2(p_agente_codigo text,p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_agente uuid; v_factura uuid; v_clave text:=p_payload->>'idempotencyKey'; v_hash text; v_existente public.siat_9b_importacion_huellas%ROWTYPE;
BEGIN
  IF v_clave IS NULL OR v_clave !~ '^[A-Za-z0-9:_-]{16,160}$' OR jsonb_typeof(p_payload->'adjuntosHash') IS DISTINCT FROM 'object'
    OR COALESCE(p_payload->'adjuntosHash'->>'xml','') !~ '^[A-F0-9]{64}$'
    OR COALESCE(p_payload->'adjuntosHash'->>'pdf','') !~ '^[A-F0-9]{64}$'
    OR (p_payload->'adjuntosHash'->>'evidencia' IS NOT NULL AND p_payload->'adjuntosHash'->>'evidencia' !~ '^[A-F0-9]{64}$')
    OR p_payload->'adjuntosHash'->>'xml' IS DISTINCT FROM upper(p_payload->>'xmlHash') THEN RAISE EXCEPTION 'Huella de importación incompleta.'; END IF;
  IF p_payload->>'facturaId' IN ('c2279bbb-e851-468b-afe6-8ebf0b436d28','08dd889e-f2f7-4acb-be2e-2f911aae9919','8c5c0f1d-efd5-492f-ad26-3013f33cc3fe') THEN RAISE EXCEPTION 'Factura anterior protegida.'; END IF;
  SELECT id INTO v_agente FROM public.siat_agentes_locales WHERE codigo=p_agente_codigo AND estado<>'BLOQUEADO';
  IF v_agente IS NULL THEN RAISE EXCEPTION 'Agente no habilitado.'; END IF;
  -- ventaId era generado de nuevo por el agente en cada intento y no es dato fiscal.
  v_hash:=upper(encode(sha256(convert_to((p_payload-'ventaId')::text,'UTF8')),'hex'));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_clave,0));
  SELECT * INTO v_existente FROM public.siat_9b_importacion_huellas WHERE idempotency_key=v_clave FOR UPDATE;
  IF FOUND THEN
    IF v_existente.agente_id IS DISTINCT FROM v_agente OR v_existente.contenido_sha256 IS DISTINCT FROM v_hash
      OR v_existente.factura_id::text IS DISTINCT FROM p_payload->>'facturaId' THEN RAISE EXCEPTION 'Clave de importación reutilizada con contenido distinto.'; END IF;
    RETURN v_existente.factura_id;
  END IF;
  -- No se puede demostrar el contenido de importaciones antiguas sin huella.
  IF EXISTS (SELECT 1 FROM public.siat_importaciones_offline WHERE idempotency_key=v_clave) THEN RAISE EXCEPTION 'Importación anterior sin huella verificable; requiere revisión.'; END IF;
  v_factura:=public.siat_importar_factura_offline_v1_interna(p_agente_codigo,p_payload);
  IF v_factura IS NULL OR v_factura::text IS DISTINCT FROM p_payload->>'facturaId' THEN RAISE EXCEPTION 'Factura importada no coincide.'; END IF;
  INSERT INTO public.siat_9b_importacion_huellas(idempotency_key,agente_id,factura_id,contenido_sha256) VALUES(v_clave,v_agente,v_factura,v_hash);
  RETURN v_factura;
END; $$;
REVOKE ALL ON FUNCTION public.siat_importar_factura_offline_v2(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.siat_importar_factura_offline_v2(text,jsonb) TO service_role;

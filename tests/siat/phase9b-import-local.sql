-- Ejecutar solo en base sintética aislada; no crea eventos ni conserva cambios.
BEGIN;
DO $$ BEGIN IF current_database() !~ '^nuvoo_9b_import_[a-f0-9]{32}$' OR inet_server_addr() NOT IN ('127.0.0.1'::inet,'::1'::inet) THEN RAISE EXCEPTION 'Solo base sintética local.'; END IF; END $$;
CREATE TABLE public.siat_agentes_locales(id uuid PRIMARY KEY,codigo text,estado text);
CREATE TABLE public.siat_importaciones_offline(idempotency_key text PRIMARY KEY);
CREATE FUNCTION public.siat_importar_factura_offline(p_agente text,p_payload jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE f uuid:=(p_payload->>'facturaId')::uuid;
BEGIN
  INSERT INTO public.facturas_siat(id,ambiente,origen_fiscal,estado_fiscal) VALUES(f,'PRUEBAS','PILOTO','OFFLINE');
  INSERT INTO public.siat_importaciones_offline VALUES(p_payload->>'idempotencyKey');
  RETURN f;
END; $$;
\ir ../../supabase/migrations/20261103060000_siat_9b_importacion_idempotente.sql
DO $$
DECLARE agent uuid:=gen_random_uuid(); f uuid:=gen_random_uuid(); payload jsonb; result uuid; n integer;
BEGIN
  INSERT INTO public.siat_agentes_locales VALUES(agent,'AGENTE_TEST','ACTIVO');
  payload:=jsonb_build_object('idempotencyKey','clave-sintetica-00000001','facturaId',f::text,'ventaId',gen_random_uuid()::text,'xmlHash',repeat('A',64),'adjuntosHash',jsonb_build_object('xml',repeat('A',64),'pdf',repeat('B',64),'evidencia',NULL));
  BEGIN
    PERFORM public.siat_importar_factura_offline('AGENTE_TEST',payload);
    RAISE EXCEPTION 'Aceptó contrato antiguo';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'IMPORTACION_OFFLINE_CONTRATO_V1_DESHABILITADO' THEN RAISE; END IF; END;
  result:=public.siat_importar_factura_offline_v2('AGENTE_TEST',payload);
  IF result<>f OR public.siat_importar_factura_offline_v2('AGENTE_TEST',jsonb_set(payload,'{ventaId}',to_jsonb(gen_random_uuid()::text)))<>f THEN RAISE EXCEPTION 'Reintento idéntico no fue idempotente.'; END IF;
  BEGIN
    PERFORM public.siat_importar_factura_offline_v2('AGENTE_TEST',jsonb_set(payload,'{adjuntosHash,pdf}',to_jsonb(repeat('C',64))));
    RAISE EXCEPTION 'Aceptó contenido distinto';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='Aceptó contenido distinto' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.siat_importar_factura_offline_v2('OTRO_AGENTE',payload);
    RAISE EXCEPTION 'Aceptó agente no autorizado';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='Aceptó agente no autorizado' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.siat_importar_factura_offline_v2('AGENTE_TEST',jsonb_set(payload,'{facturaId}',to_jsonb('08dd889e-f2f7-4acb-be2e-2f911aae9919'::text)));
    RAISE EXCEPTION 'Aceptó factura anterior';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='Aceptó factura anterior' THEN RAISE; END IF; END;
  SELECT count(*) INTO n FROM public.siat_9b_importacion_huellas;
  IF n<>1 OR has_table_privilege('authenticated','public.siat_9b_importacion_huellas','SELECT') OR has_function_privilege('service_role','public.siat_importar_factura_offline_v1_interna(text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Permisos o idempotencia incorrectos.'; END IF;
END $$;
ROLLBACK;

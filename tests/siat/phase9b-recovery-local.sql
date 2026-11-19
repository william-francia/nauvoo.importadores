-- Exclusivamente base sintética local; todo se revierte.
BEGIN;
DO $$ BEGIN IF current_database()<>'paso9_soap_v1' THEN RAISE EXCEPTION 'Solo base sintética local.'; END IF; END $$;
CREATE TABLE public.siat_agentes_locales(id uuid PRIMARY KEY,estado text);
CREATE TABLE public.siat_eventos_significativos(id uuid PRIMARY KEY,agente_local_id uuid,estado text,codigo_recepcion text,respuesta_siat jsonb);
CREATE TABLE public.siat_paquetes(id uuid PRIMARY KEY,evento_id uuid,estado text,codigo_recepcion text,respuesta_siat jsonb,cantidad_facturas integer);
CREATE TABLE public.siat_paquete_facturas(paquete_id uuid,factura_id uuid);
ALTER TABLE public.facturas_siat ADD COLUMN evento_id uuid;
\ir ../../supabase/migrations/20261103070000_siat_9b_estado_recuperacion.sql
DO $$
DECLARE a uuid:=gen_random_uuid(); other_agent uuid:=gen_random_uuid(); e uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); f uuid:=gen_random_uuid(); extra uuid:=gen_random_uuid(); job uuid:=gen_random_uuid(); confirmed boolean;
BEGIN
  UPDATE public.siat_configuracion SET ambiente='PRUEBAS' WHERE id=true;
  INSERT INTO public.siat_agentes_locales VALUES(a,'ACTIVO'),(other_agent,'ACTIVO');
  INSERT INTO public.siat_eventos_significativos VALUES(e,a,'VALIDADO','EVENTO-TEST','{"transaccion":true}');
  INSERT INTO public.siat_paquetes VALUES(p,e,'VALIDADO','RECEPCION-TEST','{"transaccion":true,"codigoEstado":908}',1);
  INSERT INTO public.facturas_siat(id,ambiente,origen_fiscal,estado_fiscal,evento_id,tipo_emision) VALUES(f,'PRUEBAS','PILOTO','VALIDADA',e,'OFFLINE');
  INSERT INTO public.siat_paquete_facturas VALUES(p,f);
  SELECT (public.siat_9b_estado_recuperacion(a,e)->>'confirmada')::boolean INTO confirmed;
  IF NOT confirmed THEN RAISE EXCEPTION 'No confirmó un circuito completo'; END IF;
  BEGIN PERFORM public.siat_9b_estado_recuperacion(other_agent,e); RAISE EXCEPTION 'Aceptó otro agente'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Aceptó otro agente' THEN RAISE; END IF; END;
  INSERT INTO public.facturas_siat(id,ambiente,origen_fiscal,estado_fiscal,evento_id,tipo_emision) VALUES(extra,'PRUEBAS','PILOTO','EMPAQUETADA',e,'OFFLINE');
  IF (public.siat_9b_estado_recuperacion(a,e)->>'confirmada')::boolean THEN RAISE EXCEPTION 'Aceptó factura incompleta'; END IF;
  DELETE FROM public.facturas_siat WHERE id=extra;
  UPDATE public.siat_paquetes SET respuesta_siat='{"transaccion":true,"codigoEstado":904}' WHERE id=p;
  IF (public.siat_9b_estado_recuperacion(a,e)->>'confirmada')::boolean THEN RAISE EXCEPTION 'Aceptó 904 como 908'; END IF;
  UPDATE public.siat_paquetes SET respuesta_siat='{"transaccion":false,"codigoEstado":908,"detalle":{"transaccion":true}}' WHERE id=p;
  IF (public.siat_9b_estado_recuperacion(a,e)->>'confirmada')::boolean THEN RAISE EXCEPTION 'Aceptó transacciones contradictorias'; END IF;
  UPDATE public.siat_paquetes SET respuesta_siat='{"transaccion":true,"codigoEstado":908,"detalle":{"codigoEstado":999}}' WHERE id=p;
  IF (public.siat_9b_estado_recuperacion(a,e)->>'confirmada')::boolean THEN RAISE EXCEPTION 'Aceptó códigos contradictorios'; END IF;
  UPDATE public.siat_paquetes SET respuesta_siat='{"transaccion":true,"codigoEstado":908,"mensajesList":[{"numeroArchivo":1}]}' WHERE id=p;
  IF (public.siat_9b_estado_recuperacion(a,e)->>'confirmada')::boolean THEN RAISE EXCEPTION 'Aceptó resultado individual parcial'; END IF;
  UPDATE public.siat_paquetes SET respuesta_siat='{"transaccion":"true","codigoEstado":"908"}' WHERE id=p;
  INSERT INTO public.siat_outbox(id,tipo_tarea,payload,estado,idempotency_key) VALUES(job,'VALIDAR_PAQUETE',jsonb_build_object('paqueteId',p),'PENDIENTE','test-recuperacion');
  IF (public.siat_9b_estado_recuperacion(a,e)->>'confirmada')::boolean THEN RAISE EXCEPTION 'Aceptó tarea pendiente'; END IF;
  UPDATE public.siat_outbox SET estado='COMPLETADA' WHERE id=job;
  IF NOT (public.siat_9b_estado_recuperacion(a,e)->>'confirmada')::boolean THEN RAISE EXCEPTION 'No confirmó recuperación final'; END IF;
  IF has_function_privilege('authenticated','public.siat_9b_estado_recuperacion(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Permiso inseguro'; END IF;
END $$;
ROLLBACK;

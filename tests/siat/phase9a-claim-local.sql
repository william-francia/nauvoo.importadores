-- Sólo base sintética: habilitar en la función de prueba no contacta el SIN.
BEGIN;
DO $$ BEGIN IF current_database() <> 'paso9_evidence_v2' THEN RAISE EXCEPTION 'Solo base sintética local.'; END IF; END $$;
UPDATE public.siat_outbox SET estado='CANCELADA' WHERE estado IN ('PENDIENTE','REINTENTAR');
DO $$
DECLARE a uuid:=gen_random_uuid(); f uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); item public.siat_outbox%ROWTYPE; n integer;
BEGIN
  UPDATE public.siat_configuracion SET ambiente='PRUEBAS' WHERE id=true;
  INSERT INTO public.usuarios(auth_user_id,activo,rol) VALUES(a,true,'administrador');
  INSERT INTO public.siat_sucursales(id,codigo,activo) VALUES(b,2999,true);
  INSERT INTO public.siat_catalogos(id,codigo,estado) VALUES(987655,'MOTIVOS_ANULACION','VIGENTE');
  INSERT INTO public.siat_catalogo_items(catalogo_id,codigo,activo) VALUES(987655,'1',true);
  INSERT INTO public.facturas_siat(id,ambiente,origen_fiscal,estado_fiscal,sucursal_id,fecha_emision,codigo_estado,transaccion,codigo_recepcion)
    VALUES(f,'PRUEBAS','PILOTO','VALIDADA',b,now()-interval '1 day',908,true,'RECEPCION-SINTETICA');
  PERFORM public.siat_9a_guardar_notificacion(f,a,'ANULACION','CORREO',repeat('A',64),'c***@***.bo','PREPARAR',true,NULL);
  PERFORM public.siat_solicitar_operacion_factura_confirmada(f,'ANULAR',a,1,true,true,gen_random_uuid());
  INSERT INTO public.siat_outbox(tipo_tarea,estado,payload,idempotency_key) VALUES
    ('REVERTIR_ANULACION','PENDIENTE','{}','claim-test:reversion'), ('REGISTRAR_EVENTO','PENDIENTE','{}','claim-test:evento');
  SELECT count(*) INTO n FROM public.siat_reclamar_outbox_9a('test-worker',120,false);
  IF n <> 0 THEN RAISE EXCEPTION 'Habilitó operación sin activar cancelación piloto'; END IF;
  SELECT * INTO item FROM public.siat_reclamar_outbox_9a('test-worker',120,true);
  IF item.tipo_tarea IS DISTINCT FROM 'ANULAR_FACTURA' OR item.factura_id IS DISTINCT FROM f THEN RAISE EXCEPTION 'No seleccionó cancelación autorizada'; END IF;
  SELECT count(*) INTO n FROM public.siat_reclamar_outbox_9a('test-worker',120,true);
  IF n <> 0 THEN RAISE EXCEPTION 'Reclamó reversión o contingencia'; END IF;
END $$;
ROLLBACK;

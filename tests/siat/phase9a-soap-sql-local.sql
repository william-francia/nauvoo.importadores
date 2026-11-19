-- Únicamente base sintética local paso9_soap_v1; cambios se revierten.
BEGIN;
DO $$
DECLARE f uuid:=gen_random_uuid(); j uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); bad uuid:=gen_random_uuid(); cliente uuid:=gen_random_uuid(); producto uuid:=gen_random_uuid(); autorizacion uuid:=gen_random_uuid(); result jsonb; n integer;
BEGIN
  IF has_table_privilege('authenticated','public.siat_9a_soap_evidencias','SELECT')
    OR has_table_privilege('service_role','public.siat_9a_soap_evidencias','SELECT')
    OR has_function_privilege('authenticated','public.siat_9a_leer_soap(uuid,uuid)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.siat_9a_leer_soap(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'Permisos inseguros'; END IF;
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(a,'test@example.invalid','{}');
  UPDATE public.usuarios SET rol='administrador',activo=true WHERE auth_user_id=a;
  INSERT INTO public.clientes(id,nombre_razon_social) VALUES(cliente,'Cliente sintético');
  INSERT INTO public.productos(id,codigo_interno,nombre) VALUES(producto,'TEST-SOAP','Producto sintético');
  INSERT INTO public.siat_piloto_autorizaciones(id,actor_auth_user_id,cliente_id,producto_id,preview_hash,precio_unitario,producto_descripcion_snapshot) VALUES(autorizacion,a,cliente,producto,repeat('a',64),5,'Producto sintético');
  INSERT INTO public.facturas_siat(id,ambiente,origen_fiscal,estado_fiscal,piloto_autorizacion_id,modalidad,documento_sector,tipo_factura,tipo_emision,detalle_snapshot) VALUES(f,'PRUEBAS','PILOTO','ANULACION_PENDIENTE',autorizacion,'ELECTRONICA',1,1,'ONLINE','[{"descripcion":"Producto sintético"}]');
  INSERT INTO public.siat_outbox(id,factura_id,tipo_tarea,estado,payload,idempotency_key) VALUES(j,f,'ANULAR_FACTURA','PROCESANDO','{}','soap-test-'||j);
  PERFORM public.siat_9a_reservar_soap(f,'ANULACION',j,repeat('A',16));
  PERFORM public.siat_9a_reservar_soap(f,'ANULACION',j,repeat('A',16));
  BEGIN PERFORM public.siat_9a_reservar_soap(f,'REVERSION',j,repeat('A',16)); RAISE EXCEPTION 'Admitió operación incorrecta'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Admitió operación incorrecta' THEN RAISE; END IF; END;
  PERFORM public.siat_9a_guardar_soap(j,'RECIBIDA',200,'nonce-sintetico','cifrado-sintetico',repeat('B',64));
  PERFORM public.siat_9a_guardar_soap(j,'RECIBIDA',200,'otro-nonce','otro-cifrado',repeat('B',64));
  SELECT count(*) INTO n FROM public.siat_auditoria WHERE entidad_id=f::text AND accion='EVIDENCIA_SOAP_9A';
  IF n<>1 THEN RAISE EXCEPTION 'Auditoría duplicada'; END IF;
  BEGIN PERFORM public.siat_9a_guardar_soap(j,'TIMEOUT',NULL,NULL,NULL,NULL); RAISE EXCEPTION 'Admitió sobrescritura'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Admitió sobrescritura' THEN RAISE; END IF; END;
  BEGIN PERFORM public.siat_9a_leer_soap(j,bad); RAISE EXCEPTION 'Admitió usuario no autorizado'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Admitió usuario no autorizado' THEN RAISE; END IF; END;
  result:=public.siat_9a_leer_soap(j,a);
  IF result->>'cifrado'<>'cifrado-sintetico' OR result->>'sha256'<>repeat('B',64) THEN RAISE EXCEPTION 'Lectura incorrecta'; END IF;
  SELECT count(*) INTO n FROM public.siat_auditoria WHERE entidad_id=f::text AND accion='LECTURA_EVIDENCIA_SOAP_9A';
  IF n<>1 THEN RAISE EXCEPTION 'Falta auditoría de lectura'; END IF;
END $$;
ROLLBACK;

-- Exclusivamente base sintética local; no se envía ningún mensaje.
BEGIN;
DO $$
DECLARE a uuid:=gen_random_uuid(); f uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); auto_invoice uuid:=gen_random_uuid(); uncertain_invoice uuid:=gen_random_uuid(); reversed_invoice uuid:=gen_random_uuid(); commercial_invoice uuid:=gen_random_uuid(); intento uuid; b uuid:=gen_random_uuid(); s text; before_state text; n integer;
  cliente uuid:=gen_random_uuid(); producto uuid:=gen_random_uuid(); venta uuid:=gen_random_uuid(); usuario uuid;
  autorizaciones uuid[]:=ARRAY[gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),gen_random_uuid()];
BEGIN
  IF current_database() <> 'paso9_evidence_v2' THEN RAISE EXCEPTION 'Solo base sintética local.'; END IF;
  IF has_table_privilege('authenticated','public.siat_9a_notificaciones','SELECT') OR has_table_privilege('service_role','public.siat_9a_notificaciones','INSERT') OR NOT has_function_privilege('service_role','public.siat_9a_guardar_notificacion(uuid,uuid,text,text,text,text,text,boolean,text,timestamp with time zone)','EXECUTE') THEN RAISE EXCEPTION 'Permisos de notificación incorrectos.'; END IF;
  UPDATE public.siat_configuracion SET ambiente='PRUEBAS' WHERE id=true;
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(a,'notificaciones-test@example.invalid','{}');
  UPDATE public.usuarios SET rol='administrador',activo=true WHERE auth_user_id=a RETURNING id INTO usuario;
  INSERT INTO public.clientes(id,nombre_razon_social) VALUES(cliente,'Cliente sintético');
  INSERT INTO public.productos(id,codigo_interno,nombre) VALUES(producto,'TEST-9A-EVIDENCIA','Producto sintético');
  INSERT INTO public.siat_piloto_autorizaciones(id,actor_auth_user_id,cliente_id,producto_id,preview_hash,precio_unitario,producto_descripcion_snapshot)
    SELECT autorizaciones[i],a,cliente,producto,repeat('a',63)||i::text,5,'Producto sintético' FROM generate_series(1,5) i;
  INSERT INTO public.siat_sucursales(id,codigo,nombre,activo) VALUES (b,1999,'Sucursal sintética',true);
  INSERT INTO public.ventas(id,codigo_venta,usuario_id,cliente_id) VALUES(venta,'TEST-9A-EVIDENCIA',usuario,cliente);
  INSERT INTO public.facturas_siat(id,ambiente,origen_fiscal,estado_fiscal,sucursal_id,piloto_autorizacion_id,modalidad,documento_sector,tipo_factura,detalle_snapshot,numero_factura)
    SELECT v.id,'PRUEBAS','PILOTO',v.estado,b,autorizaciones[v.orden],'ELECTRONICA',1,1,'[{"descripcion":"Producto sintético"}]'::jsonb,v.orden
    FROM (VALUES (f,'VALIDADA',1),(r,'VALIDADA',2),(auto_invoice,'VALIDADA',3),(uncertain_invoice,'VALIDADA',4),(reversed_invoice,'REVERTIDA',5)) AS v(id,estado,orden);
  INSERT INTO public.facturas_siat(id,ambiente,origen_fiscal,estado_fiscal,sucursal_id,venta_id,numero_factura)
    VALUES (commercial_invoice,'PRUEBAS','VENTA','VALIDADA',b,venta,6);
  BEGIN
    PERFORM public.siat_9a_guardar_notificacion(commercial_invoice,a,'ANULACION','CORREO',repeat('A',64),'c***@***.bo','PREPARAR',true,NULL);
    RAISE EXCEPTION 'Aceptó factura comercial';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Aceptó factura comercial' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.siat_9a_guardar_notificacion(f,gen_random_uuid(),'ANULACION','CORREO',repeat('A',64),'c***@***.bo','PREPARAR',true,NULL);
    RAISE EXCEPTION 'Aceptó usuario sin permiso';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Aceptó usuario sin permiso' THEN RAISE; END IF; END;
  s:=public.siat_9a_guardar_notificacion(f,a,'ANULACION','CORREO',repeat('A',64),'c***@***.bo','PREPARAR',true,NULL);
  IF s <> 'PENDIENTE' THEN RAISE EXCEPTION 'Estado inicial incorrecto'; END IF;
  BEGIN
    PERFORM public.siat_9a_guardar_notificacion(f,a,'ANULACION','CORREO',repeat('A',64),'c***@***.bo','REGISTRAR_ENVIO_MANUAL',true,repeat('B',64),now());
    RAISE EXCEPTION 'Aceptó envío antes de anulación';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Aceptó envío antes de anulación' THEN RAISE; END IF; END;
  UPDATE public.facturas_siat SET estado_fiscal='ANULADA' WHERE id=f;
  BEGIN
    PERFORM public.siat_9a_guardar_notificacion(f,a,'ANULACION','CORREO',repeat('A',64),'c***@***.bo','REGISTRAR_ENVIO_MANUAL',true,NULL,now());
    RAISE EXCEPTION 'Aceptó envío sin comprobante';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Aceptó envío sin comprobante' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.siat_9a_guardar_notificacion(f,a,'ANULACION','CORREO',repeat('A',64),'c***@***.bo','ENTREGA_CONFIRMADA',true,repeat('B',64),now());
    RAISE EXCEPTION 'Aceptó entrega sin verificación';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Aceptó entrega sin verificación' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.siat_9a_guardar_notificacion(f,a,'ANULACION','CORREO',repeat('C',64),'c***@***.bo','REGISTRAR_ENVIO_MANUAL',true,repeat('B',64),now());
    RAISE EXCEPTION 'Aceptó destinatario distinto';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Aceptó destinatario distinto' THEN RAISE; END IF; END;
  s:=public.siat_9a_guardar_notificacion(f,a,'ANULACION','CORREO',repeat('A',64),'c***@***.bo','REGISTRAR_ENVIO_MANUAL',true,repeat('B',64),now());
  IF s <> 'ENVIADA' THEN RAISE EXCEPTION 'No guardó envío declarado'; END IF;
  PERFORM public.siat_9a_guardar_notificacion(f,a,'ANULACION','CORREO',repeat('A',64),'c***@***.bo','REGISTRAR_ENVIO_MANUAL',true,repeat('B',64),now());
  SELECT count(*) INTO n FROM public.siat_9a_notificaciones WHERE factura_id=f AND estado='ENVIADA' AND confirmado_at IS NULL AND evidencia_tipo='COMPROBANTE_MANUAL_DECLARADO';
  IF n <> 1 THEN RAISE EXCEPTION 'Se simuló entrega o se duplicó notificación'; END IF;
  BEGIN
    PERFORM public.siat_9a_guardar_notificacion(f,a,'ANULACION','CORREO',repeat('A',64),'c***@***.bo','CONFIRMAR_ENTREGA_MANUAL',true,NULL,now());
    RAISE EXCEPTION 'Confirmó entrega sin acuse';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Confirmó entrega sin acuse' THEN RAISE; END IF; END;
  PERFORM public.siat_9a_guardar_notificacion(f,a,'ANULACION','CORREO',repeat('A',64),'c***@***.bo','CONFIRMAR_ENTREGA_MANUAL',true,repeat('C',64),now());
  IF NOT EXISTS (SELECT 1 FROM public.siat_9a_notificaciones WHERE factura_id=f AND estado='ENTREGA_CONFIRMADA' AND confirmado_por=a AND evidencia_hash=repeat('B',64) AND evidencia_entrega_hash=repeat('C',64)) THEN RAISE EXCEPTION 'No conservó evidencia de envío y acuse'; END IF;
  PERFORM public.siat_9a_guardar_notificacion(auto_invoice,a,'ANULACION','CORREO',repeat('A',64),'c***@***.bo','PREPARAR',true,NULL);
  UPDATE public.facturas_siat SET estado_fiscal='ANULADA' WHERE id=auto_invoice;
  BEGIN
    PERFORM public.siat_9a_reservar_correo(auto_invoice,gen_random_uuid(),'ANULACION',repeat('A',64),true);
    RAISE EXCEPTION 'Permitió correo a usuario no autorizado';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Permitió correo a usuario no autorizado' THEN RAISE; END IF; END;
  intento:=public.siat_9a_reservar_correo(auto_invoice,a,'ANULACION',repeat('A',64),true);
  BEGIN
    PERFORM public.siat_9a_confirmar_correo_proveedor(intento,gen_random_uuid(),repeat('F',64));
    RAISE EXCEPTION 'Permitió confirmar correo sin permiso';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Permitió confirmar correo sin permiso' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.siat_9a_reservar_correo(auto_invoice,a,'ANULACION',repeat('A',64),true);
    RAISE EXCEPTION 'Permitió segundo envío automático';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Permitió segundo envío automático' THEN RAISE; END IF; END;
  PERFORM public.siat_9a_confirmar_correo_proveedor(intento,a,repeat('F',64));
  IF NOT EXISTS (SELECT 1 FROM public.siat_9a_notificaciones WHERE factura_id=auto_invoice AND estado='ENVIADA' AND evidencia_tipo='PROVEEDOR_ACEPTO' AND confirmado_at IS NULL) THEN RAISE EXCEPTION 'Aceptación del proveedor se interpretó incorrectamente'; END IF;
  PERFORM public.siat_9a_guardar_notificacion(uncertain_invoice,a,'ANULACION','CORREO',repeat('A',64),'c***@***.bo','PREPARAR',true,NULL);
  UPDATE public.facturas_siat SET estado_fiscal='ANULADA' WHERE id=uncertain_invoice;
  PERFORM public.siat_9a_reservar_correo(uncertain_invoice,a,'ANULACION',repeat('A',64),true);
  BEGIN
    PERFORM public.siat_9a_guardar_notificacion(uncertain_invoice,a,'ANULACION','CORREO',repeat('C',64),'c***@***.bo','PREPARAR',true,NULL);
    RAISE EXCEPTION 'Permitió cambiar destinatario con correo incierto';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Permitió cambiar destinatario con correo incierto' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.siat_9a_guardar_notificacion(uncertain_invoice,a,'ANULACION','CORREO',repeat('A',64),'c***@***.bo','REGISTRAR_ENVIO_MANUAL',true,repeat('B',64),now());
    RAISE EXCEPTION 'Aceptó envío manual con correo incierto';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Aceptó envío manual con correo incierto' THEN RAISE; END IF; END;
  PERFORM public.siat_9a_guardar_notificacion(reversed_invoice,a,'ANULACION','CORREO',repeat('A',64),'c***@***.bo','PREPARAR',true,NULL);
  PERFORM public.siat_9a_guardar_notificacion(reversed_invoice,a,'ANULACION','CORREO',repeat('A',64),'c***@***.bo','REGISTRAR_ENVIO_MANUAL',true,repeat('B',64),now());
  PERFORM public.siat_9a_guardar_notificacion(r,a,'ANULACION','WHATSAPP',repeat('D',64),'***44','PREPARAR',true,NULL);
  UPDATE public.facturas_siat SET estado_fiscal='ANULACION_PENDIENTE' WHERE id=r;
  SELECT estado_fiscal INTO before_state FROM public.facturas_siat WHERE id=r;
  BEGIN
    PERFORM public.siat_9a_guardar_revision(r,gen_random_uuid(),'CONSULTA_SIN',repeat('E',64),'NO_CONCLUYENTE',true);
    RAISE EXCEPTION 'Aceptó revisión de usuario no autorizado';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Aceptó revisión de usuario no autorizado' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.siat_9a_guardar_revision(r,a,'CONSULTA_SIN',repeat('E',64),'NO_CONCLUYENTE',false);
    RAISE EXCEPTION 'Aceptó revisión sin confirmación';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Aceptó revisión sin confirmación' THEN RAISE; END IF; END;
  PERFORM public.siat_9a_guardar_revision(r,a,'CONSULTA_SIN',repeat('E',64),'NO_CONCLUYENTE',true);
  IF (SELECT estado_fiscal FROM public.facturas_siat WHERE id=r) <> before_state THEN RAISE EXCEPTION 'La revisión alteró el estado fiscal'; END IF;
  IF EXISTS (SELECT 1 FROM public.siat_outbox WHERE factura_id=r) THEN RAISE EXCEPTION 'La revisión creó un envío'; END IF;
END $$;
ROLLBACK;

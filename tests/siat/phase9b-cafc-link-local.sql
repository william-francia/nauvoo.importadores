-- Solo base local sintética dedicada; no llama al SIN ni conserva cambios del test.
BEGIN;
DO $$
DECLARE
 a uuid:=gen_random_uuid(); u uuid:=gen_random_uuid(); client uuid:=gen_random_uuid(); branch uuid:=gen_random_uuid(); agent uuid:=gen_random_uuid();
 cuis uuid:=gen_random_uuid(); cufd uuid:=gen_random_uuid(); cafc uuid:=gen_random_uuid(); event uuid:=gen_random_uuid();
 sale1 uuid:=gen_random_uuid(); sale2 uuid:=gen_random_uuid(); sale3 uuid:=gen_random_uuid(); sale4 uuid:=gen_random_uuid();
 f1 uuid:=gen_random_uuid(); f2 uuid:=gen_random_uuid(); f3 uuid:=gen_random_uuid(); f4 uuid:=gen_random_uuid(); event2 uuid:=gen_random_uuid();
 issued timestamptz:=now()-interval '1 hour'; p jsonb; p2 jsonb; p3 jsonb; p4 jsonb; event_payload jsonb; result jsonb; c integer; original_sale jsonb; imported uuid; stored_cafc uuid;
BEGIN
 IF current_database() !~ '^nuvoo_9b_(cafc_0800_synthetic|versiones_[a-f0-9]{32})$' OR inet_server_addr() NOT IN ('127.0.0.1'::inet,'::1'::inet) THEN RAISE EXCEPTION 'Solo base sintética local'; END IF;
 INSERT INTO public.usuarios VALUES(u,a,true,'administrador');
 INSERT INTO public.clientes VALUES(client,'Cliente test','CI','12345',NULL);
 INSERT INTO public.siat_configuracion VALUES(true,'PRUEBAS','ELECTRONICA',false,'123456789');
 INSERT INTO public.siat_sucursales VALUES(branch,0);
 INSERT INTO public.siat_agentes_locales VALUES(agent,'ACTIVO',branch,NULL,'AGENTE_TEST');
 INSERT INTO public.siat_cuis VALUES(cuis,'CUIS-TEST');
 INSERT INTO public.siat_cufd VALUES(cufd,cuis,'CUFD-TEST','PRUEBAS',branch,NULL,now()-interval '3 hours',now()+interval '20 hours');
 INSERT INTO public.siat_rangos_cafc VALUES(cafc,branch,NULL,'VIGENTE',now()-interval '2 days',now()+interval '2 days',50,60,'CAFC-TEST');
 INSERT INTO public.siat_eventos_significativos VALUES(event,agent,'5',now()-interval '2 hours',now()-interval '30 minutes',cafc,cufd,branch,NULL,'Evento de prueba','{}',NULL,'MANUAL_ADMINISTRATIVO');
 event_payload:=jsonb_build_object('id',event2,'cufdId',cufd,'cafcId',cafc,'tipoEventoCodigo','5','fechaInicio',now()-interval '2 hours','fechaFin',now()-interval '30 minutes','descripcion','Evento manual sintético');
 BEGIN PERFORM public.siat_importar_evento_offline('AGENTE_TEST',event_payload); RAISE EXCEPTION 'Aceptó evento antiguo'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'IMPORTACION_EVENTO_CONTRATO_V1_DESHABILITADO' THEN RAISE; END IF; END;
 imported:=public.siat_importar_evento_offline_v2('AGENTE_TEST',event_payload);
 IF imported<>event2 OR public.siat_importar_evento_offline_v2('AGENTE_TEST',event_payload)<>event2 THEN RAISE EXCEPTION 'No preservó identidad del evento'; END IF;
 SELECT cafc_id INTO stored_cafc FROM public.siat_eventos_significativos WHERE id=event2;
 IF stored_cafc IS DISTINCT FROM cafc THEN RAISE EXCEPTION 'No preservó CAFC del evento'; END IF;
 BEGIN PERFORM public.siat_importar_evento_offline_v2('AGENTE_TEST',jsonb_set(event_payload,'{cafcId}','null')); RAISE EXCEPTION 'Aceptó cambio de CAFC del evento'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Aceptó cambio de CAFC del evento' THEN RAISE; END IF; END;
 BEGIN PERFORM public.siat_importar_evento_offline_v2('AGENTE_TEST',jsonb_set(event_payload,'{evidencia}','{"alterado":true}')); RAISE EXCEPTION 'Aceptó cambio de evidencia del evento'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Aceptó cambio de evidencia del evento' THEN RAISE; END IF; END;
 INSERT INTO public.siat_metodo_pago_mapeos VALUES('EFECTIVO',1,'SIAT_VIGENTE');
 INSERT INTO public.ventas VALUES(sale1,client,'confirmada',true,5,0,'EFECTIVO');
 SELECT to_jsonb(v) INTO original_sale FROM public.ventas v WHERE v.id=sale1;
 INSERT INTO public.detalle_ventas VALUES(gen_random_uuid(),sale1,'P1','Perno',1,5,0,5);
 INSERT INTO public.movimientos_inventario VALUES(gen_random_uuid(),sale1,1);
 INSERT INTO public.stock_por_almacen VALUES(gen_random_uuid(),7);
 INSERT INTO storage.objects VALUES('siat-documentos','cafc/'||event||'/'||f1||'/firmado.xml.gz'),('siat-documentos','cafc/'||event||'/'||f1||'/original.bin'),('siat-documentos','cafc/'||event||'/'||f2||'/firmado.xml.gz'),('siat-documentos','cafc/'||event||'/'||f2||'/original.bin'),('siat-documentos','cafc/'||event||'/'||f3||'/firmado.xml.gz'),('siat-documentos','cafc/'||event||'/'||f3||'/original.bin'),('siat-documentos','cafc/'||event||'/'||f4||'/firmado.xml.gz'),('siat-documentos','cafc/'||event||'/'||f4||'/original.bin');
 p:=jsonb_build_object('facturaId',f1,'eventoId',event,'cafcId',cafc,'agenteId',agent,'numeroFactura',54,'fechaEmision',issued,'idempotencyKey','cafc-test-existing-0001',
   'xmlHash',repeat('A',64),'evidenciaHash',repeat('B',64),'xmlPath','cafc/'||event||'/'||f1||'/firmado.xml.gz','evidenciaPath','cafc/'||event||'/'||f1||'/original.bin',
   'nit','123456789','cuf','ABC123','cufd','CUFD-TEST','cafc','CAFC-TEST','codigoSucursal',0,'codigoPuntoVenta',0,'correlationId',gen_random_uuid(),
   'montoTotal','5','descuentoAdicional','0','numeroDocumento','12345','nombreRazonSocial','Cliente test','tipoDocumento',1,'codigoMetodoPago',1,
   'detalleSnapshot',jsonb_build_array(jsonb_build_object('codigoProducto','P1','descripcion','Perno','cantidad',1,'precioUnitario',5,'descuento',0,'subtotal',5)),
   'clienteSnapshot','{}'::jsonb,'totalesSnapshot','{}'::jsonb,'pagoSnapshot','{}'::jsonb,'qrContenido','qr-test','origenCaja','TEST');
 BEGIN PERFORM public.siat_9b_vincular_cafc(p,sale1,gen_random_uuid(),true); RAISE EXCEPTION 'Aceptó actor no autorizado'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Aceptó actor no autorizado' THEN RAISE; END IF; END;
 result:=public.siat_9b_vincular_cafc(p,sale1,a,true);
 IF result->>'estado'<>'VINCULADA' OR result->>'facturaId'<>f1::text THEN RAISE EXCEPTION 'No vinculó venta existente'; END IF;
 IF public.siat_9b_vincular_cafc(p,sale1,a,true)->>'estado'<>'VINCULADA' THEN RAISE EXCEPTION 'Reintento no idempotente'; END IF;
 UPDATE public.siat_rangos_cafc SET estado='VENCIDO' WHERE id=cafc;
 IF public.siat_9b_vincular_cafc(p,sale1,a,true)->>'estado'<>'VINCULADA' THEN RAISE EXCEPTION 'No recuperó vinculación ya confirmada'; END IF;
 UPDATE public.siat_rangos_cafc SET estado='VIGENTE' WHERE id=cafc;
 SELECT count(*) INTO c FROM public.ventas; IF c<>1 THEN RAISE EXCEPTION 'Duplicó venta'; END IF;
 SELECT count(*) INTO c FROM public.movimientos_inventario; IF c<>1 THEN RAISE EXCEPTION 'Duplicó inventario'; END IF;
 IF (SELECT to_jsonb(v) FROM public.ventas v WHERE id=sale1) IS DISTINCT FROM original_sale OR (SELECT cantidad_disponible FROM public.stock_por_almacen LIMIT 1)<>7 THEN RAISE EXCEPTION 'Modificó venta o stock'; END IF;
 SELECT count(*) INTO c FROM public.facturas_siat; IF c<>1 THEN RAISE EXCEPTION 'Duplicó factura'; END IF;
 p2:=p||jsonb_build_object('facturaId',f2,'numeroFactura',55,'idempotencyKey','cafc-test-pending-00002','correlationId',gen_random_uuid(),'xmlPath','cafc/'||event||'/'||f2||'/firmado.xml.gz','evidenciaPath','cafc/'||event||'/'||f2||'/original.bin');
 result:=public.siat_9b_vincular_cafc(p2,NULL,a,true);
 IF result->>'estado'<>'PENDIENTE_CONCILIACION' OR result->>'motivo'<>'No se indicó una venta original' THEN RAISE EXCEPTION 'Vinculó sin venta seleccionada o no explicó el motivo'; END IF;
 result:=public.siat_9b_vincular_cafc(p2,sale2,a,true);
 IF result->>'estado'<>'PENDIENTE_CONCILIACION' OR result->>'motivo'<>'La venta original indicada no existe' OR EXISTS(SELECT 1 FROM public.ventas WHERE id=sale2) OR EXISTS(SELECT 1 FROM public.facturas_siat WHERE id=f2) THEN RAISE EXCEPTION 'Inventó venta o factura, o no explicó el motivo'; END IF;
 INSERT INTO public.ventas VALUES(sale2,client,'confirmada',true,5,0,'EFECTIVO');
 INSERT INTO public.detalle_ventas VALUES(gen_random_uuid(),sale2,'P1','Perno',1,5,0,5);
 IF public.siat_9b_vincular_cafc(p2,sale2,a,true)->>'estado'<>'VINCULADA' THEN RAISE EXCEPTION 'No recuperó conciliación'; END IF;
 BEGIN PERFORM public.siat_9b_vincular_cafc(jsonb_set(p2,'{montoTotal}','"6"'),sale2,a,true); RAISE EXCEPTION 'Aceptó cambios en reintento'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Aceptó cambios en reintento' THEN RAISE; END IF; END;
 p3:=p||jsonb_build_object('facturaId',f3,'numeroFactura',56,'idempotencyKey','cafc-test-rollback-0003','correlationId',gen_random_uuid(),'xmlPath','cafc/'||event||'/'||f3||'/firmado.xml.gz','evidenciaPath','cafc/'||event||'/'||f3||'/original.bin');
 INSERT INTO public.ventas VALUES(sale3,client,'confirmada',true,5,0,'EFECTIVO');
 INSERT INTO public.detalle_ventas VALUES(gen_random_uuid(),sale3,'P1','Perno',1,5,0,5);
 BEGIN PERFORM public.siat_9b_vincular_cafc(p3,sale3,a,true); RAISE EXCEPTION 'No produjo error intermedio'; EXCEPTION WHEN check_violation THEN NULL; END;
 IF EXISTS(SELECT 1 FROM public.facturas_siat WHERE id=f3) OR EXISTS(SELECT 1 FROM public.siat_9b_cafc_vinculos WHERE factura_id=f3) THEN RAISE EXCEPTION 'No revirtió la operación atómica'; END IF;
 p4:=p||jsonb_build_object('facturaId',f4,'numeroFactura',57,'idempotencyKey','cafc-test-mismatch-0004','correlationId',gen_random_uuid(),'xmlPath','cafc/'||event||'/'||f4||'/firmado.xml.gz','evidenciaPath','cafc/'||event||'/'||f4||'/original.bin');
 INSERT INTO public.ventas VALUES(sale4,client,'confirmada',true,5,0,'EFECTIVO');
 INSERT INTO public.detalle_ventas VALUES(gen_random_uuid(),sale4,'OTRO','Perno',1,5,0,5);
 IF public.siat_9b_vincular_cafc(p4,sale4,a,true)->>'estado'<>'PENDIENTE_CONCILIACION' OR EXISTS(SELECT 1 FROM public.facturas_siat WHERE id=f4) THEN RAISE EXCEPTION 'Vinculó detalle ambiguo'; END IF;
 UPDATE public.detalle_ventas SET codigo_producto_snapshot='P1' WHERE venta_id=sale4;
 UPDATE public.ventas SET estado='facturada' WHERE id=sale4;
 IF public.siat_9b_vincular_cafc(p4,sale4,a,true)->>'estado'<>'PENDIENTE_CONCILIACION' OR EXISTS(SELECT 1 FROM public.facturas_siat WHERE id=f4) THEN RAISE EXCEPTION 'Vinculó una venta ya facturada'; END IF;
 BEGIN PERFORM public.siat_9b_vincular_cafc(jsonb_set(p4,'{facturaId}',to_jsonb('08dd889e-f2f7-4acb-be2e-2f911aae9919'::text)),sale4,a,true); RAISE EXCEPTION 'Aceptó factura protegida'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='Aceptó factura protegida' THEN RAISE; END IF; END;
 IF has_table_privilege('authenticated','public.siat_9b_cafc_vinculos','SELECT') OR has_function_privilege('authenticated','public.siat_9b_vincular_cafc(jsonb,uuid,uuid,boolean)','EXECUTE') THEN RAISE EXCEPTION 'Permisos inseguros'; END IF;
 BEGIN PERFORM public.siat_importar_factura_offline_v2('test','{"esManualCafc":true}'); RAISE EXCEPTION 'La importación insegura aceptó CAFC'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'CAFC_REQUIERE_VINCULACION_VENTA_EXISTENTE' THEN RAISE; END IF; END;
 BEGIN PERFORM public.siat_importar_factura_offline_v2('test','{"esManualCafc":false,"xmlDocumento":"<factura><cafc>CAFC-TEST</cafc></factura>"}'); RAISE EXCEPTION 'La importación insegura aceptó XML CAFC'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'CAFC_REQUIERE_VINCULACION_VENTA_EXISTENTE' THEN RAISE; END IF; END;
END $$;
ROLLBACK;

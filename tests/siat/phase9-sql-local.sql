-- ÚNICAMENTE base sintética local de pruebas, nunca Supabase ni datos reales.
BEGIN;
DO $$
DECLARE
  v_admin uuid := gen_random_uuid(); v_invoice uuid := gen_random_uuid(); v_reverse uuid := gen_random_uuid();
  v_expired uuid := gen_random_uuid(); v_key uuid := gen_random_uuid(); v_result text; v_count integer;
  v_branch uuid := gen_random_uuid(); v_other uuid := gen_random_uuid(); v_disabled uuid := gen_random_uuid(); v_point uuid := gen_random_uuid();
  v_cliente uuid:=gen_random_uuid(); v_producto uuid:=gen_random_uuid(); v_catalogo uuid:=gen_random_uuid(); v_a1 uuid:=gen_random_uuid(); v_a2 uuid:=gen_random_uuid(); v_a3 uuid:=gen_random_uuid();
BEGIN
  IF current_database() <> 'paso9_evidence_v2' THEN RAISE EXCEPTION 'Solo ejecutar en base sintética local.'; END IF;
  UPDATE public.siat_configuracion SET ambiente = 'PRUEBAS' WHERE id = true;
  INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(v_admin,'test@example.invalid','{}');
  UPDATE public.usuarios SET rol='administrador',activo=true WHERE auth_user_id=v_admin;
  INSERT INTO public.clientes(id,nombre_razon_social) VALUES(v_cliente,'Cliente sintético');
  INSERT INTO public.productos(id,codigo_interno,nombre) VALUES(v_producto,'TEST-9A','Producto sintético');
  INSERT INTO public.siat_piloto_autorizaciones(id,actor_auth_user_id,cliente_id,producto_id,preview_hash,precio_unitario,producto_descripcion_snapshot) VALUES
    (v_a1,v_admin,v_cliente,v_producto,repeat('a',64),5,'Producto sintético'),(v_a2,v_admin,v_cliente,v_producto,repeat('b',64),5,'Producto sintético'),(v_a3,v_admin,v_cliente,v_producto,repeat('c',64),5,'Producto sintético');
  BEGIN
    PERFORM public.siat_solicitar_operacion_factura_confirmada('08dd889e-f2f7-4acb-be2e-2f911aae9919', 'ANULAR', v_admin, 1, true, true, gen_random_uuid());
    RAISE EXCEPTION 'Aceptó factura piloto anterior';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Aceptó factura piloto anterior' THEN RAISE; END IF; END;
  INSERT INTO public.siat_catalogos (id, codigo, nombre, estado) VALUES (v_catalogo, 'MOTIVOS_ANULACION', 'Motivos sintéticos', 'VIGENTE');
  INSERT INTO public.siat_catalogo_items (catalogo_id, codigo, descripcion, clave_natural, activo) VALUES (v_catalogo, '1', 'Motivo sintético', '1', true);
  INSERT INTO public.siat_sucursales (id, codigo, nombre, activo) VALUES (v_branch, 1001, 'Sucursal A', true), (v_other, 1002, 'Sucursal B', true), (v_disabled, 1003, 'Sucursal C', false);
  INSERT INTO public.siat_puntos_venta (id, sucursal_id, codigo, nombre, activo) VALUES (v_point, v_other, 1001, 'Punto sintético', true);
  INSERT INTO public.facturas_siat (id, ambiente, origen_fiscal, estado_fiscal, fecha_emision, sucursal_id, codigo_estado, transaccion, codigo_recepcion,piloto_autorizacion_id,modalidad,documento_sector,tipo_factura,tipo_emision,detalle_snapshot,numero_factura) VALUES
    (v_invoice, 'PRUEBAS', 'PILOTO', 'VALIDADA', now() - interval '1 day', v_branch, 908, true, 'RECEPCION-SINTETICA',v_a1,'ELECTRONICA',1,1,'ONLINE','[{"descripcion":"Producto sintético"}]',1),
    (v_reverse, 'PRUEBAS', 'PILOTO', 'ANULADA', now() - interval '1 day', v_branch, 908, true, 'RECEPCION-SINTETICA',v_a2,'ELECTRONICA',1,1,'ONLINE','[{"descripcion":"Producto sintético"}]',2),
    (v_expired, 'PRUEBAS', 'PILOTO', 'VALIDADA', now() - interval '4 months', v_branch, 908, true, 'RECEPCION-SINTETICA',v_a3,'ELECTRONICA',1,1,'ONLINE','[{"descripcion":"Producto sintético"}]',3);
  UPDATE public.facturas_siat SET codigo_recepcion = NULL WHERE id = v_invoice;
  BEGIN
    PERFORM public.siat_solicitar_operacion_factura_confirmada(v_invoice, 'ANULAR', v_admin, 1, true, true, v_key);
    RAISE EXCEPTION 'Aceptó factura sin evidencia 908';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Aceptó factura sin evidencia 908' THEN RAISE; END IF; END;
  UPDATE public.facturas_siat SET codigo_recepcion = 'RECEPCION-SINTETICA' WHERE id = v_invoice;
  UPDATE public.facturas_siat SET transaccion = false WHERE id = v_invoice;
  BEGIN
    PERFORM public.siat_solicitar_operacion_factura_confirmada(v_invoice, 'ANULAR', v_admin, 1, true, true, v_key);
    RAISE EXCEPTION 'Aceptó 908 con transacción falsa';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Aceptó 908 con transacción falsa' THEN RAISE; END IF; END;
  UPDATE public.facturas_siat SET transaccion = true WHERE id = v_invoice;
  BEGIN
    PERFORM public.siat_solicitar_operacion_factura_confirmada(v_invoice, 'ANULAR', v_admin, 1, true, true, v_key);
    RAISE EXCEPTION 'Aceptó operación sin destinatario';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Aceptó operación sin destinatario' THEN RAISE; END IF; END;
  PERFORM public.siat_9a_guardar_notificacion(v_invoice,v_admin,'ANULACION','CORREO',repeat('A',64),'c***@***.bo','PREPARAR',true,NULL);
  PERFORM public.siat_9a_guardar_notificacion(v_reverse,v_admin,'REVERSION','CORREO',repeat('B',64),'c***@***.bo','PREPARAR',true,NULL);
  BEGIN
    PERFORM public.siat_solicitar_operacion_factura_confirmada(v_invoice, 'ANULAR', v_admin, 1, true, true, v_key, v_disabled, NULL);
    RAISE EXCEPTION 'Aceptó sucursal inactiva';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Aceptó sucursal inactiva' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.siat_solicitar_operacion_factura_confirmada(v_invoice, 'ANULAR', v_admin, 1, true, true, v_key, v_branch, v_point);
    RAISE EXCEPTION 'Aceptó punto de otra sucursal';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Aceptó punto de otra sucursal' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.siat_solicitar_operacion_factura_confirmada(v_invoice, 'ANULAR', gen_random_uuid(), 1, true, true, v_key);
    RAISE EXCEPTION 'Aceptó usuario no autorizado';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Aceptó usuario no autorizado' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.siat_solicitar_operacion_factura_confirmada(v_invoice, 'ANULAR', v_admin, 1, false, true, v_key);
    RAISE EXCEPTION 'Aceptó operación sin confirmación';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Aceptó operación sin confirmación' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.siat_solicitar_operacion_factura_confirmada(v_invoice, 'ANULAR', v_admin, 1, true, false, v_key);
    RAISE EXCEPTION 'Aceptó operación sin declaración DDJJ';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Aceptó operación sin declaración DDJJ' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.siat_solicitar_operacion_factura_confirmada(v_expired, 'ANULAR', v_admin, 1, true, true, gen_random_uuid());
    RAISE EXCEPTION 'Aceptó operación fuera de plazo';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Aceptó operación fuera de plazo' THEN RAISE; END IF; END;
  v_result := public.siat_solicitar_operacion_factura_confirmada(v_invoice, 'ANULAR', v_admin, 1, true, true, v_key);
  IF v_result <> 'ANULACION_PENDIENTE' THEN RAISE EXCEPTION 'Estado incorrecto'; END IF;
  PERFORM public.siat_solicitar_operacion_factura_confirmada(v_invoice, 'ANULAR', v_admin, 1, true, true, v_key);
  BEGIN
    PERFORM public.siat_solicitar_operacion_factura_confirmada(v_reverse, 'REVERTIR_ANULACION', v_admin, NULL, true, NULL, v_key);
    RAISE EXCEPTION 'Aceptó identificador de otra solicitud';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Aceptó identificador de otra solicitud' THEN RAISE; END IF; END;
  SELECT count(*) INTO v_count FROM public.siat_outbox WHERE factura_id = v_invoice;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Idempotencia fallida'; END IF;
  PERFORM public.siat_solicitar_operacion_factura_confirmada(v_reverse, 'REVERTIR_ANULACION', v_admin, NULL, true, NULL, gen_random_uuid(), v_other, v_point);
  IF NOT EXISTS (SELECT 1 FROM public.siat_outbox WHERE factura_id = v_reverse AND payload->>'sucursalOperacionId' = v_other::text AND payload->>'puntoVentaOperacionId' = v_point::text) THEN RAISE EXCEPTION 'No se conservó la sucursal alternativa.'; END IF;
  UPDATE public.facturas_siat SET estado_fiscal = 'REVERTIDA', fecha_reversion = now() WHERE id = v_reverse;
  BEGIN
    PERFORM public.siat_solicitar_operacion_factura_confirmada(v_reverse, 'ANULAR', v_admin, 1, true, true, gen_random_uuid());
    RAISE EXCEPTION 'Aceptó anular factura revertida';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Aceptó anular factura revertida' THEN RAISE; END IF; END;
  BEGIN
    PERFORM public.siat_solicitar_operacion_factura_confirmada(v_reverse, 'REVERTIR_ANULACION', v_admin, NULL, true, NULL, gen_random_uuid());
    RAISE EXCEPTION 'Aceptó segunda reversión';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM = 'Aceptó segunda reversión' THEN RAISE; END IF; END;
END;
$$;
ROLLBACK;

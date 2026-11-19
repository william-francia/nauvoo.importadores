-- Prueba transaccional remota: ningún dato fiscal, comercial o de inventario persiste.
BEGIN;
DO $pilot_test$
DECLARE
  v_auth uuid;
  v_invoice uuid;
  v_movements bigint;
BEGIN
  SELECT count(*) INTO v_movements FROM public.movimientos_inventario;
  INSERT INTO public.siat_piloto_autorizaciones
    (actor_auth_user_id, cliente_id, producto_id, preview_hash, producto_descripcion_snapshot, precio_unitario, descuento)
  SELECT gen_random_uuid(), c.id, p.id, repeat('a', 64), p.nombre, 5, 0
  FROM public.clientes c CROSS JOIN public.productos p
  WHERE c.codigo_cliente = 'CLI-000006' AND p.codigo_interno = 'ph1234'
  RETURNING id INTO v_auth;
  IF v_auth IS NULL THEN RAISE EXCEPTION 'Fixture piloto no disponible'; END IF;

  INSERT INTO public.facturas_siat
    (origen_fiscal, piloto_autorizacion_id, venta_id, ambiente, modalidad,
     documento_sector, tipo_factura, tipo_emision, detalle_snapshot)
  VALUES ('PILOTO', v_auth, NULL, 'PRUEBAS', 'ELECTRONICA', 1, 1, 'ONLINE',
    jsonb_build_array(jsonb_build_object('descripcion',
      (SELECT producto_descripcion_snapshot FROM public.siat_piloto_autorizaciones WHERE id = v_auth))))
  RETURNING id INTO v_invoice;
  IF v_invoice IS NULL THEN RAISE EXCEPTION 'No se pudo persistir factura piloto sin venta'; END IF;

  BEGIN
    INSERT INTO public.facturas_siat
      (origen_fiscal, piloto_autorizacion_id, venta_id, ambiente, modalidad,
       documento_sector, tipo_factura, tipo_emision, detalle_snapshot)
    VALUES ('PILOTO', v_auth, NULL, 'PRUEBAS', 'ELECTRONICA', 1, 1, 'ONLINE',
      jsonb_build_array(jsonb_build_object('descripcion',
        (SELECT producto_descripcion_snapshot FROM public.siat_piloto_autorizaciones WHERE id = v_auth))));
    RAISE EXCEPTION 'La misma autorización generó dos facturas';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.facturas_siat (origen_fiscal, venta_id)
    VALUES ('VENTA', NULL);
    RAISE EXCEPTION 'La venta normal admitió venta_id nulo';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  IF (SELECT count(*) FROM public.movimientos_inventario) <> v_movements THEN
    RAISE EXCEPTION 'La factura piloto alteró el inventario';
  END IF;
  IF (SELECT emision_habilitada OR eku_fiscal_aprobado OR nit_cliente_verificado
      FROM public.siat_piloto_control WHERE id = true) THEN
    RAISE EXCEPTION 'El piloto fue habilitado por defecto';
  END IF;
  IF has_table_privilege('authenticated', 'public.siat_piloto_autorizaciones', 'INSERT')
     OR has_table_privilege('authenticated', 'public.siat_piloto_control', 'UPDATE')
     OR has_function_privilege('authenticated', 'public.siat_crear_factura_piloto_outbox(uuid,uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Permiso piloto expuesto a authenticated';
  END IF;
END;
$pilot_test$;
ROLLBACK;

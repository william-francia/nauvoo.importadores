-- Solo base sintética local; jamás ejecutar en el proyecto remoto.
BEGIN;
DO $$
DECLARE
  u uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); cliente uuid:=gen_random_uuid();
  prod uuid:=gen_random_uuid(); almacen uuid:=gen_random_uuid(); suc uuid:=gen_random_uuid(); agente uuid:=gen_random_uuid();
  cuis uuid:=gen_random_uuid(); cufd uuid:=gen_random_uuid(); evento uuid:=gen_random_uuid(); venta uuid:=gen_random_uuid(); factura uuid:=gen_random_uuid();
  payload jsonb; result uuid; ventas integer; movimientos integer; disponible numeric;
BEGIN
  IF current_database() !~ '^nuvoo_9b_(chain|concurrent)_[0-9a-f]{32}$' OR inet_server_addr() NOT IN ('127.0.0.1'::inet,'::1'::inet)
     OR current_setting('data_directory') NOT LIKE '%nuvoo9b_integral_%' THEN RAISE EXCEPTION 'BASE_SINTETICA_REQUERIDA'; END IF;
  INSERT INTO auth.users(id) VALUES(actor);
  SELECT id INTO STRICT u FROM public.usuarios WHERE auth_user_id=actor;
  INSERT INTO public.clientes(id,nombre_razon_social) VALUES(cliente,'Cliente sintetico');
  INSERT INTO public.productos(id,codigo_interno,nombre,precio_pieza) VALUES(prod,'TEST-PERNO','Perno sintetico',9);
  INSERT INTO public.almacenes(id,codigo,nombre) VALUES(almacen,'TEST-ALM','Almacen sintetico');
  INSERT INTO public.stock_por_almacen(producto_id,almacen_id,cantidad_disponible) VALUES(prod,almacen,10);
  INSERT INTO public.siat_producto_homologaciones(producto_id,codigo_interno_snapshot,codigo_producto_sin,actividad_economica,unidad_medida_sin,origen,estado) VALUES(prod,'TEST-PERNO','1003451','4752100','47','NACIONAL','HOMOLOGADO');
  INSERT INTO public.siat_sucursales(id,codigo,nombre) VALUES(suc,999,'Sucursal sintetica');
  INSERT INTO public.siat_agentes_locales(id,codigo,nombre,sucursal_id,version_agente,estado) VALUES(agente,'TEST-AGENT','Agente sintetico',suc,'test','ACTIVO');
  INSERT INTO public.siat_cuis(id,sucursal_id,ambiente,codigo,fecha_expiracion) VALUES(cuis,suc,'PRUEBAS','TEST-CUIS',now()+interval '1 day');
  INSERT INTO public.siat_cufd(id,sucursal_id,cuis_id,ambiente,codigo,codigo_control,fecha_expiracion) VALUES(cufd,suc,cuis,'PRUEBAS','TEST-CUFD','ABCD',now()+interval '1 day');
  INSERT INTO public.siat_eventos_significativos(id,sucursal_id,cufd_id,agente_local_id,tipo_evento_codigo,descripcion,fecha_inicio,fecha_fin,estado) VALUES(evento,suc,cufd,agente,'1','Evento sintetico',now()-interval '2 minutes',now()-interval '1 minute','CERRADO');
  INSERT INTO public.siat_configuracion(id,ambiente,siat_habilitado,version_normativa) VALUES(true,'PRUEBAS',false,'SIAT_VIGENTE') ON CONFLICT(id) DO UPDATE SET ambiente='PRUEBAS',siat_habilitado=false,version_normativa='SIAT_VIGENTE';
  payload:=jsonb_build_object('ventaId',venta,'facturaId',factura,'eventoId',evento,'idempotencyKey','test-importacion-real-0001','correlationId',gen_random_uuid(),'actorAuthUserId',actor,
    'codigoVenta','TEST-VENTA-1','clienteId',cliente,'metodoPago','EFECTIVO','descuentoVenta',0,'items',jsonb_build_array(jsonb_build_object('productoId',prod,'almacenId',almacen,'codigoProducto','TEST-PERNO','descripcion','Perno sintetico','cantidad',1,'precioUnitario',5,'descuento',0)),
    'modalidad','ELECTRONICA','documentoSector',1,'tipoFactura',1,'numeroFactura',1,'fechaEmision',now(),'cuf','ABC123','clienteSnapshot',jsonb_build_object('nombreRazonSocial','Cliente sintetico','codigoTipoDocumentoIdentidad',1,'numeroDocumento','12345'),
    'detalleSnapshot','[]'::jsonb,'totalesSnapshot',jsonb_build_object('montoTotal',5),'pagoSnapshot',jsonb_build_object('codigoMetodoPago',1),'xmlHash',repeat('A',64),'xmlFirmado',true,'qrContenido','test','origenCaja','TEST','payloadHash',repeat('A',64),
    'xmlDocumento','<factura/>','adjuntosHash',jsonb_build_object('xml',repeat('A',64),'pdf',repeat('B',64)));
  result:=public.siat_importar_factura_offline_v2('TEST-AGENT',payload);
  IF result IS DISTINCT FROM factura OR public.siat_importar_factura_offline_v2('TEST-AGENT',payload) IS DISTINCT FROM factura THEN RAISE EXCEPTION 'IMPORTACION_NO_IDEMPOTENTE'; END IF;
  SELECT count(*) INTO ventas FROM public.ventas WHERE id=venta AND estado='confirmada' AND inventario_aplicado=true AND total=5;
  SELECT count(*) INTO movimientos FROM public.movimientos_inventario WHERE venta_id=venta AND tipo_movimiento='salida' AND cantidad=1;
  SELECT cantidad_disponible INTO disponible FROM public.stock_por_almacen WHERE producto_id=prod AND almacen_id=almacen;
  IF ventas<>1 OR movimientos<>1 OR disponible<>9 OR NOT EXISTS(SELECT 1 FROM public.facturas_siat WHERE id=factura AND venta_id=venta)
    OR (SELECT precio_pieza FROM public.productos WHERE id=prod)<>9 THEN RAISE EXCEPTION 'VENTA_O_INVENTARIO_INCONSISTENTE'; END IF;
  BEGIN
    PERFORM public.siat_importar_factura_offline_v2('TEST-AGENT',jsonb_set(payload,'{totalesSnapshot,montoTotal}','6'::jsonb));
    RAISE EXCEPTION 'ACEPTO_CAMBIO';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='ACEPTO_CAMBIO' THEN RAISE; END IF; END;
  RAISE NOTICE 'Importador real: una venta, una factura, una salida, precio histórico correcto; reintento idempotente.';
END $$;
ROLLBACK;

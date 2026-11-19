-- La importación manual nunca debe crear una venta ni repetir inventario.
ALTER FUNCTION public.siat_importar_factura_offline_v2(text,jsonb) RENAME TO siat_9b_importar_offline_digital_interna;
REVOKE ALL ON FUNCTION public.siat_9b_importar_offline_digital_interna(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.siat_importar_factura_offline_v2(p_agente_codigo text,p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF COALESCE((p_payload->>'esManualCafc')::boolean,false) OR NULLIF(p_payload->>'cafcId','') IS NOT NULL
    OR NULLIF(p_payload->>'numeroManual','') IS NOT NULL OR NULLIF(p_payload->>'evidenciaOriginalStoragePath','') IS NOT NULL
    OR NULLIF(p_payload->'totalesSnapshot'->>'cafc','') IS NOT NULL THEN RAISE EXCEPTION 'CAFC_REQUIERE_VINCULACION_VENTA_EXISTENTE'; END IF;
  IF COALESCE(p_payload->>'xmlDocumento','')='' OR p_payload->>'xmlDocumento' ~* '<!(DOCTYPE|ENTITY)' THEN RAISE EXCEPTION 'XML_OFFLINE_NO_VERIFICABLE'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(xpath('//*[local-name()="cafc"]/text()',xmlparse(document p_payload->>'xmlDocumento'))) AS x WHERE NULLIF(trim(x::text),'') IS NOT NULL) THEN
    RAISE EXCEPTION 'CAFC_REQUIERE_VINCULACION_VENTA_EXISTENTE';
  END IF;
  RETURN public.siat_9b_importar_offline_digital_interna(p_agente_codigo,p_payload);
END; $$;
REVOKE ALL ON FUNCTION public.siat_importar_factura_offline_v2(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.siat_importar_factura_offline_v2(text,jsonb) TO service_role;

-- Un evento manual debe conservar su CAFC desde la primera importación.
ALTER FUNCTION public.siat_importar_evento_offline(text,jsonb) RENAME TO siat_9b_importar_evento_interna;
REVOKE ALL ON FUNCTION public.siat_9b_importar_evento_interna(text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.siat_importar_evento_offline(p_agente_codigo text,p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  RAISE EXCEPTION 'IMPORTACION_EVENTO_CONTRATO_V1_DESHABILITADO';
END; $$;
REVOKE ALL ON FUNCTION public.siat_importar_evento_offline(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.siat_importar_evento_offline(text,jsonb) TO service_role;
CREATE FUNCTION public.siat_importar_evento_offline_v2(p_agente_codigo text,p_payload jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.siat_agentes_locales%ROWTYPE; e public.siat_eventos_significativos%ROWTYPE;
  v_id uuid:=(p_payload->>'id')::uuid; v_cafc uuid:=NULLIF(p_payload->>'cafcId','')::uuid; result uuid;
BEGIN
  SELECT * INTO a FROM public.siat_agentes_locales WHERE codigo=p_agente_codigo AND estado<>'BLOQUEADO' FOR SHARE;
  IF NOT FOUND OR v_id IS NULL THEN RAISE EXCEPTION 'EVENTO_AGENTE_INVALIDO'; END IF;
  IF v_cafc IS NOT NULL AND (COALESCE(p_payload->>'tipoEventoCodigo','') NOT IN ('5','6','7') OR NOT EXISTS (
    SELECT 1 FROM public.siat_rangos_cafc r WHERE r.id=v_cafc AND r.estado='VIGENTE' AND r.sucursal_id=a.sucursal_id
      AND r.punto_venta_id IS NOT DISTINCT FROM a.punto_venta_id AND (p_payload->>'fechaInicio')::timestamptz < r.vigente_hasta
      AND (p_payload->>'fechaFin')::timestamptz >= r.vigente_desde)) THEN RAISE EXCEPTION 'EVENTO_CAFC_INVALIDO'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_id::text,1));
  SELECT * INTO e FROM public.siat_eventos_significativos WHERE id=v_id FOR UPDATE;
  IF FOUND THEN
    IF e.agente_local_id IS DISTINCT FROM a.id OR e.cafc_id IS DISTINCT FROM v_cafc OR e.cufd_id IS DISTINCT FROM (p_payload->>'cufdId')::uuid
      OR e.tipo_evento_codigo IS DISTINCT FROM p_payload->>'tipoEventoCodigo' OR e.fecha_inicio IS DISTINCT FROM (p_payload->>'fechaInicio')::timestamptz
      OR e.fecha_fin IS DISTINCT FROM (p_payload->>'fechaFin')::timestamptz OR e.descripcion IS DISTINCT FROM p_payload->>'descripcion'
      OR e.evidencia_deteccion IS DISTINCT FROM COALESCE(p_payload->'evidencia','{}'::jsonb)
      OR e.actor_auth_user_id IS DISTINCT FROM NULLIF(p_payload->>'actorAuthUserId','')::uuid
      OR e.origen IS DISTINCT FROM (CASE WHEN COALESCE((p_payload->>'automatico')::boolean,false) THEN 'AUTOMATICO' ELSE 'MANUAL_ADMINISTRATIVO' END) THEN RAISE EXCEPTION 'EVENTO_IDEMPOTENCIA_CONTENIDO_DISTINTO'; END IF;
    RETURN e.id;
  END IF;
  result:=public.siat_9b_importar_evento_interna(p_agente_codigo,p_payload);
  IF result IS DISTINCT FROM v_id THEN RAISE EXCEPTION 'EVENTO_RESULTADO_INVALIDO'; END IF;
  UPDATE public.siat_eventos_significativos SET cafc_id=v_cafc WHERE id=result AND agente_local_id=a.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'EVENTO_RESULTADO_INVALIDO'; END IF;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.siat_importar_evento_offline_v2(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.siat_importar_evento_offline_v2(text,jsonb) TO service_role;

CREATE TABLE public.siat_9b_cafc_vinculos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), idempotency_key text NOT NULL UNIQUE,
  factura_id uuid NOT NULL UNIQUE, venta_id uuid UNIQUE REFERENCES public.ventas(id) ON DELETE RESTRICT,
  venta_propuesta_id uuid, evento_id uuid NOT NULL REFERENCES public.siat_eventos_significativos(id) ON DELETE RESTRICT,
  cafc_id uuid NOT NULL REFERENCES public.siat_rangos_cafc(id) ON DELETE RESTRICT,
  cufd_id uuid NOT NULL REFERENCES public.siat_cufd(id) ON DELETE RESTRICT,
  agente_id uuid NOT NULL REFERENCES public.siat_agentes_locales(id) ON DELETE RESTRICT,
  numero bigint NOT NULL, contenido_sha256 text NOT NULL CHECK (contenido_sha256 ~ '^[A-F0-9]{64}$'),
  evidencia_sha256 text NOT NULL CHECK (evidencia_sha256 ~ '^[A-F0-9]{64}$'), evidencia_path text NOT NULL,
  xml_sha256 text NOT NULL CHECK (xml_sha256 ~ '^[A-F0-9]{64}$'), xml_path text NOT NULL,
  estado text NOT NULL CHECK (estado IN ('PENDIENTE_CONCILIACION','VINCULADA')),
  actor_auth_user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), vinculado_at timestamptz,
  UNIQUE(cafc_id,numero)
);
ALTER TABLE public.siat_9b_cafc_vinculos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.siat_9b_cafc_vinculos FROM PUBLIC,anon,authenticated,service_role;

-- p se construye exclusivamente en el gateway tras verificar XMLDSig, XSD y adjuntos.
CREATE FUNCTION public.siat_9b_vincular_cafc(p jsonb,p_venta uuid,p_actor uuid,p_confirmacion boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_id uuid:=(p->>'facturaId')::uuid; v_evento_id uuid:=(p->>'eventoId')::uuid; v_cafc_id uuid:=(p->>'cafcId')::uuid;
  v_agente_id uuid:=(p->>'agenteId')::uuid; v_numero bigint:=(p->>'numeroFactura')::bigint;
  v_key text:=p->>'idempotencyKey'; v_hash text; v_venta public.ventas%ROWTYPE; v_cliente public.clientes%ROWTYPE;
  v_evento public.siat_eventos_significativos%ROWTYPE; v_cufd public.siat_cufd%ROWTYPE; v_cuis public.siat_cuis%ROWTYPE;
  v_rango public.siat_rangos_cafc%ROWTYPE; v_sucursal public.siat_sucursales%ROWTYPE; v_punto public.siat_puntos_venta%ROWTYPE;
  v_link public.siat_9b_cafc_vinculos%ROWTYPE; v_num_doc integer; v_fecha timestamptz:=(p->>'fechaEmision')::timestamptz;
BEGIN
  IF p_confirmacion IS DISTINCT FROM true OR NOT EXISTS (SELECT 1 FROM public.usuarios WHERE auth_user_id=p_actor AND activo AND lower(rol)='administrador') THEN RAISE EXCEPTION 'CAFC_ADMIN_CONFIRMACION_REQUERIDA'; END IF;
  IF v_id IS NULL OR v_numero IS NULL OR v_numero<1 OR v_fecha IS NULL OR COALESCE(p->>'cuf','') !~ '^[A-F0-9]{1,100}$'
    OR v_id IN ('c2279bbb-e851-468b-afe6-8ebf0b436d28'::uuid,'08dd889e-f2f7-4acb-be2e-2f911aae9919'::uuid)
    OR v_key IS NULL OR v_key !~ '^[A-Za-z0-9:_-]{16,160}$' OR COALESCE(p->>'xmlHash','') !~ '^[A-F0-9]{64}$'
    OR COALESCE(p->>'evidenciaHash','') !~ '^[A-F0-9]{64}$' OR p->>'xmlPath' IS DISTINCT FROM 'cafc/'||v_evento_id::text||'/'||v_id::text||'/firmado.xml.gz'
    OR p->>'evidenciaPath' IS DISTINCT FROM 'cafc/'||v_evento_id::text||'/'||v_id::text||'/original.bin'
    OR jsonb_typeof(p->'detalleSnapshot') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'detalleSnapshot') NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'CAFC_DATOS_INCOMPLETOS'; END IF;
  v_hash:=upper(encode(sha256(convert_to(p::text,'UTF8')),'hex'));
  PERFORM pg_advisory_xact_lock(hashtextextended(v_key,0));
  SELECT * INTO v_link FROM public.siat_9b_cafc_vinculos WHERE idempotency_key=v_key FOR UPDATE;
  IF FOUND AND (v_link.contenido_sha256<>v_hash OR v_link.factura_id<>v_id) THEN RAISE EXCEPTION 'CAFC_IDEMPOTENCIA_CONTENIDO_DISTINTO'; END IF;
  IF FOUND AND v_link.estado='VINCULADA' THEN
    IF v_link.venta_id IS DISTINCT FROM p_venta THEN RAISE EXCEPTION 'CAFC_YA_VINCULADA_OTRA_VENTA'; END IF;
    RETURN jsonb_build_object('estado','VINCULADA','facturaId',v_link.factura_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.siat_configuracion WHERE id=true AND ambiente='PRUEBAS' AND modalidad='ELECTRONICA' AND siat_habilitado=false AND nit=p->>'nit') THEN RAISE EXCEPTION 'CAFC_SOLO_PILOTO'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='siat-documentos' AND name=p->>'xmlPath')
    OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='siat-documentos' AND name=p->>'evidenciaPath') THEN RAISE EXCEPTION 'CAFC_ADJUNTOS_NO_DISPONIBLES'; END IF;
  SELECT * INTO v_evento FROM public.siat_eventos_significativos WHERE id=v_evento_id AND agente_local_id=v_agente_id FOR SHARE;
  IF NOT FOUND OR v_evento.tipo_evento_codigo NOT IN ('5','6','7') OR v_evento.fecha_fin IS NULL OR v_evento.fecha_fin>now() OR now()>v_evento.fecha_fin+interval '72 hours' OR v_fecha NOT BETWEEN v_evento.fecha_inicio AND v_evento.fecha_fin
    OR v_evento.cafc_id IS DISTINCT FROM v_cafc_id THEN RAISE EXCEPTION 'CAFC_EVENTO_INVALIDO'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.siat_agentes_locales WHERE id=v_agente_id AND estado<>'BLOQUEADO' AND sucursal_id=v_evento.sucursal_id AND punto_venta_id IS NOT DISTINCT FROM v_evento.punto_venta_id) THEN RAISE EXCEPTION 'CAFC_AGENTE_INVALIDO'; END IF;
  SELECT * INTO v_cufd FROM public.siat_cufd WHERE id=v_evento.cufd_id;
  SELECT * INTO v_rango FROM public.siat_rangos_cafc WHERE id=v_cafc_id FOR SHARE;
  IF v_cufd.id IS NULL OR v_rango.id IS NULL OR v_cufd.ambiente<>'PRUEBAS' OR v_cufd.sucursal_id<>v_evento.sucursal_id OR v_rango.sucursal_id<>v_evento.sucursal_id
    OR v_cufd.punto_venta_id IS DISTINCT FROM v_evento.punto_venta_id OR v_rango.punto_venta_id IS DISTINCT FROM v_evento.punto_venta_id
    OR v_evento.fecha_inicio < v_cufd.fecha_inicio OR v_evento.fecha_inicio >= v_cufd.fecha_expiracion
    OR v_rango.estado<>'VIGENTE' OR v_fecha NOT BETWEEN v_rango.vigente_desde AND v_rango.vigente_hasta
    OR v_numero NOT BETWEEN v_rango.rango_desde AND v_rango.rango_hasta OR p->>'cufd' IS DISTINCT FROM v_cufd.codigo OR p->>'cafc' IS DISTINCT FROM v_rango.autorizacion THEN RAISE EXCEPTION 'CAFC_RANGO_O_CUFD_INVALIDO'; END IF;
  SELECT * INTO v_cuis FROM public.siat_cuis WHERE id=v_cufd.cuis_id;
  SELECT * INTO v_sucursal FROM public.siat_sucursales WHERE id=v_evento.sucursal_id;
  IF v_evento.punto_venta_id IS NOT NULL THEN SELECT * INTO v_punto FROM public.siat_puntos_venta WHERE id=v_evento.punto_venta_id; END IF;
  IF v_cuis.id IS NULL OR v_sucursal.id IS NULL OR (p->>'codigoSucursal')::integer IS DISTINCT FROM v_sucursal.codigo
    OR (p->>'codigoPuntoVenta')::integer IS DISTINCT FROM COALESCE(v_punto.codigo,0) THEN RAISE EXCEPTION 'CAFC_SUCURSAL_INVALIDA'; END IF;
  IF v_link.id IS NULL THEN
    INSERT INTO public.siat_9b_cafc_vinculos(idempotency_key,factura_id,venta_propuesta_id,evento_id,cafc_id,cufd_id,agente_id,numero,contenido_sha256,evidencia_sha256,evidencia_path,xml_sha256,xml_path,estado,actor_auth_user_id)
      VALUES(v_key,v_id,p_venta,v_evento_id,v_cafc_id,v_cufd.id,v_agente_id,v_numero,v_hash,p->>'evidenciaHash',p->>'evidenciaPath',p->>'xmlHash',p->>'xmlPath','PENDIENTE_CONCILIACION',p_actor) RETURNING * INTO v_link;
    INSERT INTO public.siat_auditoria(actor_auth_user_id,entidad,entidad_id,accion,contexto) VALUES(p_actor,'siat_9b_cafc_vinculos',v_link.id::text,'CAFC_CONCILIACION_INICIADA',jsonb_build_object('facturaId',v_id,'ventaPropuestaId',p_venta,'eventoId',v_evento_id,'cafcId',v_cafc_id,'evidenciaHash',p->>'evidenciaHash'));
  END IF;
  IF p_venta IS NULL THEN RETURN jsonb_build_object('estado','PENDIENTE_CONCILIACION','facturaId',v_id,'motivo','No se indicó una venta original'); END IF;
  INSERT INTO public.siat_auditoria(actor_auth_user_id,entidad,entidad_id,accion,contexto) VALUES(p_actor,'siat_9b_cafc_vinculos',v_link.id::text,'CAFC_VENTA_PROPUESTA',jsonb_build_object('ventaId',p_venta));
  SELECT * INTO v_venta FROM public.ventas WHERE id=p_venta FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('estado','PENDIENTE_CONCILIACION','facturaId',v_id,'motivo','La venta original indicada no existe'); END IF;
  SELECT * INTO v_cliente FROM public.clientes WHERE id=v_venta.cliente_id;
  v_num_doc:=CASE upper(COALESCE(v_cliente.tipo_documento,'')) WHEN 'CI' THEN 1 WHEN 'CEX' THEN 2 WHEN 'CE' THEN 2 WHEN 'PASAPORTE' THEN 3 WHEN 'OTRO' THEN 4 WHEN 'OD' THEN 4 WHEN 'NIT' THEN 5 ELSE NULL END;
  IF v_venta.estado IS DISTINCT FROM 'confirmada' OR v_venta.inventario_aplicado IS DISTINCT FROM true THEN RETURN jsonb_build_object('estado','PENDIENTE_CONCILIACION','facturaId',v_id,'motivo','La venta no está confirmada o no tiene inventario aplicado'); END IF;
  IF v_cliente.id IS NULL OR v_cliente.numero_documento IS DISTINCT FROM p->>'numeroDocumento' OR v_cliente.nombre_razon_social IS DISTINCT FROM p->>'nombreRazonSocial'
    OR v_num_doc IS DISTINCT FROM (p->>'tipoDocumento')::integer OR COALESCE(v_cliente.complemento,'') IS DISTINCT FROM COALESCE(p->>'complemento','') THEN RETURN jsonb_build_object('estado','PENDIENTE_CONCILIACION','facturaId',v_id,'motivo','Los datos del cliente no coinciden con la venta'); END IF;
  IF v_venta.total IS DISTINCT FROM (p->>'montoTotal')::numeric OR v_venta.descuento_venta IS DISTINCT FROM COALESCE((p->>'descuentoAdicional')::numeric,0) THEN RETURN jsonb_build_object('estado','PENDIENTE_CONCILIACION','facturaId',v_id,'motivo','El total o descuento no coincide con la venta'); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.siat_metodo_pago_mapeos WHERE metodo_interno=v_venta.metodo_pago AND codigo_metodo_pago=(p->>'codigoMetodoPago')::integer AND version_normativa='SIAT_VIGENTE') THEN RETURN jsonb_build_object('estado','PENDIENTE_CONCILIACION','facturaId',v_id,'motivo','El método de pago no coincide con la venta'); END IF;
  IF EXISTS (SELECT 1 FROM public.facturas_siat WHERE venta_id=p_venta) THEN RETURN jsonb_build_object('estado','PENDIENTE_CONCILIACION','facturaId',v_id,'motivo','La venta ya tiene una factura fiscal'); END IF;
  IF EXISTS (
    (SELECT COALESCE(d.codigo_producto_snapshot,''),COALESCE(d.descripcion_producto,''),d.cantidad,d.precio_unitario,d.descuento,d.subtotal FROM public.detalle_ventas d WHERE d.venta_id=p_venta
     EXCEPT ALL SELECT x."codigoProducto",x.descripcion,x.cantidad,x."precioUnitario",COALESCE(x.descuento,0),x.subtotal FROM jsonb_to_recordset(p->'detalleSnapshot') AS x("codigoProducto" text,descripcion text,cantidad numeric,"precioUnitario" numeric,descuento numeric,subtotal numeric))
    UNION ALL
    (SELECT x."codigoProducto",x.descripcion,x.cantidad,x."precioUnitario",COALESCE(x.descuento,0),x.subtotal FROM jsonb_to_recordset(p->'detalleSnapshot') AS x("codigoProducto" text,descripcion text,cantidad numeric,"precioUnitario" numeric,descuento numeric,subtotal numeric)
     EXCEPT ALL SELECT COALESCE(d.codigo_producto_snapshot,''),COALESCE(d.descripcion_producto,''),d.cantidad,d.precio_unitario,d.descuento,d.subtotal FROM public.detalle_ventas d WHERE d.venta_id=p_venta)
  ) THEN RETURN jsonb_build_object('estado','PENDIENTE_CONCILIACION','facturaId',v_id,'motivo','El detalle no coincide con los datos históricos de la venta'); END IF;
  INSERT INTO public.facturas_siat(id,venta_id,origen_fiscal,idempotency_key,correlation_id,ambiente,version_especificacion,modalidad,documento_sector,tipo_factura,
    sucursal_id,punto_venta_id,cuis_id,cufd_id,tipo_emision,estado_fiscal,numero_factura,fecha_emision,codigo_sucursal,codigo_punto_venta,cuis,cufd,cuf,
    nombre_razon_social,tipo_documento,numero_documento,complemento,monto_total,cliente_snapshot,detalle_snapshot,totales_snapshot,pago_snapshot,
    sucursal_snapshot,punto_venta_snapshot,xml_hash,xml_firmado,xml_storage_path,qr_contenido,evento_id,agente_local_id,origen_caja,local_created_at,
    estado_sincronizacion,es_manual_cafc,cafc_id,numero_manual,evidencia_original_storage_path,version_xsd,hash_xsd)
  VALUES(v_id,p_venta,'VENTA',v_key,(p->>'correlationId')::uuid,'PRUEBAS','SIAT_VIGENTE','ELECTRONICA',1,1,
    v_evento.sucursal_id,v_evento.punto_venta_id,v_cuis.id,v_cufd.id,'OFFLINE','OFFLINE',v_numero,v_fecha,v_sucursal.codigo,COALESCE(v_punto.codigo,0),v_cuis.codigo,v_cufd.codigo,p->>'cuf',
    p->>'nombreRazonSocial',p->>'tipoDocumento',p->>'numeroDocumento',NULLIF(p->>'complemento',''),v_venta.total,p->'clienteSnapshot',p->'detalleSnapshot',p->'totalesSnapshot',p->'pagoSnapshot',
    to_jsonb(v_sucursal),CASE WHEN v_punto.id IS NULL THEN '{}'::jsonb ELSE to_jsonb(v_punto) END,p->>'xmlHash',true,p->>'xmlPath',p->>'qrContenido',v_evento.id,v_agente_id,p->>'origenCaja',v_fecha,
    'SINCRONIZADA',true,v_cafc_id,v_numero,p->>'evidenciaPath','SIAT_VIGENTE',p->>'hashXsd');
  INSERT INTO public.siat_cafc_usos(rango_cafc_id,numero,factura_id,evento_id,agente_id,estado,evidencia_storage_path) VALUES(v_cafc_id,v_numero,v_id,v_evento.id,v_agente_id,'UTILIZADO',p->>'evidenciaPath');
  INSERT INTO public.siat_importaciones_offline(agente_id,idempotency_key,venta_id,factura_id,evento_id,origen_caja,payload_hash) VALUES(v_agente_id,v_key,p_venta,v_id,v_evento.id,COALESCE(p->>'origenCaja','CAFC'),v_hash);
  INSERT INTO public.siat_9b_importacion_huellas(idempotency_key,agente_id,factura_id,contenido_sha256) VALUES(v_key,v_agente_id,v_id,v_hash);
  UPDATE public.siat_9b_cafc_vinculos SET venta_id=p_venta,venta_propuesta_id=p_venta,estado='VINCULADA',actor_auth_user_id=p_actor,vinculado_at=now() WHERE id=v_link.id;
  INSERT INTO public.siat_auditoria(actor_auth_user_id,entidad,entidad_id,accion,contexto) VALUES(p_actor,'facturas_siat',v_id::text,'CAFC_VINCULADA_VENTA_EXISTENTE',jsonb_build_object('ventaId',p_venta,'eventoId',v_evento.id,'cafcId',v_cafc_id,'cufdId',v_cufd.id,'evidenciaHash',p->>'evidenciaHash','xmlHash',p->>'xmlHash'));
  RETURN jsonb_build_object('estado','VINCULADA','facturaId',v_id);
END; $$;
REVOKE ALL ON FUNCTION public.siat_9b_vincular_cafc(jsonb,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.siat_9b_vincular_cafc(jsonb,uuid,uuid,boolean) TO service_role;

-- Finalizaci?n idempotente: preservar recepci?n y estados oficiales.
CREATE OR REPLACE FUNCTION public.siat_programar_recuperacion_evento(p_evento_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_evento public.siat_eventos_significativos%ROWTYPE;
BEGIN
  SELECT * INTO v_evento FROM public.siat_eventos_significativos WHERE id = p_evento_id FOR UPDATE;
  IF NOT FOUND OR v_evento.fecha_fin IS NULL THEN RAISE EXCEPTION 'Evento cerrado no encontrado.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.facturas_siat WHERE evento_id = p_evento_id AND tipo_emision = 'OFFLINE') THEN
    RAISE EXCEPTION 'El evento no contiene facturas offline.';
  END IF;
  INSERT INTO public.siat_outbox (factura_id, tipo_tarea, payload, estado, idempotency_key)
  VALUES (NULL, 'REGISTRAR_EVENTO', jsonb_build_object('eventoId', p_evento_id), 'PENDIENTE', 'registrar_evento:' || p_evento_id::text)
  ON CONFLICT (idempotency_key) DO NOTHING;
  IF FOUND THEN UPDATE public.siat_eventos_significativos SET estado = 'CERRADO' WHERE id = p_evento_id; END IF;
  RETURN 'EN_COLA';
END;
$$;

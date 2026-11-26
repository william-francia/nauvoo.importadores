-- Confirmación comercial idempotente; reutiliza registrar_venta_fiscal y su trigger SIAT.
CREATE TABLE public.siat_checkout_ventas (
  id uuid PRIMARY KEY,
  actor uuid NOT NULL REFERENCES auth.users(id),
  solicitud jsonb NOT NULL,
  venta_id uuid UNIQUE REFERENCES public.ventas(id),
  factura_id uuid UNIQUE REFERENCES public.facturas_siat(id),
  canal text NOT NULL CHECK(canal IN ('NINGUNO','CORREO','WHATSAPP')),
  destinatario text,
  consentimiento boolean NOT NULL,
  entrega_estado text NOT NULL DEFAULT 'PENDIENTE' CHECK(entrega_estado IN ('PENDIENTE','NO_SOLICITADA','CONFIGURACION_PENDIENTE','ENVIANDO','ENVIADA','INCIERTA')),
  entrega_evidencia text,
  created_at timestamptz NOT NULL DEFAULT now(),
  entrega_at timestamptz,
  CHECK(canal='NINGUNO' OR (consentimiento AND length(trim(destinatario))>0))
);
ALTER TABLE public.siat_checkout_ventas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.siat_checkout_ventas FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.siat_checkout_ventas TO authenticated;
GRANT ALL ON public.siat_checkout_ventas TO service_role;
CREATE POLICY checkout_lectura ON public.siat_checkout_ventas FOR SELECT TO authenticated
 USING(actor=auth.uid() OR EXISTS(SELECT 1 FROM usuarios WHERE auth_user_id=auth.uid() AND activo AND rol='administrador'));

CREATE TABLE public.siat_cliente_nit_evidencias (
 cliente_id uuid PRIMARY KEY REFERENCES public.clientes(id), documento text NOT NULL,
 ambiente text NOT NULL CHECK(ambiente='PRUEBAS'), codigo integer NOT NULL CHECK(codigo=986),
 transaccion boolean NOT NULL CHECK(transaccion), verificado_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.siat_cliente_nit_evidencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.siat_cliente_nit_evidencias FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.siat_cliente_nit_evidencias TO service_role;

CREATE FUNCTION public.siat_preflight_venta(p_venta jsonb,p_codigos boolean DEFAULT true)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.siat_configuracion%ROWTYPE; cl public.clientes%ROWTYPE; item jsonb; h public.siat_producto_homologaciones%ROWTYPE;
BEGIN
 IF NOT public.app_has_permission('sales.create') THEN RAISE EXCEPTION 'Sin permiso de venta.'; END IF;
 SELECT * INTO c FROM siat_configuracion WHERE id=true;
 IF c.ambiente IS DISTINCT FROM 'PRUEBAS' OR c.siat_habilitado IS DISTINCT FROM true THEN RAISE EXCEPTION 'EMISION_VENTAS_PILOTO_NO_HABILITADA'; END IF;
 IF EXISTS(SELECT 1 FROM siat_bloques_numeracion_offline WHERE ambiente=c.ambiente AND sucursal_id=c.sucursal_predeterminada_id AND punto_venta_id IS NOT DISTINCT FROM c.punto_venta_predeterminado_id AND estado_reserva='ABIERTA') THEN RAISE EXCEPTION 'EMISION_ONLINE_PAUSADA_POR_RESERVA_OFFLINE'; END IF;
 SELECT * INTO cl FROM clientes WHERE id=(p_venta->>'cliente_id')::uuid AND activo;
 IF NOT FOUND OR nullif(trim(cl.nombre_razon_social),'') IS NULL OR nullif(trim(cl.numero_documento),'') IS NULL THEN RAISE EXCEPTION 'Identificacion fiscal del cliente incompleta.'; END IF;
 IF p_codigos AND cl.tipo_documento='NIT' AND NOT EXISTS(SELECT 1 FROM siat_cliente_nit_evidencias WHERE cliente_id=cl.id AND documento=cl.numero_documento AND ambiente=c.ambiente AND verificado_at>now()-interval '24 hours' AND codigo=986 AND transaccion) THEN RAISE EXCEPTION 'NIT_REQUIERE_VERIFICACION_OFICIAL'; END IF;
 IF jsonb_typeof(p_venta->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_venta->'items')=0 THEN RAISE EXCEPTION 'Venta sin detalle.'; END IF;
 FOR item IN SELECT * FROM jsonb_array_elements(p_venta->'items') LOOP
  SELECT * INTO h FROM siat_producto_homologaciones WHERE producto_id=(item->>'producto_id')::uuid AND estado='HOMOLOGADO' AND version_normativa=c.version_normativa;
  IF NOT FOUND OR h.actividad_economica IS DISTINCT FROM c.actividad_economica THEN RAISE EXCEPTION 'Producto % sin homologacion fiscal valida; revisar codigo SIN, unidad y origen.',item->>'producto_id'; END IF;
  IF NOT EXISTS(SELECT 1 FROM siat_catalogos k JOIN siat_catalogo_items i ON i.catalogo_id=k.id WHERE k.codigo='PRODUCTOS_SERVICIOS' AND k.estado='VIGENTE' AND k.version_normativa=c.version_normativa AND i.activo AND i.codigo=h.codigo_producto_sin::text AND coalesce(i.metadatos->>'codigoActividad',i.metadatos->>'actividadEconomica')=h.actividad_economica)
   OR NOT EXISTS(SELECT 1 FROM siat_catalogos k JOIN siat_catalogo_items i ON i.catalogo_id=k.id WHERE k.codigo='UNIDADES_MEDIDA' AND k.estado='VIGENTE' AND k.version_normativa=c.version_normativa AND i.activo AND i.codigo=h.unidad_medida_sin::text) THEN RAISE EXCEPTION 'Homologacion fuera del catalogo vigente.'; END IF;
 END LOOP;
 IF p_codigos AND NOT EXISTS(SELECT 1 FROM siat_cuis u JOIN siat_cufd d ON d.cuis_id=u.id WHERE u.ambiente=c.ambiente AND u.sucursal_id=c.sucursal_predeterminada_id AND u.punto_venta_id IS NOT DISTINCT FROM c.punto_venta_predeterminado_id AND u.estado='VIGENTE' AND u.fecha_expiracion>now() AND d.estado='VIGENTE' AND d.ambiente=u.ambiente AND d.sucursal_id=u.sucursal_id AND d.punto_venta_id IS NOT DISTINCT FROM u.punto_venta_id AND d.fecha_inicio<=now() AND d.fecha_expiracion>now()) THEN RAISE EXCEPTION 'CUIS_CUFD_NO_VIGENTE'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.siat_preflight_venta(jsonb,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.siat_preflight_venta(jsonb,boolean) TO authenticated;

CREATE FUNCTION public.registrar_venta_checkout(p_id uuid,p_venta jsonb,p_entrega jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE previo public.siat_checkout_ventas%ROWTYPE; v record; f uuid; solicitud jsonb:=jsonb_build_object('venta',p_venta,'entrega',p_entrega);
BEGIN
 IF auth.uid() IS NULL OR NOT public.app_has_permission('sales.create') THEN RAISE EXCEPTION 'Sin permiso de venta.'; END IF;
 IF p_id IS NULL THEN RAISE EXCEPTION 'Identificador requerido.'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('checkout:'||p_id::text,0));
 SELECT * INTO previo FROM siat_checkout_ventas WHERE id=p_id;
 IF FOUND THEN
  IF previo.actor<>auth.uid() OR previo.solicitud<>solicitud THEN RAISE EXCEPTION 'IDEMPOTENCIA_NO_COINCIDE'; END IF;
  RETURN jsonb_build_object('ventaId',previo.venta_id,'facturaId',previo.factura_id,'reutilizada',true);
 END IF;
 PERFORM siat_preflight_venta(p_venta,true);
 INSERT INTO siat_checkout_ventas(id,actor,solicitud,canal,destinatario,consentimiento,entrega_estado)
 VALUES(p_id,auth.uid(),solicitud,p_entrega->>'canal',nullif(trim(p_entrega->>'destinatario'),''),coalesce((p_entrega->>'consentimiento')::boolean,false),CASE WHEN p_entrega->>'canal'='NINGUNO' THEN 'NO_SOLICITADA' ELSE 'PENDIENTE' END);
 SELECT * INTO v FROM registrar_venta_fiscal((p_venta->>'cliente_id')::uuid,p_venta->>'metodo_pago',p_venta->>'observacion',(p_venta->>'descuento_venta')::numeric,p_venta->>'tarjeta_ofuscada',p_venta->'items');
 -- El trigger puede haber creado la factura; esta RPC es idempotente por venta.
 f:=siat_crear_factura_outbox(v.venta_id);
 IF f IS NULL THEN RAISE EXCEPTION 'No se preparo la factura de la venta.'; END IF;
 UPDATE siat_checkout_ventas SET venta_id=v.venta_id,factura_id=f WHERE id=p_id;
 INSERT INTO siat_auditoria(actor_auth_user_id,entidad,entidad_id,accion,contexto) VALUES(auth.uid(),'ventas',v.venta_id::text,'CHECKOUT_CONFIRMADO',jsonb_build_object('facturaId',f,'idempotencia',p_id));
 RETURN jsonb_build_object('ventaId',v.venta_id,'facturaId',f,'reutilizada',false);
END $$;
REVOKE ALL ON FUNCTION public.registrar_venta_checkout(uuid,jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.registrar_venta_checkout(uuid,jsonb,jsonb) TO authenticated;

-- Amplía 9A únicamente a facturas de este checkout, sin tocar la elegibilidad histórica.
CREATE FUNCTION public.siat_documento_checkout_9a(p_factura uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM facturas_siat f JOIN siat_checkout_ventas c ON c.factura_id=f.id AND c.venta_id=f.venta_id
 WHERE f.id=p_factura AND f.origen_fiscal='VENTA' AND f.ambiente='PRUEBAS')
$$;
REVOKE ALL ON FUNCTION public.siat_documento_checkout_9a(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.siat_documento_checkout_9a(uuid) TO service_role;
DO $$
DECLARE p record; original text; actualizado text;
BEGIN
 FOR p IN SELECT oid,proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN (
 'siat_solicitar_operacion_factura_confirmada','siat_9a_guardar_notificacion','siat_9a_guardar_revision','siat_9a_reservar_correo','siat_9a_reservar_soap') LOOP
  original:=pg_get_functiondef(p.oid);
  actualizado:=replace(original,'v_factura.origen_fiscal IS DISTINCT FROM ''PILOTO''','(v_factura.origen_fiscal IS DISTINCT FROM ''PILOTO'' AND NOT public.siat_documento_checkout_9a(v_factura.id))');
  actualizado:=replace(actualizado,'f.origen_fiscal IS DISTINCT FROM ''PILOTO''','(f.origen_fiscal IS DISTINCT FROM ''PILOTO'' AND NOT public.siat_documento_checkout_9a(f.id))');
  actualizado:=replace(actualizado,'f.origen_fiscal=''PILOTO''','(f.origen_fiscal=''PILOTO'' OR public.siat_documento_checkout_9a(f.id))');
  IF actualizado=original THEN RAISE EXCEPTION 'Contrato 9A no reconocido: %',p.proname; END IF;
  EXECUTE actualizado;
 END LOOP;
END $$;

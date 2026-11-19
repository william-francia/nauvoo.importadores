-- La confirmacion verbal es una declaracion del usuario, no una autorizacion escrita del SIN.
BEGIN;
ALTER TABLE public.siat_piloto_control
  ADD COLUMN eku_alcance text,
  ADD COLUMN eku_declaracion_at timestamptz,
  ADD COLUMN autorizacion_habilitada_id uuid REFERENCES public.siat_piloto_autorizaciones(id) ON DELETE RESTRICT;
ALTER TABLE public.siat_piloto_control DROP CONSTRAINT siat_piloto_eku_evidencia_check;
ALTER TABLE public.siat_piloto_control ADD CONSTRAINT siat_piloto_eku_evidencia_check CHECK (
  NOT eku_fiscal_aprobado OR (
    eku_alcance = 'PRUEBAS' AND eku_cert_sha256 ~ '^[a-f0-9]{64}$'
    AND eku_aprobado_por IS NOT NULL AND eku_aprobado_at IS NOT NULL
    AND eku_declaracion_at IS NOT NULL AND (
      (eku_tipo_evidencia = 'ACEPTACION_SIAT_PILOTO'
        AND eku_entidad_confirmadora = 'SIN' AND eku_fecha_confirmacion IS NOT NULL
        AND length(eku_referencia_documental) BETWEEN 8 AND 200)
      OR (eku_tipo_evidencia = 'CONFIRMACION_VERBAL_REPORTADA_POR_USUARIO'
        AND eku_entidad_confirmadora = 'SIN_REPORTADO_POR_USUARIO'
        AND eku_fecha_confirmacion IS NULL AND eku_referencia_documental IS NULL)
    )
  ) IS TRUE
);
ALTER TABLE public.siat_piloto_control ADD CONSTRAINT siat_piloto_habilitacion_individual_check CHECK (
  NOT emision_habilitada OR autorizacion_habilitada_id IS NOT NULL
);

CREATE OR REPLACE FUNCTION public.siat_aprobar_certificado_piloto(
  p_actor_auth_user_id uuid, p_tipo_evidencia text, p_entidad text,
  p_fecha_confirmacion date, p_referencia text, p_cert_sha256 text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE auth_user_id = p_actor_auth_user_id
    AND activo = true AND lower(rol) = 'administrador') THEN
    RAISE EXCEPTION 'PILOTO_ADMIN_REQUERIDO';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.siat_configuracion WHERE id = true
    AND ambiente = 'PRUEBAS' AND nit = '72229012' AND siat_habilitado = false) THEN
    RAISE EXCEPTION 'PILOTO_CONFIGURACION_INVALIDA';
  END IF;
  IF p_cert_sha256 IS NULL OR p_cert_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'PILOTO_EVIDENCIA_CERTIFICADO_INSUFICIENTE';
  END IF;
  IF p_tipo_evidencia = 'CONFIRMACION_VERBAL_REPORTADA_POR_USUARIO' THEN
    IF p_entidad IS DISTINCT FROM 'SIN_REPORTADO_POR_USUARIO'
      OR p_fecha_confirmacion IS NOT NULL OR p_referencia IS NOT NULL THEN
      RAISE EXCEPTION 'PILOTO_DECLARACION_VERBAL_INVALIDA';
    END IF;
  ELSIF p_tipo_evidencia = 'ACEPTACION_SIAT_PILOTO' THEN
    IF p_entidad IS DISTINCT FROM 'SIN' OR p_fecha_confirmacion IS NULL OR p_referencia IS NULL
      OR p_fecha_confirmacion > current_date
      OR length(trim(p_referencia)) NOT BETWEEN 8 AND 200 THEN
      RAISE EXCEPTION 'PILOTO_EVIDENCIA_CERTIFICADO_INSUFICIENTE';
    END IF;
  ELSE
    RAISE EXCEPTION 'PILOTO_EVIDENCIA_CERTIFICADO_INSUFICIENTE';
  END IF;
  UPDATE public.siat_piloto_control SET eku_fiscal_aprobado = true,
    eku_tipo_evidencia = p_tipo_evidencia, eku_entidad_confirmadora = p_entidad,
    eku_fecha_confirmacion = p_fecha_confirmacion, eku_referencia_documental = NULLIF(trim(p_referencia), ''),
    eku_cert_sha256 = p_cert_sha256, eku_alcance = 'PRUEBAS', eku_declaracion_at = now(),
    eku_aprobado_por = p_actor_auth_user_id, eku_aprobado_at = now(),
    emision_habilitada = false, autorizacion_habilitada_id = NULL, updated_at = now()
  WHERE id = true;
  INSERT INTO public.siat_auditoria
    (actor_auth_user_id, entidad, entidad_id, accion, contexto, resultado)
  VALUES (p_actor_auth_user_id, 'siat_piloto_control', 'true', 'APROBAR_CERTIFICADO_PILOTO',
    jsonb_build_object('tipoEvidencia', p_tipo_evidencia, 'entidadReportada', p_entidad,
      'alcance', 'PRUEBAS', 'fechaDeclaracion', current_date,
      'referenciaDocumental', p_referencia, 'certSha256', p_cert_sha256), 'EXITOSO');
END;
$$;

CREATE OR REPLACE FUNCTION public.siat_habilitar_autorizacion_piloto(
  p_actor_auth_user_id uuid, p_autorizacion_id uuid, p_cert_sha256 text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_control public.siat_piloto_control%ROWTYPE;
  v_auth public.siat_piloto_autorizaciones%ROWTYPE;
  v_client public.clientes%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE auth_user_id = p_actor_auth_user_id
    AND activo = true AND lower(rol) = 'administrador') THEN
    RAISE EXCEPTION 'PILOTO_ADMIN_REQUERIDO';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.siat_configuracion WHERE id = true
    AND ambiente = 'PRUEBAS' AND nit = '72229012' AND siat_habilitado = false) THEN
    RAISE EXCEPTION 'PILOTO_CONFIGURACION_INVALIDA';
  END IF;
  SELECT * INTO v_control FROM public.siat_piloto_control WHERE id = true FOR UPDATE;
  SELECT * INTO v_auth FROM public.siat_piloto_autorizaciones WHERE id = p_autorizacion_id;
  IF NOT FOUND OR v_auth.actor_auth_user_id IS DISTINCT FROM p_actor_auth_user_id
    OR v_auth.estado <> 'PREPARADA' OR v_auth.expires_at <= now() THEN
    RAISE EXCEPTION 'PILOTO_AUTORIZACION_INVALIDA';
  END IF;
  IF v_control.eku_fiscal_aprobado IS DISTINCT FROM true
    OR v_control.eku_alcance IS DISTINCT FROM 'PRUEBAS'
    OR v_control.eku_cert_sha256 IS DISTINCT FROM p_cert_sha256
    OR p_cert_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'PILOTO_CERTIFICADO_NO_APROBADO';
  END IF;
  SELECT * INTO v_client FROM public.clientes WHERE id = v_auth.cliente_id AND activo = true;
  IF NOT FOUND OR v_client.codigo_cliente <> 'CLI-000006'
    OR v_client.nombre_razon_social <> 'William Benjamin Francia Poma'
    OR v_client.numero_documento <> '9204357' OR v_client.tipo_documento NOT IN ('CI','NIT') THEN
    RAISE EXCEPTION 'PILOTO_CLIENTE_INVALIDO';
  END IF;
  IF v_client.tipo_documento = 'CI' THEN
    IF v_client.numero_documento !~ '^[0-9]{4,12}$'
      OR NULLIF(trim(v_client.complemento), '') IS NOT NULL THEN
      RAISE EXCEPTION 'PILOTO_CI_INVALIDA';
    END IF;
  ELSIF v_control.nit_cliente_verificado IS DISTINCT FROM true
    OR v_control.nit_cliente_id IS DISTINCT FROM v_client.id
    OR v_control.nit_cliente_documento IS DISTINCT FROM v_client.numero_documento
    OR v_control.nit_ambiente IS DISTINCT FROM 'PRUEBAS'
    OR v_control.nit_codigo_respuesta IS DISTINCT FROM 986
    OR v_control.nit_verificado_at IS NULL
    OR v_control.nit_verificado_at <= now() - interval '24 hours' THEN
    RAISE EXCEPTION 'PILOTO_NIT_SIN_VERIFICAR';
  END IF;
  IF EXISTS (SELECT 1 FROM public.facturas_siat WHERE origen_fiscal = 'PILOTO') THEN
    RAISE EXCEPTION 'PILOTO_UNICA_FACTURA_YA_CREADA';
  END IF;
  IF v_control.emision_habilitada AND v_control.autorizacion_habilitada_id = p_autorizacion_id THEN RETURN; END IF;
  IF v_control.emision_habilitada THEN RAISE EXCEPTION 'PILOTO_OTRA_AUTORIZACION_HABILITADA'; END IF;
  UPDATE public.siat_piloto_control SET emision_habilitada = true,
    autorizacion_habilitada_id = p_autorizacion_id, updated_at = now() WHERE id = true;
  INSERT INTO public.siat_auditoria
    (actor_auth_user_id, entidad, entidad_id, accion, contexto, resultado)
  VALUES (p_actor_auth_user_id, 'siat_piloto_autorizaciones', p_autorizacion_id::text,
    'HABILITAR_EMISION_PILOTO_INDIVIDUAL',
    jsonb_build_object('ambiente', 'PRUEBAS', 'certSha256', p_cert_sha256), 'EXITOSO');
END;
$$;
REVOKE ALL ON FUNCTION public.siat_habilitar_autorizacion_piloto(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siat_habilitar_autorizacion_piloto(uuid,uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.siat_crear_factura_piloto_outbox(
  p_autorizacion_id uuid, p_actor_auth_user_id uuid, p_confirmacion text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_auth public.siat_piloto_autorizaciones%ROWTYPE;
  v_config public.siat_configuracion%ROWTYPE;
  v_cliente public.clientes%ROWTYPE;
  v_producto public.productos%ROWTYPE;
  v_sucursal public.siat_sucursales%ROWTYPE;
  v_punto public.siat_puntos_venta%ROWTYPE;
  v_cuis public.siat_cuis%ROWTYPE;
  v_cufd public.siat_cufd%ROWTYPE;
  v_factura_id uuid;
  v_numero bigint;
  v_leyenda text;
  v_usuario text;
  v_total numeric(16,2);
BEGIN
  SELECT * INTO v_auth FROM public.siat_piloto_autorizaciones
   WHERE id = p_autorizacion_id FOR UPDATE;
  IF NOT FOUND OR v_auth.actor_auth_user_id IS DISTINCT FROM p_actor_auth_user_id THEN
    RAISE EXCEPTION 'PILOTO_AUTORIZACION_INVALIDA';
  END IF;
  SELECT id INTO v_factura_id FROM public.facturas_siat
   WHERE piloto_autorizacion_id = p_autorizacion_id;
  IF v_factura_id IS NOT NULL THEN RETURN v_factura_id; END IF;
  IF v_auth.estado <> 'PREPARADA' OR v_auth.expires_at <= now()
     OR p_confirmacion IS DISTINCT FROM 'AUTORIZO EMITIR ESTA UNICA FACTURA EN SIAT PILOTO' THEN
    RAISE EXCEPTION 'PILOTO_CONFIRMACION_REQUERIDA';
  END IF;
  SELECT trim(concat_ws(' ', nombre, apellidos)) INTO v_usuario
  FROM public.usuarios WHERE auth_user_id = p_actor_auth_user_id
    AND activo = true AND lower(rol) = 'administrador';
  IF NOT FOUND THEN RAISE EXCEPTION 'PILOTO_ADMIN_REQUERIDO'; END IF;
  PERFORM 1 FROM public.siat_piloto_control WHERE id = true FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM public.siat_piloto_control
    WHERE id = true AND emision_habilitada = true AND eku_fiscal_aprobado = true
      AND autorizacion_habilitada_id = p_autorizacion_id
  ) THEN RAISE EXCEPTION 'PILOTO_PREAPROBACION_PENDIENTE'; END IF;
  SELECT * INTO v_config FROM public.siat_configuracion WHERE id = true FOR SHARE;
  IF NOT FOUND OR v_config.ambiente <> 'PRUEBAS' OR v_config.modalidad <> 'ELECTRONICA'
     OR v_config.version_normativa <> 'SIAT_VIGENTE' OR v_config.siat_habilitado <> false
     OR v_config.nit <> '72229012' OR v_config.actividad_economica <> '4752100'
     OR v_config.documento_sector <> 1 OR v_config.tipo_factura <> 1
     OR v_config.sucursal_predeterminada_id IS NULL THEN
    RAISE EXCEPTION 'PILOTO_CONFIGURACION_INVALIDA';
  END IF;
  SELECT * INTO v_cliente FROM public.clientes WHERE id = v_auth.cliente_id AND activo = true;
  IF NOT FOUND OR v_cliente.codigo_cliente <> 'CLI-000006'
     OR v_cliente.nombre_razon_social <> 'William Benjamin Francia Poma'
     OR v_cliente.tipo_documento NOT IN ('CI','NIT') OR v_cliente.numero_documento <> '9204357' THEN
    RAISE EXCEPTION 'PILOTO_CLIENTE_INVALIDO';
  END IF;
  IF v_cliente.tipo_documento = 'CI' THEN
    IF v_cliente.numero_documento !~ '^[0-9]{4,12}$' OR NULLIF(trim(v_cliente.complemento), '') IS NOT NULL THEN
      RAISE EXCEPTION 'PILOTO_CI_INVALIDA';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM public.siat_piloto_control
    WHERE id = true AND nit_cliente_verificado = true
      AND nit_cliente_id = v_cliente.id AND nit_cliente_documento = v_cliente.numero_documento
      AND nit_ambiente = 'PRUEBAS' AND nit_codigo_respuesta = 986
      AND nit_verificado_at <= now() AND nit_verificado_at > now() - interval '24 hours'
  ) THEN
    RAISE EXCEPTION 'PILOTO_NIT_SIN_VERIFICAR';
  END IF;
  SELECT * INTO v_producto FROM public.productos WHERE id = v_auth.producto_id AND activo = true;
  IF NOT FOUND OR v_producto.codigo_interno <> 'ph1234' THEN
    RAISE EXCEPTION 'PILOTO_PRODUCTO_INVALIDO';
  END IF;
  IF EXISTS (SELECT 1 FROM public.siat_outbox WHERE estado IN ('PENDIENTE','REINTENTAR','PROCESANDO')) THEN
    RAISE EXCEPTION 'PILOTO_OUTBOX_NO_VACIO';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.siat_catalogos c JOIN public.siat_catalogo_items i ON i.catalogo_id = c.id
    WHERE c.codigo = 'ACTIVIDADES' AND c.estado = 'VIGENTE' AND c.version_normativa = 'SIAT_VIGENTE'
      AND i.codigo = '4752100' AND i.activo = true
  ) OR NOT EXISTS (
    SELECT 1 FROM public.siat_catalogos c JOIN public.siat_catalogo_items i ON i.catalogo_id = c.id
    WHERE c.codigo = 'PRODUCTOS_SERVICIOS' AND c.estado = 'VIGENTE' AND c.version_normativa = 'SIAT_VIGENTE'
      AND i.codigo = '1003451' AND i.activo = true AND i.metadatos->>'codigoActividad' = '4752100'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.siat_catalogos c JOIN public.siat_catalogo_items i ON i.catalogo_id = c.id
    WHERE c.codigo = 'UNIDADES_MEDIDA' AND c.estado = 'VIGENTE' AND c.version_normativa = 'SIAT_VIGENTE'
      AND i.codigo = '47' AND i.activo = true
  ) OR NOT EXISTS (
    SELECT 1 FROM public.siat_catalogos c JOIN public.siat_catalogo_items i ON i.catalogo_id = c.id
    JOIN public.siat_metodo_pago_mapeos m ON m.codigo_metodo_pago::text = i.codigo
    WHERE c.codigo = 'METODOS_PAGO' AND c.estado = 'VIGENTE' AND c.version_normativa = 'SIAT_VIGENTE'
      AND i.codigo = '1' AND i.activo = true AND m.metodo_interno = 'EFECTIVO' AND m.version_normativa = 'SIAT_VIGENTE'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.siat_catalogos c JOIN public.siat_catalogo_items i ON i.catalogo_id = c.id
    WHERE c.codigo = 'TIPOS_DOCUMENTO' AND c.estado = 'VIGENTE' AND c.version_normativa = 'SIAT_VIGENTE'
      AND i.codigo = CASE WHEN v_cliente.tipo_documento = 'CI' THEN '1' ELSE '5' END AND i.activo = true
  ) THEN RAISE EXCEPTION 'PILOTO_CATALOGOS_INVALIDOS'; END IF;
  SELECT * INTO v_sucursal FROM public.siat_sucursales
   WHERE id = v_config.sucursal_predeterminada_id AND codigo = 0 AND activo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'PILOTO_SUCURSAL_INVALIDA'; END IF;
  IF v_config.punto_venta_predeterminado_id IS NOT NULL THEN
    SELECT * INTO v_punto FROM public.siat_puntos_venta
    WHERE id = v_config.punto_venta_predeterminado_id AND sucursal_id = v_sucursal.id
      AND codigo = 0 AND activo = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'PILOTO_PUNTO_INVALIDO'; END IF;
  END IF;
  SELECT * INTO v_cuis FROM public.siat_cuis
   WHERE sucursal_id = v_sucursal.id AND punto_venta_id IS NOT DISTINCT FROM v_config.punto_venta_predeterminado_id
     AND ambiente = 'PRUEBAS' AND estado = 'VIGENTE'
     AND (fecha_expiracion IS NULL OR fecha_expiracion > now())
   ORDER BY fecha_expiracion DESC NULLS LAST LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'PILOTO_CUIS_NO_VIGENTE'; END IF;
  SELECT * INTO v_cufd FROM public.siat_cufd
   WHERE sucursal_id = v_sucursal.id AND punto_venta_id IS NOT DISTINCT FROM v_config.punto_venta_predeterminado_id
     AND cuis_id = v_cuis.id AND ambiente = 'PRUEBAS' AND estado = 'VIGENTE'
     AND fecha_inicio <= now() AND fecha_expiracion > now()
   ORDER BY fecha_expiracion DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'PILOTO_CUFD_NO_VIGENTE'; END IF;
  SELECT i.descripcion INTO v_leyenda
    FROM public.siat_catalogos c JOIN public.siat_catalogo_items i ON i.catalogo_id = c.id
    WHERE c.codigo = 'LEYENDAS_FACTURA' AND c.version_normativa = 'SIAT_VIGENTE'
      AND c.estado = 'VIGENTE' AND i.activo = true
      AND (i.metadatos->>'actividadEconomica' IS NULL OR i.metadatos->>'actividadEconomica' = '4752100')
    ORDER BY (i.metadatos->>'actividadEconomica' IS NOT NULL) DESC, i.codigo LIMIT 1;
  IF v_leyenda IS NULL THEN RAISE EXCEPTION 'PILOTO_LEYENDA_NO_VIGENTE'; END IF;
  IF EXISTS (SELECT 1 FROM public.facturas_siat WHERE origen_fiscal = 'PILOTO') THEN
    RAISE EXCEPTION 'PILOTO_UNICA_FACTURA_YA_CREADA';
  END IF;
  v_total := v_auth.precio_unitario - v_auth.descuento;
  v_numero := public.siat_reservar_numero(v_sucursal.id, v_config.punto_venta_predeterminado_id, 1, 'ONLINE');
  INSERT INTO public.facturas_siat (
    venta_id, origen_fiscal, piloto_autorizacion_id, idempotency_key, ambiente,
    version_especificacion, modalidad, documento_sector, tipo_factura,
    sucursal_id, punto_venta_id, cuis_id, cufd_id, tipo_emision, estado_fiscal,
    numero_factura, fecha_emision, codigo_sucursal, codigo_punto_venta, cuis, cufd,
    nombre_razon_social, tipo_documento, numero_documento, complemento, monto_total,
    cliente_snapshot, detalle_snapshot, totales_snapshot, pago_snapshot,
    sucursal_snapshot, punto_venta_snapshot
  ) VALUES (
    NULL, 'PILOTO', v_auth.id, 'piloto:' || v_auth.id::text, 'PRUEBAS',
    'SIAT_VIGENTE', 'ELECTRONICA', 1, 1, v_sucursal.id, v_config.punto_venta_predeterminado_id,
    v_cuis.id, v_cufd.id, 'ONLINE', 'EN_COLA', v_numero, clock_timestamp(),
    0, COALESCE(v_punto.codigo, 0), v_cuis.codigo, v_cufd.codigo,
    v_cliente.nombre_razon_social, v_cliente.tipo_documento, v_cliente.numero_documento, v_cliente.complemento, v_total,
    jsonb_build_object('clienteId',v_cliente.id,'nombreRazonSocial',v_cliente.nombre_razon_social,
      'codigoTipoDocumentoIdentidad',CASE WHEN v_cliente.tipo_documento = 'CI' THEN 1 ELSE 5 END,'numeroDocumento',v_cliente.numero_documento,
      'complemento',v_cliente.complemento,'codigoCliente',v_cliente.codigo_cliente,'correo',v_cliente.correo),
    jsonb_build_array(jsonb_build_object('productoId',v_producto.id,'codigoProducto',v_producto.codigo_interno,
      'descripcion',v_producto.nombre,'actividadEconomica','4752100','codigoProductoSin','1003451',
      'unidadMedidaSin','47','cantidad','1','precioUnitario',v_auth.precio_unitario::text,
      'descuento',v_auth.descuento::text,'subtotal',v_total::text,'origen',NULL)),
    jsonb_build_object('subtotal',v_auth.precio_unitario::text,'descuentoItems',v_auth.descuento::text,
      'descuentoAdicional','0','descuentoTotal',v_auth.descuento::text,'montoTotal',v_total::text,
      'montoTotalSujetoIva',v_total::text,'montoTotalMoneda',v_total::text,'leyenda',v_leyenda),
    jsonb_build_object('codigoMetodoPago',1,'metodoInterno','EFECTIVO','moneda','BOB',
      'codigoMoneda',1,'tipoCambio','1','numeroTarjeta',NULL,'usuario',v_usuario),
    to_jsonb(v_sucursal), CASE WHEN v_punto.id IS NULL THEN '{}'::jsonb ELSE to_jsonb(v_punto) END
  ) RETURNING id INTO v_factura_id;
  INSERT INTO public.siat_outbox (factura_id,tipo_tarea,payload,estado,idempotency_key)
  VALUES (v_factura_id,'EMITIR_FACTURA_ONLINE',jsonb_build_object('facturaId',v_factura_id,
    'origenFiscal','PILOTO','autorizacionId',v_auth.id),'PENDIENTE','emitir:' || v_factura_id::text);
  UPDATE public.siat_piloto_autorizaciones SET estado='CONSUMIDA', confirmed_at=now()
    WHERE id=v_auth.id;
  RETURN v_factura_id;
END;
$$;
COMMIT;

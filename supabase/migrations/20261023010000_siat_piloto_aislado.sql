-- Una factura piloto no es una venta comercial. La ruta normal conserva su FK.
BEGIN;

CREATE TABLE public.siat_piloto_control (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  emision_habilitada boolean NOT NULL DEFAULT false,
  eku_fiscal_aprobado boolean NOT NULL DEFAULT false,
  nit_cliente_verificado boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.siat_piloto_control (id) VALUES (true);
ALTER TABLE public.siat_piloto_control ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.siat_piloto_control FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.siat_piloto_control TO service_role;

CREATE TABLE public.siat_piloto_autorizaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_auth_user_id uuid NOT NULL,
  cliente_id uuid NOT NULL REFERENCES public.clientes(id) ON DELETE RESTRICT,
  producto_id uuid NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  preview_hash text NOT NULL CHECK (preview_hash ~ '^[a-f0-9]{64}$'),
  cantidad numeric(16,3) NOT NULL DEFAULT 1 CHECK (cantidad = 1),
  precio_unitario numeric(16,2) NOT NULL CHECK (precio_unitario > 0),
  descuento numeric(16,2) NOT NULL DEFAULT 0 CHECK (descuento >= 0 AND descuento < precio_unitario),
  estado text NOT NULL DEFAULT 'PREPARADA' CHECK (estado IN ('PREPARADA', 'CONSUMIDA', 'REVOCADA')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '1 hour'),
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (actor_auth_user_id, preview_hash)
);
ALTER TABLE public.siat_piloto_autorizaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.siat_piloto_autorizaciones FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.siat_piloto_autorizaciones TO service_role;

ALTER TABLE public.facturas_siat
  ADD COLUMN origen_fiscal text NOT NULL DEFAULT 'VENTA',
  ADD COLUMN piloto_autorizacion_id uuid REFERENCES public.siat_piloto_autorizaciones(id) ON DELETE RESTRICT,
  ALTER COLUMN venta_id DROP NOT NULL;
ALTER TABLE public.facturas_siat
  ADD CONSTRAINT facturas_siat_origen_fiscal_check CHECK (
    (origen_fiscal = 'VENTA' AND venta_id IS NOT NULL AND piloto_autorizacion_id IS NULL)
    OR (origen_fiscal = 'PILOTO' AND venta_id IS NULL AND piloto_autorizacion_id IS NOT NULL
        AND ambiente = 'PRUEBAS' AND modalidad = 'ELECTRONICA'
        AND documento_sector = 1 AND tipo_factura = 1 AND tipo_emision = 'ONLINE')
  );
CREATE UNIQUE INDEX facturas_siat_piloto_autorizacion_unique
  ON public.facturas_siat (piloto_autorizacion_id) WHERE piloto_autorizacion_id IS NOT NULL;

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
  IF NOT EXISTS (
    SELECT 1 FROM public.siat_piloto_control
    WHERE id = true AND emision_habilitada = true AND eku_fiscal_aprobado = true
      AND nit_cliente_verificado = true
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
     OR v_cliente.tipo_documento <> 'NIT' OR v_cliente.numero_documento <> '9204357' THEN
    RAISE EXCEPTION 'PILOTO_CLIENTE_INVALIDO';
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
      AND i.codigo = '5' AND i.activo = true
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
    v_cliente.nombre_razon_social, 'NIT', v_cliente.numero_documento, NULL, v_total,
    jsonb_build_object('clienteId',v_cliente.id,'nombreRazonSocial',v_cliente.nombre_razon_social,
      'codigoTipoDocumentoIdentidad',5,'numeroDocumento',v_cliente.numero_documento,
      'complemento',NULL,'codigoCliente',v_cliente.codigo_cliente,'correo',v_cliente.correo),
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
REVOKE ALL ON FUNCTION public.siat_crear_factura_piloto_outbox(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siat_crear_factura_piloto_outbox(uuid,uuid,text) TO service_role;

COMMIT;

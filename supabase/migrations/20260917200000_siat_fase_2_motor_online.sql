-- FASE 2 SIAT: reserva fiscal atómica, outbox online, artefactos privados y worker seguro.
-- Las credenciales SIAT permanecen exclusivamente en secretos de Edge Functions.

BEGIN;

-- La tabla heredada permitía escritura total a cualquier autenticado. La
-- emisión de Fase 2 se realiza únicamente por funciones service_role.
DROP POLICY IF EXISTS acceso_total_autenticados ON public.facturas_siat;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.facturas_siat FROM authenticated;
GRANT SELECT ON public.facturas_siat TO authenticated;
CREATE POLICY facturas_siat_lectura_operativa ON public.facturas_siat
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.usuarios u
      WHERE u.auth_user_id = auth.uid() AND u.activo = true
        AND u.rol IN ('administrador', 'vendedor', 'caja')
    )
  );

ALTER TABLE public.siat_configuracion
  ADD COLUMN sucursal_predeterminada_id uuid REFERENCES public.siat_sucursales(id) ON DELETE RESTRICT,
  ADD COLUMN punto_venta_predeterminado_id uuid REFERENCES public.siat_puntos_venta(id) ON DELETE RESTRICT,
  ADD COLUMN desfase_hora_sin_ms bigint,
  ADD COLUMN ultima_verificacion_servicio timestamptz,
  ADD COLUMN ultima_sincronizacion_exitosa timestamptz;

CREATE TABLE public.siat_metodo_pago_mapeos (
  metodo_interno text PRIMARY KEY CHECK (metodo_interno IN ('EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'QR', 'OTRO')),
  codigo_metodo_pago integer NOT NULL CHECK (codigo_metodo_pago > 0),
  version_normativa text NOT NULL DEFAULT 'SIAT_VIGENTE' CHECK (version_normativa = 'SIAT_VIGENTE'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.siat_metodo_pago_mapeos ENABLE ROW LEVEL SECURITY;
CREATE POLICY siat_metodo_pago_mapeos_lectura ON public.siat_metodo_pago_mapeos
  FOR SELECT TO authenticated USING (true);
CREATE POLICY siat_metodo_pago_mapeos_admin ON public.siat_metodo_pago_mapeos
  FOR ALL TO authenticated USING (public.siat_es_administrador()) WITH CHECK (public.siat_es_administrador());
GRANT SELECT, INSERT, UPDATE ON public.siat_metodo_pago_mapeos TO authenticated;

-- Wrapper transaccional que conserva solo el número de tarjeta ya ofuscado.
-- La función histórica registrar_venta permanece intacta para no romper otros módulos.
CREATE OR REPLACE FUNCTION public.registrar_venta_fiscal(
  p_cliente_id uuid,
  p_metodo_pago text,
  p_observacion text,
  p_descuento_venta numeric,
  p_tarjeta_ofuscada text,
  p_items jsonb
)
RETURNS TABLE (venta_id uuid, codigo_venta text, total numeric, estado text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_metodo_pago = 'TARJETA' AND COALESCE(p_tarjeta_ofuscada, '') !~ '^[0-9]{4}0{8}[0-9]{4}$' THEN
    RAISE EXCEPTION 'La tarjeta debe conservar únicamente los primeros y últimos cuatro dígitos, con ceros al medio.';
  END IF;
  IF p_metodo_pago <> 'TARJETA' AND p_tarjeta_ofuscada IS NOT NULL THEN
    RAISE EXCEPTION 'El número de tarjeta solo corresponde al método de pago Tarjeta.';
  END IF;
  PERFORM set_config('app.siat_tarjeta_ofuscada', COALESCE(p_tarjeta_ofuscada, ''), true);
  RETURN QUERY SELECT * FROM public.registrar_venta(
    p_cliente_id, p_metodo_pago, p_observacion, p_descuento_venta, p_items
  );
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_venta_fiscal(uuid, text, text, numeric, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_venta_fiscal(uuid, text, text, numeric, text, jsonb) TO authenticated;

ALTER TABLE public.facturas_siat
  ADD COLUMN correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN fecha_envio timestamptz,
  ADD COLUMN fecha_validacion timestamptz,
  ADD COLUMN qr_contenido text,
  ADD COLUMN pdf_storage_path text,
  ADD COLUMN xml_storage_path text,
  ADD COLUMN xml_firmado boolean NOT NULL DEFAULT false,
  ADD COLUMN ultimo_error_sanitizado text;

CREATE UNIQUE INDEX facturas_siat_correlation_id_unique
  ON public.facturas_siat (correlation_id);

CREATE TABLE public.siat_artefactos_oficiales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo text NOT NULL CHECK (tipo IN ('WSDL', 'XSD', 'SIGNATURE_SCHEMA', 'FORMATO_GRAFICO', 'DOCUMENTACION')),
  nombre text NOT NULL,
  version_normativa text NOT NULL CHECK (version_normativa IN ('SIAT_VIGENTE', 'SIAT_LEY_1733_PILOTO')),
  version_artefacto text NOT NULL,
  url_oficial text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[A-Fa-f0-9]{64}$'),
  fecha_obtencion timestamptz NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (nombre, version_normativa, sha256)
);

INSERT INTO public.siat_artefactos_oficiales
  (tipo, nombre, version_normativa, version_artefacto, url_oficial, sha256, fecha_obtencion)
VALUES
  ('XSD', 'facturaComputarizadaCompraVenta.xsd', 'SIAT_VIGENTE', 'XSD 23/08/2021 publicado por SIN',
   'https://siatinfo.impuestos.gob.bo/images/archivos_tecnicos/archivos_apoyo/CompraVentaXML.zip',
   '344ED2A4BE74C191637B7E918ED3DCE6D85B667CB98DA47A53FA4103683717D9', '2026-09-17T00:00:00-04:00'),
  ('XSD', 'facturaElectronicaCompraVenta.xsd', 'SIAT_VIGENTE', 'XSD 23/08/2021 publicado por SIN',
   'https://siatinfo.impuestos.gob.bo/images/archivos_tecnicos/archivos_apoyo/CompraVentaXML.zip',
   'A3BB1D2E35C2D1E8C710AFBE9F1DA242A9F02BDD49F78C3D45DC4DBAFDA339CF', '2026-09-17T00:00:00-04:00'),
  ('SIGNATURE_SCHEMA', 'SignatureSchema.xsd', 'SIAT_VIGENTE', 'publicado por SIN',
   'https://siatinfo.impuestos.gob.bo/images/archivos_tecnicos/archivos_apoyo/SignatureSchema.xsd',
   '01D2501D2FBD59DB2783DA454E0582F759ABBB4B04F35DC14F94E690966E47C8', '2026-09-17T00:00:00-04:00'),
  ('WSDL', 'FacturacionCodigos.wsdl', 'SIAT_VIGENTE', 'v2 piloto SIN',
   'https://pilotosiatservicios.impuestos.gob.bo/v2/FacturacionCodigos?wsdl',
   'F4FB0FBDBBFD04EC16B7F607E72A4E1305C823EFAF0F5B3182A7C50ED225F464', '2026-09-17T00:00:00-04:00'),
  ('WSDL', 'FacturacionSincronizacion.wsdl', 'SIAT_VIGENTE', 'v2 piloto SIN',
   'https://pilotosiatservicios.impuestos.gob.bo/v2/FacturacionSincronizacion?wsdl',
   'DA4510A70A159CD621CBAF5D2155EA7E26EC3200CC6115D593AE504545BCB6AC', '2026-09-17T00:00:00-04:00'),
  ('WSDL', 'ServicioFacturacionCompraVenta.wsdl', 'SIAT_VIGENTE', 'v2 piloto SIN',
   'https://pilotosiatservicios.impuestos.gob.bo/v2/ServicioFacturacionCompraVenta?wsdl',
   '8FC01968442F8CB012ECFB6053DE91F57EF01261DECC2DFE6863B6A108785B69', '2026-09-17T00:00:00-04:00')
ON CONFLICT DO NOTHING;

ALTER TABLE public.siat_artefactos_oficiales ENABLE ROW LEVEL SECURITY;
CREATE POLICY siat_artefactos_lectura ON public.siat_artefactos_oficiales
  FOR SELECT TO authenticated USING (true);
CREATE POLICY siat_artefactos_admin ON public.siat_artefactos_oficiales
  FOR ALL TO authenticated USING (public.siat_es_administrador())
  WITH CHECK (public.siat_es_administrador());
GRANT SELECT ON public.siat_artefactos_oficiales TO authenticated;

-- Reserva correlativos mediante bloqueo de fila. El UPDATE devuelve el número
-- reservado y evita que dos cajas compartan numeración.
CREATE OR REPLACE FUNCTION public.siat_reservar_numero(
  p_sucursal_id uuid,
  p_punto_venta_id uuid,
  p_documento_sector integer,
  p_tipo_emision text
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_numero bigint;
BEGIN
  IF p_tipo_emision NOT IN ('ONLINE', 'OFFLINE') THEN
    RAISE EXCEPTION 'Tipo de emisión no permitido.';
  END IF;

  INSERT INTO public.siat_secuencias (
    sucursal_id, punto_venta_id, documento_sector, tipo_emision, siguiente_numero
  ) VALUES (
    p_sucursal_id, p_punto_venta_id, p_documento_sector, p_tipo_emision, 1
  )
  ON CONFLICT (sucursal_id, punto_venta_id, documento_sector, tipo_emision)
    DO NOTHING;

  UPDATE public.siat_secuencias
  SET siguiente_numero = siguiente_numero + 1,
      updated_at = now()
  WHERE sucursal_id = p_sucursal_id
    AND punto_venta_id IS NOT DISTINCT FROM p_punto_venta_id
    AND documento_sector = p_documento_sector
    AND tipo_emision = p_tipo_emision
  RETURNING siguiente_numero - 1 INTO v_numero;

  IF v_numero IS NULL THEN
    RAISE EXCEPTION 'No fue posible reservar la numeración fiscal.';
  END IF;
  RETURN v_numero;
END;
$$;

REVOKE ALL ON FUNCTION public.siat_reservar_numero(uuid, uuid, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siat_reservar_numero(uuid, uuid, integer, text) TO service_role;

CREATE OR REPLACE FUNCTION public.siat_crear_factura_outbox(p_venta_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config public.siat_configuracion%ROWTYPE;
  v_venta public.ventas%ROWTYPE;
  v_cliente public.clientes%ROWTYPE;
  v_usuario public.usuarios%ROWTYPE;
  v_sucursal public.siat_sucursales%ROWTYPE;
  v_punto public.siat_puntos_venta%ROWTYPE;
  v_cuis public.siat_cuis%ROWTYPE;
  v_cufd public.siat_cufd%ROWTYPE;
  v_numero bigint;
  v_factura_id uuid;
  v_detalle jsonb;
  v_cliente_snapshot jsonb;
  v_pago_snapshot jsonb;
  v_totales_snapshot jsonb;
  v_idempotency_key text;
  v_documento_codigo integer;
  v_leyenda text;
  v_metodo_pago_codigo integer;
  v_tarjeta_ofuscada text;
BEGIN
  SELECT * INTO v_config FROM public.siat_configuracion WHERE id = true;
  IF NOT FOUND OR NOT v_config.siat_habilitado THEN
    RETURN NULL;
  END IF;
  IF v_config.ambiente <> 'PRUEBAS' OR v_config.version_normativa <> 'SIAT_VIGENTE' THEN
    RAISE EXCEPTION 'La emisión SIAT solo está habilitada para la especificación vigente en ambiente de pruebas.';
  END IF;
  IF v_config.nit IS NULL OR v_config.codigo_sistema IS NULL
     OR v_config.documento_sector IS NULL OR v_config.tipo_factura IS NULL
     OR v_config.sucursal_predeterminada_id IS NULL THEN
    RAISE EXCEPTION 'La configuración fiscal está incompleta.';
  END IF;

  SELECT * INTO v_venta FROM public.ventas WHERE id = p_venta_id FOR UPDATE;
  IF NOT FOUND OR v_venta.estado <> 'confirmada' THEN
    RAISE EXCEPTION 'La venta debe estar confirmada antes de preparar la factura.';
  END IF;

  SELECT * INTO v_sucursal FROM public.siat_sucursales
   WHERE id = v_config.sucursal_predeterminada_id AND activo = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'La sucursal tributaria predeterminada no está disponible.'; END IF;

  IF v_config.punto_venta_predeterminado_id IS NOT NULL THEN
    SELECT * INTO v_punto FROM public.siat_puntos_venta
     WHERE id = v_config.punto_venta_predeterminado_id
       AND sucursal_id = v_sucursal.id AND activo = true;
    IF NOT FOUND THEN RAISE EXCEPTION 'El punto de venta predeterminado no está disponible.'; END IF;
  END IF;

  SELECT * INTO v_cuis FROM public.siat_cuis
   WHERE sucursal_id = v_sucursal.id
     AND punto_venta_id IS NOT DISTINCT FROM v_config.punto_venta_predeterminado_id
     AND ambiente = v_config.ambiente AND estado = 'VIGENTE'
     AND (fecha_expiracion IS NULL OR fecha_expiracion > now())
   ORDER BY fecha_expiracion DESC NULLS LAST LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe un CUIS vigente para la sucursal y punto de venta.'; END IF;

  SELECT * INTO v_cufd FROM public.siat_cufd
   WHERE sucursal_id = v_sucursal.id
     AND punto_venta_id IS NOT DISTINCT FROM v_config.punto_venta_predeterminado_id
     AND cuis_id = v_cuis.id AND ambiente = v_config.ambiente
     AND estado = 'VIGENTE' AND fecha_inicio <= now() AND fecha_expiracion > now()
   ORDER BY fecha_expiracion DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe un CUFD vigente para la sucursal y punto de venta.'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.detalle_ventas d
    LEFT JOIN public.siat_producto_homologaciones h
      ON h.producto_id = d.producto_id
     AND h.version_normativa = v_config.version_normativa
     AND h.estado = 'HOMOLOGADO'
    WHERE d.venta_id = p_venta_id AND h.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Todos los productos facturables deben tener homologación SIAT válida.';
  END IF;

  SELECT * INTO v_cliente FROM public.clientes WHERE id = v_venta.cliente_id;
  IF v_venta.cliente_id IS NOT NULL AND NOT FOUND THEN
    RAISE EXCEPTION 'El cliente de la venta no está disponible.';
  END IF;
  SELECT * INTO v_usuario FROM public.usuarios WHERE id = v_venta.usuario_id;

  SELECT m.codigo_metodo_pago INTO v_metodo_pago_codigo
  FROM public.siat_metodo_pago_mapeos m
  JOIN public.siat_catalogos c ON c.codigo = 'METODOS_PAGO'
    AND c.version_normativa = m.version_normativa AND c.estado = 'VIGENTE'
  JOIN public.siat_catalogo_items i ON i.catalogo_id = c.id
    AND i.codigo = m.codigo_metodo_pago::text AND i.activo = true
  WHERE m.metodo_interno = v_venta.metodo_pago
    AND m.version_normativa = v_config.version_normativa;
  IF v_metodo_pago_codigo IS NULL THEN
    RAISE EXCEPTION 'El método de pago % no tiene mapeo SIAT vigente.', v_venta.metodo_pago;
  END IF;
  v_tarjeta_ofuscada := nullif(current_setting('app.siat_tarjeta_ofuscada', true), '');
  IF v_venta.metodo_pago = 'TARJETA' AND (
    v_metodo_pago_codigo <> 2 OR COALESCE(v_tarjeta_ofuscada, '') !~ '^[0-9]{4}0{8}[0-9]{4}$'
  ) THEN RAISE EXCEPTION 'El pago con tarjeta requiere el código SIAT 2 y el número debidamente ofuscado.'; END IF;

  v_documento_codigo := CASE upper(COALESCE(v_cliente.tipo_documento, 'CI'))
    WHEN 'CI' THEN 1 WHEN 'CEX' THEN 2 WHEN 'CE' THEN 2 WHEN 'PASAPORTE' THEN 3
    WHEN 'OTRO' THEN 4 WHEN 'NIT' THEN 5 ELSE NULL END;
  IF v_documento_codigo IS NULL OR COALESCE(v_cliente.numero_documento, '') = '' THEN
    RAISE EXCEPTION 'El documento fiscal del cliente es inválido o está incompleto.';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'detalleId', d.id, 'productoId', d.producto_id,
    'codigoProducto', p.codigo_interno, 'descripcion', COALESCE(p.nombre, d.descripcion_producto),
    'actividadEconomica', h.actividad_economica, 'codigoProductoSin', h.codigo_producto_sin,
    'unidadMedidaSin', h.unidad_medida_sin, 'cantidad', d.cantidad::text,
    'precioUnitario', d.precio_unitario::text, 'descuento', d.descuento::text,
    'subtotal', d.subtotal::text, 'origen', h.origen, 'versionCatalogo', h.version_catalogo
  ) ORDER BY d.created_at, d.id) INTO v_detalle
  FROM public.detalle_ventas d
  JOIN public.productos p ON p.id = d.producto_id
  JOIN public.siat_producto_homologaciones h
    ON h.producto_id = d.producto_id
   AND h.version_normativa = v_config.version_normativa AND h.estado = 'HOMOLOGADO'
  WHERE d.venta_id = p_venta_id;

  IF v_detalle IS NULL OR jsonb_array_length(v_detalle) = 0 THEN
    RAISE EXCEPTION 'La venta no contiene detalle fiscal.';
  END IF;

  v_cliente_snapshot := jsonb_build_object(
    'clienteId', v_cliente.id, 'nombreRazonSocial', v_cliente.nombre_razon_social,
    'codigoTipoDocumentoIdentidad', v_documento_codigo,
    'numeroDocumento', v_cliente.numero_documento, 'complemento', v_cliente.complemento,
    'codigoCliente', COALESCE(v_cliente.codigo_cliente, v_cliente.numero_documento),
    'correo', v_cliente.correo
  );
  v_pago_snapshot := jsonb_build_object(
    'codigoMetodoPago', v_metodo_pago_codigo,
    'metodoInterno', v_venta.metodo_pago, 'moneda', 'BOB', 'codigoMoneda', 1,
    'tipoCambio', '1', 'numeroTarjeta', CASE WHEN v_venta.metodo_pago = 'TARJETA' THEN v_tarjeta_ofuscada ELSE NULL END,
    'usuario', trim(concat_ws(' ', v_usuario.nombre, v_usuario.apellidos))
  );

  SELECT i.descripcion INTO v_leyenda
  FROM public.siat_catalogos c
  JOIN public.siat_catalogo_items i ON i.catalogo_id = c.id AND i.activo = true
  WHERE c.codigo = 'LEYENDAS_FACTURA'
    AND c.version_normativa = v_config.version_normativa
    AND c.estado = 'VIGENTE'
    AND (
      i.metadatos->>'actividadEconomica' IS NULL OR
      i.metadatos->>'actividadEconomica' = (v_detalle->0->>'actividadEconomica')
    )
  ORDER BY (i.metadatos->>'actividadEconomica' IS NOT NULL) DESC, i.codigo
  LIMIT 1;
  IF v_leyenda IS NULL THEN
    RAISE EXCEPTION 'No existe una leyenda fiscal vigente sincronizada para la actividad económica.';
  END IF;
  v_totales_snapshot := jsonb_build_object(
    'subtotal', v_venta.subtotal::text, 'descuentoItems', v_venta.descuento_items::text,
    'descuentoAdicional', v_venta.descuento_venta::text,
    'descuentoTotal', v_venta.descuento_total::text, 'montoTotal', v_venta.total::text,
    'montoTotalSujetoIva', v_venta.total::text, 'montoTotalMoneda', v_venta.total::text,
    'leyenda', v_leyenda
  );

  v_idempotency_key := 'venta:' || p_venta_id::text || ':' || v_config.version_normativa;
  SELECT id INTO v_factura_id FROM public.facturas_siat
   WHERE idempotency_key = v_idempotency_key OR venta_id = p_venta_id LIMIT 1;
  IF v_factura_id IS NOT NULL THEN RETURN v_factura_id; END IF;

  v_numero := public.siat_reservar_numero(
    v_sucursal.id, v_config.punto_venta_predeterminado_id,
    v_config.documento_sector, 'ONLINE'
  );

  INSERT INTO public.facturas_siat (
    venta_id, idempotency_key, ambiente, version_especificacion, modalidad,
    documento_sector, tipo_factura, sucursal_id, punto_venta_id, cuis_id, cufd_id,
    tipo_emision, estado_fiscal, numero_factura, fecha_emision,
    codigo_sucursal, codigo_punto_venta, cuis, cufd,
    nombre_razon_social, tipo_documento, numero_documento, complemento, monto_total,
    cliente_snapshot, detalle_snapshot, totales_snapshot, pago_snapshot,
    sucursal_snapshot, punto_venta_snapshot
  ) VALUES (
    p_venta_id, v_idempotency_key, v_config.ambiente, v_config.version_normativa,
    v_config.modalidad, v_config.documento_sector, v_config.tipo_factura,
    v_sucursal.id, v_config.punto_venta_predeterminado_id, v_cuis.id, v_cufd.id,
    'ONLINE', 'EN_COLA', v_numero, clock_timestamp(), v_sucursal.codigo,
    COALESCE(v_punto.codigo, 0), v_cuis.codigo, v_cufd.codigo,
    v_cliente.nombre_razon_social, v_cliente.tipo_documento,
    v_cliente.numero_documento, v_cliente.complemento, v_venta.total,
    v_cliente_snapshot, v_detalle, v_totales_snapshot, v_pago_snapshot,
    to_jsonb(v_sucursal), CASE WHEN v_punto.id IS NULL THEN '{}'::jsonb ELSE to_jsonb(v_punto) END
  ) RETURNING id INTO v_factura_id;

  INSERT INTO public.siat_outbox (
    factura_id, tipo_tarea, payload, estado, idempotency_key
  ) VALUES (
    v_factura_id, 'EMITIR_FACTURA_ONLINE',
    jsonb_build_object('facturaId', v_factura_id, 'versionNormativa', v_config.version_normativa),
    'PENDIENTE', 'emitir:' || v_factura_id::text
  );

  RETURN v_factura_id;
END;
$$;

REVOKE ALL ON FUNCTION public.siat_crear_factura_outbox(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siat_crear_factura_outbox(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.siat_venta_confirmada_outbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.estado = 'confirmada' AND OLD.estado IS DISTINCT FROM NEW.estado THEN
    PERFORM public.siat_crear_factura_outbox(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_siat_venta_confirmada_outbox
  AFTER UPDATE OF estado ON public.ventas
  FOR EACH ROW EXECUTE FUNCTION public.siat_venta_confirmada_outbox();

CREATE OR REPLACE FUNCTION public.siat_reclamar_outbox(
  p_worker_id text,
  p_lock_segundos integer DEFAULT 90
)
RETURNS SETOF public.siat_outbox
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF COALESCE(trim(p_worker_id), '') = '' OR p_lock_segundos NOT BETWEEN 15 AND 600 THEN
    RAISE EXCEPTION 'Parámetros de worker inválidos.';
  END IF;

  SELECT id INTO v_id
  FROM public.siat_outbox
  WHERE estado IN ('PENDIENTE', 'REINTENTAR')
    AND disponible_desde <= now()
    AND (locked_until IS NULL OR locked_until < now())
  ORDER BY disponible_desde, created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF v_id IS NULL THEN RETURN; END IF;

  RETURN QUERY
  UPDATE public.siat_outbox
  SET estado = 'PROCESANDO', locked_by = p_worker_id,
      locked_until = now() + make_interval(secs => p_lock_segundos),
      intentos = intentos + 1
  WHERE id = v_id
  RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION public.siat_reclamar_outbox(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siat_reclamar_outbox(text, integer) TO service_role;

-- Sustituye un catálogo completo dentro de una única transacción. Si cualquier
-- item falla, PostgreSQL conserva la versión vigente anterior.
CREATE OR REPLACE FUNCTION public.siat_aplicar_catalogo(
  p_codigo text,
  p_nombre text,
  p_version_normativa text,
  p_version_catalogo text,
  p_items jsonb,
  p_correlation_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_catalogo_id uuid;
  v_count integer;
BEGIN
  IF p_version_normativa <> 'SIAT_VIGENTE' OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Catálogo SIAT inválido.';
  END IF;

  INSERT INTO public.siat_catalogos (
    codigo, nombre, version_normativa, version_catalogo, fecha_sincronizacion, estado, ultimo_error
  ) VALUES (
    p_codigo, p_nombre, p_version_normativa, p_version_catalogo, now(), 'VIGENTE', NULL
  )
  ON CONFLICT (codigo, version_normativa) DO UPDATE SET
    nombre = excluded.nombre,
    version_catalogo = excluded.version_catalogo,
    fecha_sincronizacion = excluded.fecha_sincronizacion,
    estado = 'VIGENTE', ultimo_error = NULL, updated_at = now()
  RETURNING id INTO v_catalogo_id;

  CREATE TEMP TABLE siat_items_nuevos ON COMMIT DROP AS
  SELECT
    trim(item->>'codigo') AS codigo,
    trim(COALESCE(item->>'descripcion', item->>'nombre', item->>'leyenda')) AS descripcion,
    COALESCE(item->'metadatos', item - 'codigo' - 'descripcion' - 'nombre' - 'leyenda') AS metadatos
  FROM jsonb_array_elements(p_items) item;

  IF EXISTS (SELECT 1 FROM siat_items_nuevos WHERE codigo = '' OR descripcion = '') THEN
    RAISE EXCEPTION 'La respuesta del catálogo SIAT contiene items incompletos.';
  END IF;

  DELETE FROM public.siat_catalogo_items WHERE catalogo_id = v_catalogo_id;
  INSERT INTO public.siat_catalogo_items (catalogo_id, codigo, descripcion, metadatos, activo)
  SELECT v_catalogo_id, codigo, descripcion, metadatos, true FROM siat_items_nuevos;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO public.siat_sincronizaciones (
    catalogo_id, operacion, estado, fecha_inicio, fecha_fin, cantidad_items, correlation_id
  ) VALUES (
    v_catalogo_id, 'SINCRONIZAR_' || p_codigo, 'COMPLETADA', now(), now(), v_count, p_correlation_id
  );
  UPDATE public.siat_configuracion
    SET ultima_sincronizacion_exitosa = now(), updated_at = now()
    WHERE id = true;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.siat_aplicar_catalogo(text, text, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siat_aplicar_catalogo(text, text, text, text, jsonb, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.siat_aplicar_sincronizacion_completa(
  p_catalogos jsonb,
  p_version_catalogo text,
  p_desfase_hora_sin_ms bigint,
  p_correlation_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_catalogo jsonb;
  v_catalogo_id uuid;
  v_count integer;
  v_total integer := 0;
BEGIN
  IF jsonb_typeof(p_catalogos) <> 'array' OR jsonb_array_length(p_catalogos) = 0 THEN
    RAISE EXCEPTION 'La sincronización SIAT no contiene catálogos.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_catalogos) c
    WHERE jsonb_typeof(c->'items') <> 'array' OR jsonb_array_length(c->'items') = 0
  ) THEN RAISE EXCEPTION 'Uno de los catálogos SIAT está vacío.'; END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_catalogos) c,
      LATERAL jsonb_array_elements(c->'items') i
    WHERE trim(COALESCE(i->>'codigo', '')) = '' OR trim(COALESCE(i->>'descripcion', '')) = ''
  ) THEN RAISE EXCEPTION 'La sincronización SIAT contiene items incompletos.'; END IF;

  FOR v_catalogo IN SELECT value FROM jsonb_array_elements(p_catalogos)
  LOOP
    INSERT INTO public.siat_catalogos (
      codigo, nombre, version_normativa, version_catalogo, fecha_sincronizacion, estado, ultimo_error
    ) VALUES (
      v_catalogo->>'codigo', v_catalogo->>'nombre', 'SIAT_VIGENTE', p_version_catalogo, now(), 'VIGENTE', NULL
    )
    ON CONFLICT (codigo, version_normativa) DO UPDATE SET
      nombre = excluded.nombre, version_catalogo = excluded.version_catalogo,
      fecha_sincronizacion = excluded.fecha_sincronizacion, estado = 'VIGENTE',
      ultimo_error = NULL, updated_at = now()
    RETURNING id INTO v_catalogo_id;

    DELETE FROM public.siat_catalogo_items WHERE catalogo_id = v_catalogo_id;
    INSERT INTO public.siat_catalogo_items (catalogo_id, codigo, descripcion, metadatos, activo)
    SELECT v_catalogo_id, item->>'codigo', item->>'descripcion', COALESCE(item->'metadatos', '{}'::jsonb), true
    FROM jsonb_array_elements(v_catalogo->'items') item;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    v_total := v_total + v_count;
    INSERT INTO public.siat_sincronizaciones (
      catalogo_id, operacion, estado, fecha_inicio, fecha_fin, cantidad_items, correlation_id
    ) VALUES (
      v_catalogo_id, 'SINCRONIZAR_' || (v_catalogo->>'codigo'), 'COMPLETADA', now(), now(), v_count, p_correlation_id
    );
  END LOOP;
  UPDATE public.siat_configuracion SET
    desfase_hora_sin_ms = p_desfase_hora_sin_ms,
    ultima_sincronizacion_exitosa = now(), updated_at = now()
  WHERE id = true;
  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.siat_aplicar_sincronizacion_completa(jsonb, text, bigint, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siat_aplicar_sincronizacion_completa(jsonb, text, bigint, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.siat_guardar_cuis(
  p_sucursal_id uuid, p_punto_venta_id uuid, p_ambiente text,
  p_codigo text, p_fecha_expiracion timestamptz
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  UPDATE public.siat_cuis SET estado = 'VENCIDO', updated_at = now()
  WHERE sucursal_id = p_sucursal_id
    AND punto_venta_id IS NOT DISTINCT FROM p_punto_venta_id
    AND ambiente = p_ambiente AND estado = 'VIGENTE';
  INSERT INTO public.siat_cuis (
    sucursal_id, punto_venta_id, ambiente, codigo, fecha_expiracion, estado
  ) VALUES (
    p_sucursal_id, p_punto_venta_id, p_ambiente, p_codigo, p_fecha_expiracion, 'VIGENTE'
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.siat_guardar_cuis(uuid, uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siat_guardar_cuis(uuid, uuid, text, text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.siat_guardar_cufd(
  p_sucursal_id uuid, p_punto_venta_id uuid, p_cuis_id uuid, p_ambiente text,
  p_codigo text, p_codigo_control text, p_direccion text, p_fecha_expiracion timestamptz
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  UPDATE public.siat_cufd SET estado = 'VENCIDO', updated_at = now()
  WHERE sucursal_id = p_sucursal_id
    AND punto_venta_id IS NOT DISTINCT FROM p_punto_venta_id
    AND ambiente = p_ambiente AND estado = 'VIGENTE';
  INSERT INTO public.siat_cufd (
    sucursal_id, punto_venta_id, cuis_id, ambiente, codigo, codigo_control,
    direccion, fecha_expiracion, estado
  ) VALUES (
    p_sucursal_id, p_punto_venta_id, p_cuis_id, p_ambiente, p_codigo,
    p_codigo_control, p_direccion, p_fecha_expiracion, 'VIGENTE'
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.siat_guardar_cufd(uuid, uuid, uuid, text, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siat_guardar_cufd(uuid, uuid, uuid, text, text, text, text, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.siat_solicitar_operacion_factura(
  p_factura_id uuid,
  p_operacion text,
  p_actor_auth_user_id uuid,
  p_motivo_codigo integer DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_factura public.facturas_siat%ROWTYPE;
  v_estado_nuevo text;
  v_tarea text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.usuarios
    WHERE auth_user_id = p_actor_auth_user_id AND activo = true
      AND rol = 'administrador'
  ) THEN RAISE EXCEPTION 'No tiene permisos para esta operación fiscal.'; END IF;

  SELECT * INTO v_factura FROM public.facturas_siat WHERE id = p_factura_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Factura fiscal no encontrada.'; END IF;

  IF p_operacion = 'ANULAR' THEN
    IF v_factura.estado_fiscal NOT IN ('VALIDADA', 'REVERTIDA') THEN
      RAISE EXCEPTION 'Solo una factura validada puede solicitar anulación.';
    END IF;
    IF p_motivo_codigo IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.siat_catalogos c JOIN public.siat_catalogo_items i ON i.catalogo_id = c.id
      WHERE c.codigo = 'MOTIVOS_ANULACION' AND c.estado = 'VIGENTE'
        AND i.codigo = p_motivo_codigo::text AND i.activo = true
    ) THEN RAISE EXCEPTION 'El motivo de anulación no pertenece al catálogo SIAT vigente.'; END IF;
    v_estado_nuevo := 'ANULACION_PENDIENTE'; v_tarea := 'ANULAR_FACTURA';
    UPDATE public.facturas_siat SET estado_fiscal = v_estado_nuevo,
      motivo_anulacion_codigo = p_motivo_codigo, fecha_solicitud_anulacion = now()
      WHERE id = p_factura_id;
  ELSIF p_operacion = 'REVERTIR_ANULACION' THEN
    IF v_factura.estado_fiscal <> 'ANULADA' THEN RAISE EXCEPTION 'Solo una factura anulada puede solicitar reversión.'; END IF;
    v_estado_nuevo := 'REVERSION_PENDIENTE'; v_tarea := 'REVERTIR_ANULACION';
    UPDATE public.facturas_siat SET estado_fiscal = v_estado_nuevo WHERE id = p_factura_id;
  ELSE RAISE EXCEPTION 'Operación fiscal no permitida.'; END IF;

  INSERT INTO public.siat_outbox (factura_id, tipo_tarea, payload, estado, idempotency_key)
  VALUES (p_factura_id, v_tarea, jsonb_build_object('facturaId', p_factura_id, 'motivo', p_motivo_codigo, 'actor', p_actor_auth_user_id), 'PENDIENTE', lower(v_tarea) || ':' || p_factura_id || ':' || gen_random_uuid());
  INSERT INTO public.siat_auditoria (actor_auth_user_id, entidad, entidad_id, accion, estado_anterior, estado_nuevo, contexto)
  VALUES (p_actor_auth_user_id, 'facturas_siat', p_factura_id::text, 'SOLICITUD_' || p_operacion,
    jsonb_build_object('estado', v_factura.estado_fiscal), jsonb_build_object('estado', v_estado_nuevo), jsonb_build_object('motivo', p_motivo_codigo));
  RETURN v_estado_nuevo;
END;
$$;

REVOKE ALL ON FUNCTION public.siat_solicitar_operacion_factura(uuid, text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siat_solicitar_operacion_factura(uuid, text, uuid, integer) TO service_role;

-- Bucket privado: nunca se crean políticas públicas. Solo service_role escribe;
-- la Edge Function genera enlaces temporales después de autorizar al usuario.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('siat-documentos', 'siat-documentos', false, 10485760,
  ARRAY['application/xml', 'application/pdf', 'application/gzip'])
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS siat_entregas_documentos_lectura ON public.siat_entregas_documentos;
CREATE POLICY siat_entregas_documentos_lectura_restringida ON public.siat_entregas_documentos
  FOR SELECT TO authenticated USING (
    actor_auth_user_id = auth.uid() OR public.siat_es_administrador()
  );

COMMIT;

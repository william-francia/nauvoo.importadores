-- FASE 3 SIAT: agente local, contingencia, recuperación, paquetes, CAFC y readiness.
-- No habilita producción. Las reglas normativas quedan versionadas y trazables.

BEGIN;

CREATE TABLE public.siat_reglas_normativas (
  codigo text NOT NULL,
  version_normativa text NOT NULL CHECK (version_normativa IN ('SIAT_VIGENTE', 'SIAT_LEY_1733_PILOTO')),
  valor jsonb NOT NULL,
  fuente_oficial text NOT NULL,
  vigente_desde date NOT NULL,
  estado text NOT NULL DEFAULT 'VIGENTE' CHECK (estado IN ('VIGENTE', 'INACTIVA', 'PENDIENTE_VERIFICACION')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (codigo, version_normativa)
);

INSERT INTO public.siat_reglas_normativas (codigo, version_normativa, valor, fuente_oficial, vigente_desde) VALUES
  ('MAX_FACTURAS_PAQUETE_CONTINGENCIA', 'SIAT_VIGENTE', '500', 'https://siatinfo.impuestos.gob.bo/index.php/facturacion-en-linea/emision-y-envio-de-facturas/emision-y-envio', DATE '2021-12-01'),
  ('PLAZO_REGISTRO_EVENTO_HORAS', 'SIAT_VIGENTE', '48', 'https://siatinfo.impuestos.gob.bo/index.php/facturacion-en-linea/emision-y-envio-de-facturas/contingencia-y-eventos-significativos', DATE '2021-12-01'),
  ('PLAZO_MANUAL_CAFC_HORAS', 'SIAT_VIGENTE', '72', 'https://siatinfo.impuestos.gob.bo/index.php/facturacion-en-linea/casos-especiales/manuales-contingencia', DATE '2021-12-01'),
  ('MAX_EXTENSION_CUFD_CONTINGENCIA_HORAS', 'SIAT_VIGENTE', '72', 'https://siatinfo.impuestos.gob.bo/index.php/facturacion-en-linea/emision-y-envio-de-facturas/ingreso-a-contingencia', DATE '2021-12-01'),
  ('FALLOS_ANTES_DE_OFFLINE', 'SIAT_VIGENTE', '3', 'https://siatinfo.impuestos.gob.bo/index.php/facturacion-en-linea/emision-y-envio-de-facturas/ingreso-a-contingencia', DATE '2021-12-01'),
  ('REVERIFICACION_OFFLINE_MINUTOS', 'SIAT_VIGENTE', '120', 'https://siatinfo.impuestos.gob.bo/index.php/facturacion-en-linea/emision-y-envio-de-facturas/ingreso-a-contingencia', DATE '2021-12-01');

CREATE TABLE public.siat_agentes_locales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  nombre text NOT NULL,
  sucursal_id uuid NOT NULL REFERENCES public.siat_sucursales(id) ON DELETE RESTRICT,
  punto_venta_id uuid REFERENCES public.siat_puntos_venta(id) ON DELETE RESTRICT,
  version_agente text NOT NULL,
  estado text NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE', 'ACTIVO', 'DEGRADADO', 'OFFLINE', 'INACTIVO', 'BLOQUEADO')),
  ultima_conexion timestamptz,
  ultimo_backup_verificado timestamptz,
  metadatos jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.siat_agent_nonces (
  agente_id uuid NOT NULL REFERENCES public.siat_agentes_locales(id) ON DELETE CASCADE,
  nonce text NOT NULL,
  fecha_solicitud timestamptz NOT NULL,
  expira_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agente_id, nonce)
);

CREATE INDEX siat_agent_nonces_expira_idx ON public.siat_agent_nonces (expira_at);
CREATE UNIQUE INDEX siat_agentes_scope_activo_unique
  ON public.siat_agentes_locales (sucursal_id, punto_venta_id)
  NULLS NOT DISTINCT
  WHERE estado NOT IN ('INACTIVO', 'BLOQUEADO');

CREATE TABLE public.siat_bloques_numeracion_offline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL REFERENCES public.siat_agentes_locales(id) ON DELETE RESTRICT,
  sucursal_id uuid NOT NULL REFERENCES public.siat_sucursales(id) ON DELETE RESTRICT,
  punto_venta_id uuid REFERENCES public.siat_puntos_venta(id) ON DELETE RESTRICT,
  documento_sector integer NOT NULL,
  numero_desde bigint NOT NULL,
  numero_hasta bigint NOT NULL,
  asignado_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sucursal_id, punto_venta_id, documento_sector, numero_desde),
  CHECK (numero_hasta >= numero_desde)
);

CREATE TABLE public.siat_estado_operativo (
  agente_id uuid PRIMARY KEY REFERENCES public.siat_agentes_locales(id) ON DELETE CASCADE,
  estado text NOT NULL CHECK (estado IN (
    'ONLINE', 'DEGRADADO', 'INICIANDO_CONTINGENCIA', 'OFFLINE', 'RECUPERANDO',
    'REGISTRANDO_EVENTO', 'EMPAQUETANDO', 'ENVIANDO_PAQUETES', 'VALIDANDO_PAQUETES'
  )),
  navegador_online boolean,
  backend_remoto_online boolean,
  servicio_siat_online boolean,
  servicio_especifico text,
  fallos_consecutivos integer NOT NULL DEFAULT 0 CHECK (fallos_consecutivos >= 0),
  evento_id uuid REFERENCES public.siat_eventos_significativos(id) ON DELETE RESTRICT,
  evidencia jsonb NOT NULL DEFAULT '{}'::jsonb,
  changed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.siat_eventos_significativos
  ADD COLUMN agente_local_id uuid REFERENCES public.siat_agentes_locales(id) ON DELETE RESTRICT,
  ADD COLUMN local_event_id uuid,
  ADD COLUMN cufd_envio_id uuid REFERENCES public.siat_cufd(id) ON DELETE RESTRICT,
  ADD COLUMN cafc_id uuid REFERENCES public.siat_rangos_cafc(id) ON DELETE RESTRICT,
  ADD COLUMN origen text NOT NULL DEFAULT 'REMOTO' CHECK (origen IN ('AUTOMATICO', 'MANUAL_ADMINISTRATIVO', 'REMOTO')),
  ADD COLUMN evidencia_deteccion jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN fecha_deteccion_recuperacion timestamptz,
  ADD COLUMN fecha_limite_registro timestamptz,
  ADD COLUMN ultimo_error_sanitizado text;

ALTER TABLE public.siat_eventos_significativos DROP CONSTRAINT siat_eventos_significativos_estado_check;
ALTER TABLE public.siat_eventos_significativos ADD CONSTRAINT siat_eventos_significativos_estado_check CHECK (estado IN (
  'REGISTRADO', 'ACTIVO', 'CERRADO', 'ENVIANDO', 'SIN_RESPUESTA', 'CONCILIANDO',
  'ENVIADO', 'EMPAQUETANDO', 'VALIDANDO', 'VALIDADO', 'OBSERVADO', 'CON_ERROR'
));

CREATE UNIQUE INDEX siat_eventos_local_unique
  ON public.siat_eventos_significativos (agente_local_id, local_event_id)
  WHERE local_event_id IS NOT NULL;

ALTER TABLE public.facturas_siat
  ADD COLUMN agente_local_id uuid REFERENCES public.siat_agentes_locales(id) ON DELETE RESTRICT,
  ADD COLUMN origen_caja text,
  ADD COLUMN local_created_at timestamptz,
  ADD COLUMN estado_sincronizacion text NOT NULL DEFAULT 'REMOTO'
    CHECK (estado_sincronizacion IN ('LOCAL', 'PENDIENTE', 'SINCRONIZADA', 'ERROR')),
  ADD COLUMN es_manual_cafc boolean NOT NULL DEFAULT false,
  ADD COLUMN cafc_id uuid REFERENCES public.siat_rangos_cafc(id) ON DELETE RESTRICT,
  ADD COLUMN numero_manual bigint,
  ADD COLUMN evidencia_original_storage_path text;

ALTER TABLE public.siat_paquetes
  ADD COLUMN agente_local_id uuid REFERENCES public.siat_agentes_locales(id) ON DELETE RESTRICT,
  ADD COLUMN documento_sector integer,
  ADD COLUMN sucursal_id uuid REFERENCES public.siat_sucursales(id) ON DELETE RESTRICT,
  ADD COLUMN punto_venta_id uuid REFERENCES public.siat_puntos_venta(id) ON DELETE RESTRICT,
  ADD COLUMN cufd_evento_id uuid REFERENCES public.siat_cufd(id) ON DELETE RESTRICT,
  ADD COLUMN cufd_envio_id uuid REFERENCES public.siat_cufd(id) ON DELETE RESTRICT,
  ADD COLUMN modalidad text CHECK (modalidad IN ('COMPUTARIZADA', 'ELECTRONICA')),
  ADD COLUMN cafc_id uuid REFERENCES public.siat_rangos_cafc(id) ON DELETE RESTRICT,
  ADD COLUMN storage_path text,
  ADD COLUMN correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN mensajes_siat jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN proxima_validacion timestamptz;

CREATE UNIQUE INDEX siat_paquetes_correlation_unique ON public.siat_paquetes (correlation_id);

ALTER TABLE public.siat_paquetes DROP CONSTRAINT siat_paquetes_estado_check;
ALTER TABLE public.siat_paquetes ADD CONSTRAINT siat_paquetes_estado_check CHECK (estado IN (
  'PENDIENTE', 'GENERANDO', 'EN_COLA', 'ENVIADO', 'RECEPCIONADO', 'VALIDANDO',
  'VALIDADO', 'OBSERVADO', 'RECHAZADO', 'SIN_RESPUESTA', 'CONCILIANDO', 'CON_ERROR'
));

CREATE TABLE public.siat_importaciones_offline (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agente_id uuid NOT NULL REFERENCES public.siat_agentes_locales(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE,
  venta_id uuid NOT NULL UNIQUE REFERENCES public.ventas(id) ON DELETE RESTRICT,
  factura_id uuid NOT NULL UNIQUE REFERENCES public.facturas_siat(id) ON DELETE RESTRICT,
  evento_id uuid NOT NULL REFERENCES public.siat_eventos_significativos(id) ON DELETE RESTRICT,
  origen_caja text NOT NULL,
  payload_hash text NOT NULL,
  estado text NOT NULL DEFAULT 'SINCRONIZADA' CHECK (estado IN ('SINCRONIZADA', 'OBSERVADA', 'ERROR')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.siat_cafc_usos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rango_cafc_id uuid NOT NULL REFERENCES public.siat_rangos_cafc(id) ON DELETE RESTRICT,
  numero bigint NOT NULL,
  factura_id uuid UNIQUE REFERENCES public.facturas_siat(id) ON DELETE RESTRICT,
  evento_id uuid REFERENCES public.siat_eventos_significativos(id) ON DELETE RESTRICT,
  agente_id uuid REFERENCES public.siat_agentes_locales(id) ON DELETE RESTRICT,
  estado text NOT NULL CHECK (estado IN ('RESERVADO', 'UTILIZADO', 'ANULADO')),
  evidencia_storage_path text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rango_cafc_id, numero)
);

CREATE TABLE public.siat_evidencias_readiness (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL,
  resultado text NOT NULL CHECK (resultado IN ('APROBADO', 'FALLIDO', 'BLOQUEADO', 'NO_APLICA')),
  ambiente text NOT NULL DEFAULT 'PRUEBAS',
  version_software text NOT NULL,
  detalle jsonb NOT NULL DEFAULT '{}'::jsonb,
  ejecutado_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (codigo, version_software, ejecutado_at)
);

CREATE OR REPLACE FUNCTION public.siat_venta_confirmada_outbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.siat_offline_import', true) = '1' THEN RETURN NEW; END IF;
  IF NEW.estado = 'confirmada' AND OLD.estado IS DISTINCT FROM NEW.estado THEN
    PERFORM public.siat_crear_factura_outbox(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.siat_importar_evento_offline(
  p_agente_codigo text,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agente public.siat_agentes_locales%ROWTYPE;
  v_evento_id uuid := (p_payload->>'id')::uuid;
  v_cufd_id uuid := (p_payload->>'cufdId')::uuid;
  v_fecha_inicio timestamptz := (p_payload->>'fechaInicio')::timestamptz;
  v_fecha_fin timestamptz := (p_payload->>'fechaFin')::timestamptz;
BEGIN
  SELECT * INTO v_agente FROM public.siat_agentes_locales
  WHERE codigo = p_agente_codigo AND estado <> 'BLOQUEADO' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agente local no registrado o bloqueado.'; END IF;
  IF v_fecha_fin < v_fecha_inicio OR v_fecha_fin > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Ventana de contingencia inválida.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.siat_cufd c
    WHERE c.id = v_cufd_id AND c.sucursal_id = v_agente.sucursal_id
      AND c.punto_venta_id IS NOT DISTINCT FROM v_agente.punto_venta_id
  ) THEN RAISE EXCEPTION 'El CUFD del evento no pertenece al agente local.'; END IF;

  INSERT INTO public.siat_eventos_significativos (
    id, sucursal_id, punto_venta_id, cufd_id, tipo_evento_codigo, descripcion,
    observaciones, fecha_inicio, fecha_fin, estado, actor_auth_user_id,
    agente_local_id, local_event_id, origen, evidencia_deteccion,
    fecha_deteccion_recuperacion, fecha_limite_registro
  ) VALUES (
    v_evento_id, v_agente.sucursal_id, v_agente.punto_venta_id, v_cufd_id,
    p_payload->>'tipoEventoCodigo', p_payload->>'descripcion', p_payload->>'observaciones',
    v_fecha_inicio, v_fecha_fin, 'CERRADO', nullif(p_payload->>'actorAuthUserId', '')::uuid,
    v_agente.id, v_evento_id,
    CASE WHEN COALESCE((p_payload->>'automatico')::boolean, false) THEN 'AUTOMATICO' ELSE 'MANUAL_ADMINISTRATIVO' END,
    COALESCE(p_payload->'evidencia', '{}'::jsonb), v_fecha_fin, v_fecha_fin + interval '48 hours'
  ) ON CONFLICT (id) DO NOTHING;

  UPDATE public.siat_agentes_locales SET ultima_conexion = now(), estado = 'ACTIVO' WHERE id = v_agente.id;
  RETURN v_evento_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.siat_importar_factura_offline(
  p_agente_codigo text,
  p_payload jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agente public.siat_agentes_locales%ROWTYPE;
  v_evento public.siat_eventos_significativos%ROWTYPE;
  v_config public.siat_configuracion%ROWTYPE;
  v_cufd public.siat_cufd%ROWTYPE;
  v_cuis public.siat_cuis%ROWTYPE;
  v_sucursal public.siat_sucursales%ROWTYPE;
  v_punto public.siat_puntos_venta%ROWTYPE;
  v_usuario_id uuid;
  v_venta_id uuid := (p_payload->>'ventaId')::uuid;
  v_factura_id uuid := (p_payload->>'facturaId')::uuid;
  v_evento_id uuid := (p_payload->>'eventoId')::uuid;
  v_idempotency text := p_payload->>'idempotencyKey';
  v_item record;
  v_total numeric(16,2);
  v_existente uuid;
  v_cafc_id uuid := nullif(p_payload->>'cafcId', '')::uuid;
  v_numero_manual bigint := nullif(p_payload->>'numeroManual', '')::bigint;
BEGIN
  IF COALESCE(v_idempotency, '') = '' OR jsonb_typeof(p_payload->'items') <> 'array'
     OR jsonb_array_length(p_payload->'items') = 0 THEN
    RAISE EXCEPTION 'Carga offline inválida.';
  END IF;
  SELECT factura_id INTO v_existente FROM public.siat_importaciones_offline WHERE idempotency_key = v_idempotency;
  IF v_existente IS NOT NULL THEN RETURN v_existente; END IF;

  SELECT * INTO v_agente FROM public.siat_agentes_locales
   WHERE codigo = p_agente_codigo AND estado <> 'BLOQUEADO' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agente local no registrado o bloqueado.'; END IF;
  SELECT * INTO v_evento FROM public.siat_eventos_significativos
   WHERE id = v_evento_id AND agente_local_id = v_agente.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Evento offline no importado.'; END IF;
  SELECT * INTO v_config FROM public.siat_configuracion WHERE id = true;
  IF v_config.ambiente <> 'PRUEBAS' OR v_config.version_normativa <> 'SIAT_VIGENTE' THEN
    RAISE EXCEPTION 'La recuperación solo está habilitada en pruebas y SIAT vigente.';
  END IF;
  SELECT * INTO v_cufd FROM public.siat_cufd WHERE id = v_evento.cufd_id;
  SELECT * INTO v_cuis FROM public.siat_cuis WHERE id = v_cufd.cuis_id;
  SELECT * INTO v_sucursal FROM public.siat_sucursales WHERE id = v_agente.sucursal_id;
  IF v_agente.punto_venta_id IS NOT NULL THEN SELECT * INTO v_punto FROM public.siat_puntos_venta WHERE id = v_agente.punto_venta_id; END IF;
  SELECT id INTO v_usuario_id FROM public.usuarios
   WHERE auth_user_id = nullif(p_payload->>'actorAuthUserId', '')::uuid AND activo = true;
  IF v_usuario_id IS NULL THEN RAISE EXCEPTION 'El actor offline ya no es un usuario activo.'; END IF;

  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_payload->'items') AS item(
    "productoId" uuid, "almacenId" uuid, cantidad numeric, "precioUnitario" numeric, descuento numeric
  ) LOOP
    IF v_item."productoId" IS NULL OR v_item."almacenId" IS NULL OR v_item.cantidad <= 0
       OR v_item."precioUnitario" < 0 OR v_item.descuento < 0 THEN RAISE EXCEPTION 'Detalle offline inválido.'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.siat_producto_homologaciones h WHERE h.producto_id = v_item."productoId" AND h.estado = 'HOMOLOGADO' AND h.version_normativa = 'SIAT_VIGENTE') THEN
      RAISE EXCEPTION 'Producto offline sin homologación vigente.';
    END IF;
  END LOOP;

  PERFORM set_config('app.siat_offline_import', '1', true);
  INSERT INTO public.ventas (id, codigo_venta, cliente_id, usuario_id, metodo_pago, estado, observacion)
  VALUES (
    v_venta_id, p_payload->>'codigoVenta', nullif(p_payload->>'clienteId', '')::uuid,
    v_usuario_id, p_payload->>'metodoPago', 'pendiente', nullif(p_payload->>'observacion', '')
  );
  FOR v_item IN SELECT * FROM jsonb_to_recordset(p_payload->'items') AS item(
    "productoId" uuid, "almacenId" uuid, "codigoProducto" text, descripcion text,
    cantidad numeric, "precioUnitario" numeric, descuento numeric
  ) LOOP
    INSERT INTO public.detalle_ventas (
      venta_id, producto_id, almacen_id, codigo_producto_snapshot,
      descripcion_producto, cantidad, precio_unitario, tipo_precio, descuento
    ) VALUES (
      v_venta_id, v_item."productoId", v_item."almacenId", v_item."codigoProducto",
      v_item.descripcion, v_item.cantidad, v_item."precioUnitario", 'pieza', v_item.descuento
    );
  END LOOP;
  UPDATE public.ventas SET descuento_venta = COALESCE((p_payload->>'descuentoVenta')::numeric, 0), estado = 'confirmada'
   WHERE id = v_venta_id RETURNING total INTO v_total;
  IF v_total IS DISTINCT FROM (p_payload->'totalesSnapshot'->>'montoTotal')::numeric THEN
    RAISE EXCEPTION 'El total local no coincide con el total recalculado en servidor.';
  END IF;

  INSERT INTO public.facturas_siat (
    id, venta_id, idempotency_key, correlation_id, ambiente, version_especificacion,
    modalidad, documento_sector, tipo_factura, sucursal_id, punto_venta_id,
    cuis_id, cufd_id, tipo_emision, estado_fiscal, numero_factura, fecha_emision,
    codigo_sucursal, codigo_punto_venta, cuis, cufd, cuf, nombre_razon_social,
    tipo_documento, numero_documento, complemento, monto_total, cliente_snapshot,
    detalle_snapshot, totales_snapshot, pago_snapshot, sucursal_snapshot,
    punto_venta_snapshot, xml_documento, xml_hash, xml_firmado, xml_storage_path,
    pdf_storage_path, qr_contenido, evento_id, agente_local_id, origen_caja,
    local_created_at, estado_sincronizacion, es_manual_cafc, cafc_id, numero_manual,
    version_xsd, hash_xsd
  ) VALUES (
    v_factura_id, v_venta_id, v_idempotency, (p_payload->>'correlationId')::uuid,
    'PRUEBAS', 'SIAT_VIGENTE', p_payload->>'modalidad', (p_payload->>'documentoSector')::integer,
    (p_payload->>'tipoFactura')::integer, v_sucursal.id, v_agente.punto_venta_id,
    v_cuis.id, v_cufd.id, 'OFFLINE', 'OFFLINE', (p_payload->>'numeroFactura')::bigint,
    (p_payload->>'fechaEmision')::timestamptz, v_sucursal.codigo, COALESCE(v_punto.codigo, 0),
    v_cuis.codigo, v_cufd.codigo, p_payload->>'cuf',
    p_payload->'clienteSnapshot'->>'nombreRazonSocial', p_payload->'clienteSnapshot'->>'codigoTipoDocumentoIdentidad',
    p_payload->'clienteSnapshot'->>'numeroDocumento', p_payload->'clienteSnapshot'->>'complemento',
    v_total, p_payload->'clienteSnapshot', p_payload->'detalleSnapshot', p_payload->'totalesSnapshot',
    p_payload->'pagoSnapshot', to_jsonb(v_sucursal), CASE WHEN v_punto.id IS NULL THEN '{}'::jsonb ELSE to_jsonb(v_punto) END,
    p_payload->>'xmlDocumento', p_payload->>'xmlHash', COALESCE((p_payload->>'xmlFirmado')::boolean, false),
    p_payload->>'xmlStoragePath', p_payload->>'pdfStoragePath', p_payload->>'qrContenido',
    v_evento.id, v_agente.id, p_payload->>'origenCaja', (p_payload->>'fechaEmision')::timestamptz,
    'SINCRONIZADA', COALESCE((p_payload->>'esManualCafc')::boolean, false), v_cafc_id,
    v_numero_manual, p_payload->>'versionXsd', p_payload->>'hashXsd'
  );

  IF v_cafc_id IS NOT NULL THEN
    IF v_numero_manual IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.siat_rangos_cafc r WHERE r.id = v_cafc_id
        AND v_numero_manual BETWEEN r.rango_desde AND r.rango_hasta
    ) THEN RAISE EXCEPTION 'Número CAFC fuera del rango autorizado.'; END IF;
    INSERT INTO public.siat_cafc_usos (rango_cafc_id, numero, factura_id, evento_id, agente_id, estado, evidencia_storage_path)
    VALUES (v_cafc_id, v_numero_manual, v_factura_id, v_evento.id, v_agente.id, 'UTILIZADO', p_payload->>'evidenciaOriginalStoragePath');
  END IF;

  INSERT INTO public.siat_importaciones_offline (
    agente_id, idempotency_key, venta_id, factura_id, evento_id, origen_caja, payload_hash
  ) VALUES (v_agente.id, v_idempotency, v_venta_id, v_factura_id, v_evento.id, p_payload->>'origenCaja', p_payload->>'payloadHash');
  INSERT INTO public.siat_auditoria (entidad, entidad_id, accion, estado_nuevo, actor_auth_user_id, contexto, resultado)
  VALUES ('facturas_siat', v_factura_id, 'IMPORTACION_OFFLINE_IDEMPOTENTE', jsonb_build_object('estado', 'OFFLINE'), nullif(p_payload->>'actorAuthUserId', '')::uuid, jsonb_build_object('agente', p_agente_codigo, 'evento', v_evento.id), 'EXITOSO');
  RETURN v_factura_id;
END;
$$;

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
  UPDATE public.siat_eventos_significativos SET estado = 'CERRADO' WHERE id = p_evento_id;
  RETURN 'EN_COLA';
END;
$$;

CREATE OR REPLACE FUNCTION public.siat_reservar_bloque_offline(
  p_agente_codigo text,
  p_cantidad integer DEFAULT 1000
)
RETURNS TABLE (numero_desde bigint, numero_hasta bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agente public.siat_agentes_locales%ROWTYPE;
  v_documento integer;
  v_desde bigint;
BEGIN
  IF p_cantidad NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Tamaño de bloque offline inválido.'; END IF;
  SELECT * INTO v_agente FROM public.siat_agentes_locales
   WHERE codigo = p_agente_codigo AND estado IN ('PENDIENTE', 'ACTIVO', 'DEGRADADO', 'OFFLINE') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agente local no habilitado.'; END IF;
  SELECT documento_sector INTO v_documento FROM public.siat_configuracion WHERE id = true;
  IF v_documento IS NULL THEN RAISE EXCEPTION 'Documento sector no configurado.'; END IF;

  INSERT INTO public.siat_secuencias (sucursal_id, punto_venta_id, documento_sector, tipo_emision, siguiente_numero)
  VALUES (v_agente.sucursal_id, v_agente.punto_venta_id, v_documento, 'OFFLINE', 1)
  ON CONFLICT (sucursal_id, punto_venta_id, documento_sector, tipo_emision) DO NOTHING;
  UPDATE public.siat_secuencias
   SET siguiente_numero = siguiente_numero + p_cantidad, updated_at = now()
   WHERE sucursal_id = v_agente.sucursal_id
     AND punto_venta_id IS NOT DISTINCT FROM v_agente.punto_venta_id
     AND documento_sector = v_documento AND tipo_emision = 'OFFLINE'
   RETURNING siguiente_numero - p_cantidad INTO v_desde;
  INSERT INTO public.siat_bloques_numeracion_offline (
    agente_id, sucursal_id, punto_venta_id, documento_sector, numero_desde, numero_hasta
  ) VALUES (v_agente.id, v_agente.sucursal_id, v_agente.punto_venta_id, v_documento, v_desde, v_desde + p_cantidad - 1);
  RETURN QUERY SELECT v_desde, v_desde + p_cantidad - 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.siat_crear_paquete_evento(
  p_evento_id uuid,
  p_factura_ids uuid[],
  p_archivo_hash text,
  p_storage_path text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_evento public.siat_eventos_significativos%ROWTYPE;
  v_primera public.facturas_siat%ROWTYPE;
  v_paquete_id uuid;
  v_count integer := COALESCE(array_length(p_factura_ids, 1), 0);
BEGIN
  IF v_count NOT BETWEEN 1 AND 500 OR COALESCE(p_archivo_hash, '') = '' OR COALESCE(p_storage_path, '') = '' THEN
    RAISE EXCEPTION 'Datos de paquete inválidos.';
  END IF;
  SELECT * INTO v_evento FROM public.siat_eventos_significativos WHERE id = p_evento_id FOR UPDATE;
  IF NOT FOUND OR v_evento.codigo_recepcion IS NULL OR v_evento.estado <> 'ENVIADO' THEN
    RAISE EXCEPTION 'El evento debe estar registrado en SIN antes de empaquetar.';
  END IF;
  SELECT * INTO v_primera FROM public.facturas_siat WHERE id = p_factura_ids[1] AND evento_id = p_evento_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Factura inicial del paquete no encontrada.'; END IF;
  IF (SELECT count(*) FROM public.facturas_siat f
      WHERE f.id = ANY(p_factura_ids) AND f.evento_id = p_evento_id
        AND f.documento_sector = v_primera.documento_sector
        AND f.sucursal_id = v_primera.sucursal_id
        AND f.punto_venta_id IS NOT DISTINCT FROM v_primera.punto_venta_id
        AND f.cufd_id = v_primera.cufd_id AND f.modalidad = v_primera.modalidad
        AND f.cafc_id IS NOT DISTINCT FROM v_primera.cafc_id
        AND f.tipo_emision = 'OFFLINE' AND f.estado_fiscal = 'OFFLINE') <> v_count THEN
    RAISE EXCEPTION 'Las facturas no cumplen el agrupamiento oficial o ya fueron empaquetadas.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.siat_paquete_facturas WHERE factura_id = ANY(p_factura_ids)) THEN
    RAISE EXCEPTION 'Una factura ya pertenece a otro paquete.';
  END IF;

  INSERT INTO public.siat_paquetes (
    evento_id, agente_local_id, estado, cantidad_facturas, archivo_hash, storage_path,
    documento_sector, sucursal_id, punto_venta_id, cufd_evento_id, cufd_envio_id,
    modalidad, cafc_id
  ) VALUES (
    p_evento_id, v_evento.agente_local_id, 'EN_COLA', v_count, p_archivo_hash, p_storage_path,
    v_primera.documento_sector, v_primera.sucursal_id, v_primera.punto_venta_id,
    v_evento.cufd_id, v_evento.cufd_envio_id, v_primera.modalidad, v_primera.cafc_id
  ) RETURNING id INTO v_paquete_id;
  INSERT INTO public.siat_paquete_facturas (paquete_id, factura_id, posicion)
  SELECT v_paquete_id, value, ordinality::integer FROM unnest(p_factura_ids) WITH ORDINALITY AS ids(value, ordinality);
  UPDATE public.facturas_siat SET estado_fiscal = 'EMPAQUETADA' WHERE id = ANY(p_factura_ids);
  INSERT INTO public.siat_outbox (factura_id, tipo_tarea, payload, estado, idempotency_key)
  VALUES (NULL, 'ENVIAR_PAQUETE', jsonb_build_object('paqueteId', v_paquete_id), 'PENDIENTE', 'enviar_paquete:' || v_paquete_id::text);
  RETURN v_paquete_id;
END;
$$;

REVOKE ALL ON FUNCTION public.siat_importar_evento_offline(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.siat_importar_factura_offline(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.siat_programar_recuperacion_evento(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.siat_reservar_bloque_offline(text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.siat_crear_paquete_evento(uuid, uuid[], text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siat_importar_evento_offline(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.siat_importar_factura_offline(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.siat_programar_recuperacion_evento(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.siat_reservar_bloque_offline(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.siat_crear_paquete_evento(uuid, uuid[], text, text) TO service_role;

ALTER TABLE public.siat_reglas_normativas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_agentes_locales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_agent_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_bloques_numeracion_offline ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_estado_operativo ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_importaciones_offline ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_cafc_usos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_evidencias_readiness ENABLE ROW LEVEL SECURITY;

CREATE POLICY siat_reglas_lectura ON public.siat_reglas_normativas FOR SELECT TO authenticated USING (true);
CREATE POLICY siat_agentes_admin_lectura ON public.siat_agentes_locales FOR SELECT TO authenticated USING (public.siat_es_administrador());
CREATE POLICY siat_estado_operativo_lectura ON public.siat_estado_operativo FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.usuarios u WHERE u.auth_user_id = auth.uid() AND u.activo = true AND u.rol IN ('administrador', 'vendedor', 'caja'))
);
CREATE POLICY siat_importaciones_admin_lectura ON public.siat_importaciones_offline FOR SELECT TO authenticated USING (public.siat_es_administrador());
CREATE POLICY siat_bloques_admin_lectura ON public.siat_bloques_numeracion_offline FOR SELECT TO authenticated USING (public.siat_es_administrador());
CREATE POLICY siat_cafc_usos_admin_lectura ON public.siat_cafc_usos FOR SELECT TO authenticated USING (public.siat_es_administrador());
CREATE POLICY siat_evidencias_admin_lectura ON public.siat_evidencias_readiness FOR SELECT TO authenticated USING (public.siat_es_administrador());

GRANT SELECT ON public.siat_reglas_normativas, public.siat_estado_operativo TO authenticated;
GRANT SELECT ON public.siat_agentes_locales, public.siat_importaciones_offline,
  public.siat_cafc_usos, public.siat_evidencias_readiness, public.siat_bloques_numeracion_offline TO authenticated;

CREATE TRIGGER trg_siat_agentes_updated_at BEFORE UPDATE ON public.siat_agentes_locales
  FOR EACH ROW EXECUTE FUNCTION public.fn_actualizar_updated_at();
CREATE TRIGGER trg_siat_estado_operativo_updated_at BEFORE UPDATE ON public.siat_estado_operativo
  FOR EACH ROW EXECUTE FUNCTION public.fn_actualizar_updated_at();

COMMENT ON TABLE public.siat_agentes_locales IS 'Agentes locales autorizados. Los secretos de emparejamiento permanecen fuera de PostgreSQL en el backend seguro.';
COMMENT ON TABLE public.siat_reglas_normativas IS 'Reglas de contingencia versionadas con su fuente oficial; evita constantes fiscales silenciosas.';
COMMENT ON TABLE public.siat_importaciones_offline IS 'Barrera de idempotencia entre venta local, inventario remoto y factura fiscal.';

COMMIT;

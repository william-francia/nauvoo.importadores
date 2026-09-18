-- FASE 1 SIAT: modelo fiscal, persistencia operativa y seguridad base.
-- No contiene credenciales, secretos, datos de prueba ni llamadas al SIN.

BEGIN;

CREATE OR REPLACE FUNCTION public.siat_es_administrador()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuarios
    WHERE auth_user_id = auth.uid()
      AND rol = 'administrador'
      AND activo = true
  );
$$;

REVOKE ALL ON FUNCTION public.siat_es_administrador() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.siat_es_administrador() TO authenticated;

CREATE TABLE public.siat_configuracion (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  nit text,
  razon_social text,
  nombre_comercial text,
  municipio text,
  domicilio text,
  telefono text,
  codigo_sistema text,
  modalidad text NOT NULL DEFAULT 'COMPUTARIZADA'
    CHECK (modalidad IN ('COMPUTARIZADA', 'ELECTRONICA')),
  documento_sector integer,
  tipo_factura integer,
  actividad_economica text,
  ambiente text NOT NULL DEFAULT 'PRUEBAS'
    CHECK (ambiente IN ('PRUEBAS', 'PRODUCCION')),
  version_normativa text NOT NULL DEFAULT 'SIAT_VIGENTE'
    CHECK (version_normativa IN ('SIAT_VIGENTE', 'SIAT_LEY_1733_PILOTO')),
  zona_horaria text NOT NULL DEFAULT 'America/La_Paz'
    CHECK (zona_horaria = 'America/La_Paz'),
  siat_habilitado boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT siat_habilitado OR ambiente = 'PRUEBAS'),
  CHECK (version_normativa <> 'SIAT_LEY_1733_PILOTO' OR NOT siat_habilitado)
);

INSERT INTO public.siat_configuracion (id, ambiente, version_normativa, siat_habilitado)
VALUES (true, 'PRUEBAS', 'SIAT_VIGENTE', false)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE public.siat_sucursales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo integer NOT NULL UNIQUE CHECK (codigo >= 0),
  nombre text NOT NULL,
  municipio text,
  direccion text,
  telefono text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.siat_puntos_venta (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id uuid NOT NULL REFERENCES public.siat_sucursales(id) ON DELETE RESTRICT,
  codigo integer NOT NULL CHECK (codigo >= 0),
  nombre text NOT NULL,
  tipo_punto_venta_codigo integer,
  descripcion text,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sucursal_id, codigo)
);

CREATE TABLE public.siat_terminales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL UNIQUE,
  nombre text NOT NULL,
  punto_venta_id uuid REFERENCES public.siat_puntos_venta(id) ON DELETE RESTRICT,
  almacen_id uuid REFERENCES public.almacenes(id) ON DELETE RESTRICT,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.siat_cuis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id uuid NOT NULL REFERENCES public.siat_sucursales(id) ON DELETE RESTRICT,
  punto_venta_id uuid REFERENCES public.siat_puntos_venta(id) ON DELETE RESTRICT,
  ambiente text NOT NULL CHECK (ambiente IN ('PRUEBAS', 'PRODUCCION')),
  codigo text NOT NULL,
  fecha_obtencion timestamptz NOT NULL DEFAULT now(),
  fecha_expiracion timestamptz,
  estado text NOT NULL DEFAULT 'VIGENTE'
    CHECK (estado IN ('VIGENTE', 'VENCIDO', 'REVOCADO', 'CON_ERROR')),
  ultimo_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX siat_cuis_vigente_por_punto
  ON public.siat_cuis (sucursal_id, COALESCE(punto_venta_id, '00000000-0000-0000-0000-000000000000'::uuid), ambiente)
  WHERE estado = 'VIGENTE';

CREATE TABLE public.siat_cufd (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id uuid NOT NULL REFERENCES public.siat_sucursales(id) ON DELETE RESTRICT,
  punto_venta_id uuid REFERENCES public.siat_puntos_venta(id) ON DELETE RESTRICT,
  cuis_id uuid NOT NULL REFERENCES public.siat_cuis(id) ON DELETE RESTRICT,
  ambiente text NOT NULL CHECK (ambiente IN ('PRUEBAS', 'PRODUCCION')),
  codigo text NOT NULL,
  codigo_control text NOT NULL,
  direccion text,
  fecha_inicio timestamptz NOT NULL DEFAULT now(),
  fecha_expiracion timestamptz NOT NULL,
  estado text NOT NULL DEFAULT 'VIGENTE'
    CHECK (estado IN ('VIGENTE', 'VENCIDO', 'REVOCADO', 'CON_ERROR')),
  ultimo_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (fecha_expiracion > fecha_inicio)
);

CREATE INDEX siat_cufd_vigencia_idx
  ON public.siat_cufd (sucursal_id, punto_venta_id, ambiente, fecha_expiracion DESC);

CREATE TABLE public.siat_catalogos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo text NOT NULL,
  nombre text NOT NULL,
  version_normativa text NOT NULL DEFAULT 'SIAT_VIGENTE'
    CHECK (version_normativa IN ('SIAT_VIGENTE', 'SIAT_LEY_1733_PILOTO')),
  version_catalogo text,
  fecha_sincronizacion timestamptz,
  estado text NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE', 'SINCRONIZANDO', 'VIGENTE', 'CON_ERROR')),
  ultimo_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (codigo, version_normativa)
);

CREATE TABLE public.siat_catalogo_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalogo_id uuid NOT NULL REFERENCES public.siat_catalogos(id) ON DELETE CASCADE,
  codigo text NOT NULL,
  descripcion text NOT NULL,
  metadatos jsonb NOT NULL DEFAULT '{}'::jsonb,
  vigente_desde timestamptz,
  vigente_hasta timestamptz,
  activo boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (catalogo_id, codigo)
);

CREATE INDEX siat_catalogo_items_busqueda_idx
  ON public.siat_catalogo_items (catalogo_id, activo, codigo);

CREATE TABLE public.siat_sincronizaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalogo_id uuid REFERENCES public.siat_catalogos(id) ON DELETE SET NULL,
  operacion text NOT NULL,
  estado text NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE', 'EN_PROCESO', 'COMPLETADA', 'CON_ERROR')),
  fecha_inicio timestamptz NOT NULL DEFAULT now(),
  fecha_fin timestamptz,
  cantidad_items integer NOT NULL DEFAULT 0 CHECK (cantidad_items >= 0),
  ultimo_error text,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX siat_sincronizaciones_fecha_idx
  ON public.siat_sincronizaciones (fecha_inicio DESC);

CREATE TABLE public.siat_producto_homologaciones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producto_id uuid NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  codigo_interno_snapshot text NOT NULL,
  codigo_producto_sin text NOT NULL,
  actividad_economica text NOT NULL,
  unidad_medida_sin text NOT NULL,
  origen text NOT NULL CHECK (origen IN ('NACIONAL', 'IMPORTADO', 'SERVICIO')),
  version_catalogo text,
  version_normativa text NOT NULL DEFAULT 'SIAT_VIGENTE'
    CHECK (version_normativa IN ('SIAT_VIGENTE', 'SIAT_LEY_1733_PILOTO')),
  estado text NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE', 'HOMOLOGADO', 'INVALIDO', 'INACTIVO')),
  fecha_homologacion timestamptz,
  responsable_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (producto_id, version_normativa)
);

CREATE TABLE public.siat_secuencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id uuid NOT NULL REFERENCES public.siat_sucursales(id) ON DELETE RESTRICT,
  punto_venta_id uuid REFERENCES public.siat_puntos_venta(id) ON DELETE RESTRICT,
  documento_sector integer NOT NULL,
  tipo_emision text NOT NULL CHECK (tipo_emision IN ('ONLINE', 'OFFLINE')),
  siguiente_numero bigint NOT NULL DEFAULT 1 CHECK (siguiente_numero > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE NULLS NOT DISTINCT (sucursal_id, punto_venta_id, documento_sector, tipo_emision)
);

CREATE TABLE public.siat_eventos_significativos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id uuid NOT NULL REFERENCES public.siat_sucursales(id) ON DELETE RESTRICT,
  punto_venta_id uuid REFERENCES public.siat_puntos_venta(id) ON DELETE RESTRICT,
  cufd_id uuid REFERENCES public.siat_cufd(id) ON DELETE RESTRICT,
  tipo_evento_codigo text,
  descripcion text,
  observaciones text,
  fecha_inicio timestamptz NOT NULL,
  fecha_fin timestamptz,
  estado text NOT NULL DEFAULT 'REGISTRADO'
    CHECK (estado IN ('REGISTRADO', 'ACTIVO', 'CERRADO', 'ENVIADO', 'VALIDADO', 'OBSERVADO', 'CON_ERROR')),
  codigo_recepcion text,
  respuesta_siat jsonb,
  actor_auth_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (fecha_fin IS NULL OR fecha_fin >= fecha_inicio)
);

CREATE INDEX siat_eventos_estado_fecha_idx
  ON public.siat_eventos_significativos (estado, fecha_inicio DESC);

CREATE TABLE public.siat_rangos_cafc (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id uuid NOT NULL REFERENCES public.siat_sucursales(id) ON DELETE RESTRICT,
  punto_venta_id uuid REFERENCES public.siat_puntos_venta(id) ON DELETE RESTRICT,
  autorizacion text NOT NULL,
  rango_desde bigint NOT NULL CHECK (rango_desde > 0),
  rango_hasta bigint NOT NULL CHECK (rango_hasta >= rango_desde),
  siguiente_numero bigint NOT NULL CHECK (siguiente_numero >= rango_desde),
  vigente_desde timestamptz NOT NULL,
  vigente_hasta timestamptz NOT NULL,
  estado text NOT NULL DEFAULT 'VIGENTE'
    CHECK (estado IN ('VIGENTE', 'AGOTADO', 'VENCIDO', 'INACTIVO')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (vigente_hasta > vigente_desde),
  UNIQUE (autorizacion, sucursal_id, punto_venta_id)
);

CREATE TABLE public.siat_paquetes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evento_id uuid REFERENCES public.siat_eventos_significativos(id) ON DELETE RESTRICT,
  codigo_recepcion text,
  estado text NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE', 'GENERANDO', 'EN_COLA', 'ENVIADO', 'RECEPCIONADO', 'VALIDANDO', 'VALIDADO', 'OBSERVADO', 'RECHAZADO', 'CON_ERROR')),
  cantidad_facturas integer NOT NULL DEFAULT 0 CHECK (cantidad_facturas BETWEEN 0 AND 500),
  archivo_hash text,
  intentos integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  ultimo_error text,
  fecha_envio timestamptz,
  fecha_validacion timestamptz,
  respuesta_siat jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.facturas_siat
  ALTER COLUMN cuf DROP NOT NULL,
  ALTER COLUMN numero_factura DROP NOT NULL,
  ALTER COLUMN cuis DROP NOT NULL,
  ALTER COLUMN cufd DROP NOT NULL,
  ALTER COLUMN fecha_emision SET DEFAULT now(),
  ADD COLUMN idempotency_key text,
  ADD COLUMN ambiente text NOT NULL DEFAULT 'PRUEBAS',
  ADD COLUMN version_especificacion text NOT NULL DEFAULT 'SIAT_VIGENTE',
  ADD COLUMN modalidad text NOT NULL DEFAULT 'COMPUTARIZADA',
  ADD COLUMN documento_sector integer,
  ADD COLUMN tipo_factura integer,
  ADD COLUMN sucursal_id uuid REFERENCES public.siat_sucursales(id) ON DELETE RESTRICT,
  ADD COLUMN punto_venta_id uuid REFERENCES public.siat_puntos_venta(id) ON DELETE RESTRICT,
  ADD COLUMN cuis_id uuid REFERENCES public.siat_cuis(id) ON DELETE RESTRICT,
  ADD COLUMN cufd_id uuid REFERENCES public.siat_cufd(id) ON DELETE RESTRICT,
  ADD COLUMN tipo_emision text NOT NULL DEFAULT 'ONLINE',
  ADD COLUMN estado_fiscal text NOT NULL DEFAULT 'BORRADOR',
  ADD COLUMN cliente_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN detalle_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN totales_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN pago_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN sucursal_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN punto_venta_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN xml_documento text,
  ADD COLUMN xml_hash text,
  ADD COLUMN mensajes_siat jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN cantidad_intentos integer NOT NULL DEFAULT 0,
  ADD COLUMN evento_id uuid REFERENCES public.siat_eventos_significativos(id) ON DELETE RESTRICT,
  ADD COLUMN motivo_anulacion_codigo integer,
  ADD COLUMN motivo_anulacion text,
  ADD COLUMN fecha_solicitud_anulacion timestamptz,
  ADD COLUMN respuesta_anulacion jsonb,
  ADD COLUMN fecha_reversion timestamptz,
  ADD COLUMN respuesta_reversion jsonb,
  ADD COLUMN version_xsd text,
  ADD COLUMN hash_xsd text;

ALTER TABLE public.facturas_siat
  ADD CONSTRAINT facturas_siat_ambiente_valido
    CHECK (ambiente IN ('PRUEBAS', 'PRODUCCION')),
  ADD CONSTRAINT facturas_siat_version_valida
    CHECK (version_especificacion IN ('SIAT_VIGENTE', 'SIAT_LEY_1733_PILOTO')),
  ADD CONSTRAINT facturas_siat_modalidad_valida
    CHECK (modalidad IN ('COMPUTARIZADA', 'ELECTRONICA')),
  ADD CONSTRAINT facturas_siat_tipo_emision_valido
    CHECK (tipo_emision IN ('ONLINE', 'OFFLINE')),
  ADD CONSTRAINT facturas_siat_estado_fiscal_valido CHECK (estado_fiscal IN (
    'BORRADOR', 'EN_COLA', 'GENERANDO', 'VALIDANDO_XSD', 'ENVIANDO',
    'SIN_RESPUESTA', 'CONCILIANDO', 'VALIDADA', 'OBSERVADA', 'RECHAZADA',
    'OFFLINE', 'EMPAQUETADA', 'PAQUETE_PENDIENTE', 'ANULACION_PENDIENTE',
    'ANULADA', 'REVERSION_PENDIENTE', 'REVERTIDA'
  )),
  ADD CONSTRAINT facturas_siat_intentos_validos CHECK (cantidad_intentos >= 0);

CREATE UNIQUE INDEX facturas_siat_idempotency_key_unique
  ON public.facturas_siat (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX facturas_siat_estado_fecha_idx
  ON public.facturas_siat (estado_fiscal, fecha_emision DESC);
CREATE INDEX facturas_siat_evento_idx
  ON public.facturas_siat (evento_id)
  WHERE evento_id IS NOT NULL;

CREATE TABLE public.siat_paquete_facturas (
  paquete_id uuid NOT NULL REFERENCES public.siat_paquetes(id) ON DELETE RESTRICT,
  factura_id uuid NOT NULL REFERENCES public.facturas_siat(id) ON DELETE RESTRICT,
  posicion integer NOT NULL CHECK (posicion BETWEEN 1 AND 500),
  PRIMARY KEY (paquete_id, factura_id),
  UNIQUE (factura_id),
  UNIQUE (paquete_id, posicion)
);

CREATE TABLE public.siat_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id uuid REFERENCES public.facturas_siat(id) ON DELETE RESTRICT,
  tipo_tarea text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  estado text NOT NULL DEFAULT 'PENDIENTE'
    CHECK (estado IN ('PENDIENTE', 'PROCESANDO', 'COMPLETADA', 'REINTENTAR', 'FALLIDA', 'CANCELADA')),
  idempotency_key text NOT NULL UNIQUE,
  intentos integer NOT NULL DEFAULT 0 CHECK (intentos >= 0),
  disponible_desde timestamptz NOT NULL DEFAULT now(),
  locked_by text,
  locked_until timestamptz,
  ultimo_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX siat_outbox_pendiente_idx
  ON public.siat_outbox (estado, disponible_desde)
  WHERE estado IN ('PENDIENTE', 'REINTENTAR');

CREATE TABLE public.siat_intentos_envio (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  outbox_id uuid REFERENCES public.siat_outbox(id) ON DELETE RESTRICT,
  factura_id uuid REFERENCES public.facturas_siat(id) ON DELETE RESTRICT,
  paquete_id uuid REFERENCES public.siat_paquetes(id) ON DELETE RESTRICT,
  evento_id uuid REFERENCES public.siat_eventos_significativos(id) ON DELETE RESTRICT,
  operacion text NOT NULL,
  numero_intento integer NOT NULL CHECK (numero_intento > 0),
  estado text NOT NULL CHECK (estado IN ('INICIADO', 'EXITOSO', 'REINTENTO', 'AMBIGUO', 'FALLIDO')),
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  codigo_http integer,
  codigo_siat integer,
  error_sanitizado text,
  request_hash text,
  response_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finalizado_at timestamptz
);

CREATE INDEX siat_intentos_factura_idx
  ON public.siat_intentos_envio (factura_id, created_at DESC);

CREATE TABLE public.siat_entregas_documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id uuid NOT NULL REFERENCES public.facturas_siat(id) ON DELETE RESTRICT,
  tipo text NOT NULL CHECK (tipo IN ('IMPRESION', 'PDF', 'XML', 'EMAIL', 'REIMPRESION')),
  actor_auth_user_id uuid,
  destinatario text,
  resultado text NOT NULL CHECK (resultado IN ('EXITOSA', 'FALLIDA')),
  detalle text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.siat_auditoria (
  id bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  actor_auth_user_id uuid,
  actor_usuario_id uuid REFERENCES public.usuarios(id) ON DELETE SET NULL,
  entidad text NOT NULL,
  entidad_id text,
  accion text NOT NULL,
  estado_anterior jsonb,
  estado_nuevo jsonb,
  contexto jsonb NOT NULL DEFAULT '{}'::jsonb,
  resultado text NOT NULL DEFAULT 'EXITOSO',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX siat_auditoria_entidad_idx
  ON public.siat_auditoria (entidad, entidad_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.siat_proteger_snapshot_factura()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.estado_fiscal <> 'BORRADOR' AND (
    NEW.cliente_snapshot IS DISTINCT FROM OLD.cliente_snapshot OR
    NEW.detalle_snapshot IS DISTINCT FROM OLD.detalle_snapshot OR
    NEW.totales_snapshot IS DISTINCT FROM OLD.totales_snapshot OR
    NEW.pago_snapshot IS DISTINCT FROM OLD.pago_snapshot OR
    NEW.sucursal_snapshot IS DISTINCT FROM OLD.sucursal_snapshot OR
    NEW.punto_venta_snapshot IS DISTINCT FROM OLD.punto_venta_snapshot
  ) THEN
    RAISE EXCEPTION 'El snapshot fiscal de una factura iniciada es inmutable.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_siat_snapshot_factura_inmutable
  BEFORE UPDATE ON public.facturas_siat
  FOR EACH ROW EXECUTE FUNCTION public.siat_proteger_snapshot_factura();

CREATE OR REPLACE FUNCTION public.siat_auditar_cambio()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.siat_auditoria (
    actor_auth_user_id, entidad, entidad_id, accion,
    estado_anterior, estado_nuevo, contexto
  ) VALUES (
    auth.uid(), TG_TABLE_NAME,
    COALESCE(NEW.id::text, OLD.id::text), TG_OP,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
    jsonb_build_object('origen', 'database')
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER trg_facturas_siat_auditoria
  AFTER INSERT OR UPDATE ON public.facturas_siat
  FOR EACH ROW EXECUTE FUNCTION public.siat_auditar_cambio();
CREATE TRIGGER trg_siat_eventos_auditoria
  AFTER INSERT OR UPDATE ON public.siat_eventos_significativos
  FOR EACH ROW EXECUTE FUNCTION public.siat_auditar_cambio();
CREATE TRIGGER trg_siat_paquetes_auditoria
  AFTER INSERT OR UPDATE ON public.siat_paquetes
  FOR EACH ROW EXECUTE FUNCTION public.siat_auditar_cambio();

DO $$
DECLARE
  nombre_tabla text;
BEGIN
  FOREACH nombre_tabla IN ARRAY ARRAY[
    'siat_configuracion', 'siat_sucursales', 'siat_puntos_venta', 'siat_terminales',
    'siat_cuis', 'siat_cufd', 'siat_catalogos', 'siat_catalogo_items',
    'siat_producto_homologaciones', 'siat_secuencias', 'siat_eventos_significativos',
    'siat_rangos_cafc', 'siat_paquetes'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER trg_%I_updated_at BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.fn_actualizar_updated_at()',
      nombre_tabla, nombre_tabla
    );
  END LOOP;
END;
$$;

ALTER TABLE public.siat_configuracion ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_sucursales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_puntos_venta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_terminales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_cuis ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_cufd ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_catalogos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_catalogo_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_sincronizaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_producto_homologaciones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_secuencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_eventos_significativos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_rangos_cafc ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_paquetes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_paquete_facturas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_intentos_envio ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_entregas_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.siat_auditoria ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  nombre_tabla text;
BEGIN
  FOREACH nombre_tabla IN ARRAY ARRAY[
    'siat_configuracion', 'siat_sucursales', 'siat_puntos_venta', 'siat_terminales',
    'siat_cuis', 'siat_cufd', 'siat_catalogos', 'siat_catalogo_items',
    'siat_sincronizaciones', 'siat_producto_homologaciones', 'siat_eventos_significativos',
    'siat_paquetes', 'siat_paquete_facturas', 'siat_entregas_documentos'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
      nombre_tabla || '_lectura', nombre_tabla
    );
  END LOOP;
END;
$$;

CREATE POLICY siat_configuracion_admin ON public.siat_configuracion
  FOR ALL TO authenticated
  USING (public.siat_es_administrador())
  WITH CHECK (public.siat_es_administrador());
CREATE POLICY siat_sucursales_admin ON public.siat_sucursales
  FOR ALL TO authenticated
  USING (public.siat_es_administrador())
  WITH CHECK (public.siat_es_administrador());
CREATE POLICY siat_puntos_venta_admin ON public.siat_puntos_venta
  FOR ALL TO authenticated
  USING (public.siat_es_administrador())
  WITH CHECK (public.siat_es_administrador());
CREATE POLICY siat_homologaciones_admin ON public.siat_producto_homologaciones
  FOR ALL TO authenticated
  USING (public.siat_es_administrador())
  WITH CHECK (public.siat_es_administrador());

CREATE POLICY siat_secuencias_admin_lectura ON public.siat_secuencias
  FOR SELECT TO authenticated USING (public.siat_es_administrador());
CREATE POLICY siat_cafc_admin_lectura ON public.siat_rangos_cafc
  FOR SELECT TO authenticated USING (public.siat_es_administrador());
CREATE POLICY siat_outbox_admin_lectura ON public.siat_outbox
  FOR SELECT TO authenticated USING (public.siat_es_administrador());
CREATE POLICY siat_intentos_admin_lectura ON public.siat_intentos_envio
  FOR SELECT TO authenticated USING (public.siat_es_administrador());
CREATE POLICY siat_auditoria_admin_lectura ON public.siat_auditoria
  FOR SELECT TO authenticated USING (public.siat_es_administrador());

GRANT SELECT ON public.siat_configuracion, public.siat_sucursales, public.siat_puntos_venta,
  public.siat_terminales, public.siat_cuis, public.siat_cufd, public.siat_catalogos,
  public.siat_catalogo_items, public.siat_sincronizaciones,
  public.siat_producto_homologaciones, public.siat_eventos_significativos,
  public.siat_paquetes, public.siat_paquete_facturas, public.siat_entregas_documentos
TO authenticated;

GRANT INSERT, UPDATE ON public.siat_configuracion, public.siat_sucursales,
  public.siat_puntos_venta, public.siat_producto_homologaciones
TO authenticated;

GRANT SELECT ON public.siat_secuencias, public.siat_rangos_cafc, public.siat_outbox,
  public.siat_intentos_envio, public.siat_auditoria
TO authenticated;

GRANT USAGE, SELECT ON SEQUENCE public.siat_intentos_envio_id_seq,
  public.siat_auditoria_id_seq TO authenticated;

COMMENT ON TABLE public.siat_configuracion IS 'Configuración SIAT no secreta. Credenciales y certificados pertenecen al backend seguro.';
COMMENT ON COLUMN public.facturas_siat.detalle_snapshot IS 'Detalle fiscal inmutable capturado antes de iniciar la emisión.';
COMMENT ON TABLE public.siat_outbox IS 'Tareas fiscales asíncronas; nunca ejecuta SOAP desde PostgreSQL.';

COMMIT;

-- El SIN puede repetir una paramétrica de unidad idéntica. Solo esa multiplicidad
-- exacta se consolida; identidades naturales con metadatos distintos siguen siendo error.
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
  WITH items AS (
    SELECT
      trim(item->>'codigo') AS codigo,
      trim(COALESCE(item->>'claveNatural', item->>'codigo')) AS clave_natural,
      trim(COALESCE(item->>'descripcion', item->>'nombre', item->>'leyenda')) AS descripcion,
      COALESCE(item->'metadatos', item - 'codigo' - 'claveNatural' - 'descripcion' - 'nombre' - 'leyenda') AS metadatos
    FROM jsonb_array_elements(p_items) item
  )
  SELECT * FROM items WHERE p_codigo <> 'UNIDADES_MEDIDA'
  UNION ALL
  SELECT DISTINCT codigo, clave_natural, descripcion, metadatos
  FROM items WHERE p_codigo = 'UNIDADES_MEDIDA';

  IF EXISTS (SELECT 1 FROM siat_items_nuevos WHERE codigo = '' OR clave_natural = '' OR descripcion = '') THEN
    RAISE EXCEPTION 'La respuesta del catálogo SIAT contiene items incompletos.';
  END IF;

  IF EXISTS (SELECT 1 FROM siat_items_nuevos GROUP BY clave_natural HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'La respuesta del catálogo SIAT contiene identidades naturales repetidas.';
  END IF;

  INSERT INTO public.siat_catalogo_items (catalogo_id, codigo, clave_natural, descripcion, metadatos, activo)
  SELECT v_catalogo_id, codigo, clave_natural, descripcion, metadatos, true
  FROM siat_items_nuevos
  ON CONFLICT (catalogo_id, clave_natural) DO UPDATE SET
    codigo = excluded.codigo,
    descripcion = excluded.descripcion,
    metadatos = excluded.metadatos,
    activo = true,
    updated_at = now();

  UPDATE public.siat_catalogo_items existentes
  SET activo = false, updated_at = now()
  WHERE existentes.catalogo_id = v_catalogo_id
    AND NOT EXISTS (
      SELECT 1 FROM siat_items_nuevos nuevos
      WHERE nuevos.clave_natural = existentes.clave_natural
    );

  SELECT count(*) INTO v_count FROM siat_items_nuevos;

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

BEGIN;

CREATE OR REPLACE FUNCTION public.crear_producto_con_stock(
  p_codigo_interno text,
  p_codigo_producto_sin integer,
  p_nombre text,
  p_descripcion text,
  p_numero text,
  p_medida text,
  p_precio_produccion numeric,
  p_precio_12 numeric,
  p_precio_pieza numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_producto_id uuid;
BEGIN
  IF NOT public.app_has_permission('products.create') THEN
    RAISE EXCEPTION 'No tiene permisos para crear productos.';
  END IF;
  IF length(trim(coalesce(p_codigo_interno, ''))) = 0 THEN
    RAISE EXCEPTION 'El SKU o código interno es obligatorio.';
  END IF;
  IF length(trim(coalesce(p_nombre, ''))) = 0 THEN
    RAISE EXCEPTION 'El nombre del producto es obligatorio.';
  END IF;
  IF length(trim(coalesce(p_medida, ''))) = 0 THEN
    RAISE EXCEPTION 'La unidad de medida es obligatoria.';
  END IF;
  IF coalesce(p_precio_produccion, 0) < 0 OR coalesce(p_precio_12, 0) < 0 OR coalesce(p_precio_pieza, 0) < 0 THEN
    RAISE EXCEPTION 'Los precios no pueden ser negativos.';
  END IF;

  INSERT INTO public.productos (
    codigo_interno, codigo_producto_sin, nombre, descripcion, numero, medida,
    precio_produccion, precio_12, precio_pieza, activo
  ) VALUES (
    trim(p_codigo_interno), p_codigo_producto_sin, trim(p_nombre), nullif(trim(coalesce(p_descripcion, '')), ''),
    nullif(trim(coalesce(p_numero, '')), ''), trim(p_medida), coalesce(p_precio_produccion, 0),
    coalesce(p_precio_12, 0), coalesce(p_precio_pieza, 0), true
  )
  RETURNING id INTO v_producto_id;

  INSERT INTO public.stock_por_almacen (producto_id, almacen_id, cantidad_disponible, cantidad_reservada)
  SELECT v_producto_id, almacen.id, 0, 0
  FROM public.almacenes AS almacen
  WHERE almacen.activo = true
  ON CONFLICT (producto_id, almacen_id) DO NOTHING;

  RETURN v_producto_id;
END;
$$;

REVOKE ALL ON FUNCTION public.crear_producto_con_stock(text, integer, text, text, text, text, numeric, numeric, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.crear_producto_con_stock(text, integer, text, text, text, text, numeric, numeric, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.eliminar_productos(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eliminados integer;
BEGIN
  IF NOT public.app_has_permission('products.delete') THEN
    RAISE EXCEPTION 'No tiene permisos para eliminar productos.';
  END IF;
  IF coalesce(array_length(p_ids, 1), 0) = 0 THEN RETURN 0; END IF;

  DELETE FROM public.stock_por_almacen WHERE producto_id = ANY(p_ids);
  DELETE FROM public.productos WHERE id = ANY(p_ids);
  GET DIAGNOSTICS v_eliminados = ROW_COUNT;

  IF v_eliminados <> array_length(p_ids, 1) THEN
    RAISE EXCEPTION 'No se encontraron todos los productos solicitados.';
  END IF;
  RETURN v_eliminados;
END;
$$;

REVOKE ALL ON FUNCTION public.eliminar_productos(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.eliminar_productos(uuid[]) TO authenticated;

COMMIT;

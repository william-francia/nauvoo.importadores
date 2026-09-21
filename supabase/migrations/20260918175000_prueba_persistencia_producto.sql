BEGIN;

-- Las ubicaciones ya forman parte de la interfaz de inventario, pero nunca se
-- habían persistido. Se crean una sola vez para que el stock real pueda existir.
INSERT INTO public.almacenes (codigo, nombre, tipo, activo) VALUES
  ('ALM-UQUISAMANA', 'Almacén Uquisamaña', 'almacen', true),
  ('LOC-ISAC-TAMAYO', 'Local Isac Tamayo', 'tienda', true),
  ('LOC-CALACOTO', 'Local Calacoto', 'tienda', true),
  ('LOC-SANTA-CRUZ', 'Local Santa Cruz', 'tienda', true)
ON CONFLICT (codigo) DO UPDATE SET activo = true, updated_at = now();

DO $$
DECLARE
  v_admin_id uuid;
  v_producto_id uuid;
  v_almacen_id uuid;
BEGIN
  SELECT id INTO v_admin_id
  FROM auth.users
  WHERE lower(email) = 'admin@gmail.com'
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró la cuenta admin@gmail.com para ejecutar la prueba de persistencia.';
  END IF;

  SELECT id INTO v_producto_id
  FROM public.productos
  WHERE codigo_interno = 'PRUEBA-001'
  LIMIT 1;

  IF v_producto_id IS NULL THEN
    PERFORM set_config('request.jwt.claim.sub', v_admin_id::text, true);
    v_producto_id := public.crear_producto_con_stock(
      'PRUEBA-001', NULL, 'PRODUCTO PRUEBA 001',
      'Producto creado para validar persistencia real entre gestión y ventas.',
      NULL, 'PIEZA', 5, 0, 10
    );
  END IF;

  SELECT id INTO v_almacen_id
  FROM public.almacenes
  WHERE activo = true
  ORDER BY created_at
  LIMIT 1;

  IF v_almacen_id IS NULL THEN
    RAISE EXCEPTION 'No existe un almacén activo para validar el stock del producto de prueba.';
  END IF;

  INSERT INTO public.stock_por_almacen (producto_id, almacen_id, cantidad_disponible, cantidad_reservada)
  VALUES (v_producto_id, v_almacen_id, 5, 0)
  ON CONFLICT (producto_id, almacen_id) DO UPDATE
  SET cantidad_disponible = GREATEST(public.stock_por_almacen.cantidad_disponible, 5),
      updated_at = now();

  IF NOT EXISTS (
    SELECT 1
    FROM public.productos AS producto
    JOIN public.stock_por_almacen AS stock ON stock.producto_id = producto.id
    JOIN public.almacenes AS almacen ON almacen.id = stock.almacen_id AND almacen.activo = true
    WHERE producto.id = v_producto_id
      AND producto.activo = true
      AND producto.nombre = 'PRODUCTO PRUEBA 001'
      AND producto.precio_pieza = 10
      AND stock.cantidad_disponible >= 5
  ) THEN
    RAISE EXCEPTION 'Falló la validación transaccional de PRODUCTO PRUEBA 001.';
  END IF;
END;
$$;

COMMIT;

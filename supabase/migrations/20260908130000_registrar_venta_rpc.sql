-- Registro atómico de ventas sobre las tablas existentes: ventas,
-- detalle_ventas, stock_por_almacen y movimientos_inventario.

CREATE OR REPLACE FUNCTION public.registrar_venta(
  p_cliente_id uuid,
  p_metodo_pago text,
  p_observacion text,
  p_descuento_venta numeric,
  p_items jsonb
)
RETURNS TABLE (
  venta_id uuid,
  codigo_venta text,
  total numeric,
  estado text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_usuario_id uuid;
  v_venta_id uuid;
  v_codigo_venta text;
  v_subtotal numeric(16,2) := 0;
  v_descuento_items numeric(16,2) := 0;
  v_total numeric(16,2);
  v_estado text;
  v_producto record;
  v_item record;
  v_stock_disponible numeric(16,3);
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta debe incluir al menos un producto.';
  END IF;

  IF COALESCE(p_descuento_venta, 0) < 0 THEN
    RAISE EXCEPTION 'El descuento de la venta no puede ser negativo.';
  END IF;

  IF p_metodo_pago NOT IN ('EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'QR', 'OTRO') THEN
    RAISE EXCEPTION 'El método de pago no es válido.';
  END IF;

  SELECT id INTO v_usuario_id
  FROM public.usuarios
  WHERE auth_user_id = auth.uid() AND activo = true;

  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'El usuario autenticado no está vinculado a un usuario activo del sistema.';
  END IF;

  IF p_cliente_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clientes WHERE id = p_cliente_id AND activo = true
  ) THEN
    RAISE EXCEPTION 'El cliente seleccionado no existe o está inactivo.';
  END IF;

  -- Valida las líneas y sus importes antes de generar registros.
  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_items) AS item(
      producto_id uuid, almacen_id uuid, cantidad numeric,
      precio_unitario numeric, descuento numeric
    )
  LOOP
    IF v_item.producto_id IS NULL OR v_item.almacen_id IS NULL
      OR v_item.cantidad IS NULL OR v_item.cantidad <= 0
      OR v_item.precio_unitario IS NULL OR v_item.precio_unitario < 0
      OR v_item.descuento IS NULL OR v_item.descuento < 0
      OR v_item.descuento > v_item.cantidad * v_item.precio_unitario THEN
      RAISE EXCEPTION 'Uno de los detalles de venta tiene datos inválidos.';
    END IF;

    v_subtotal := v_subtotal + (v_item.cantidad * v_item.precio_unitario);
    v_descuento_items := v_descuento_items + v_item.descuento;
  END LOOP;

  IF p_descuento_venta > v_subtotal - v_descuento_items THEN
    RAISE EXCEPTION 'El descuento de la venta excede el importe disponible.';
  END IF;

  -- Las filas se bloquean en orden estable. El trigger existente de ventas
  -- aplicará el descuento y creará movimientos al confirmar la venta.
  FOR v_item IN
    SELECT producto_id, almacen_id, SUM(cantidad) AS cantidad
    FROM jsonb_to_recordset(p_items) AS item(
      producto_id uuid, almacen_id uuid, cantidad numeric,
      precio_unitario numeric, descuento numeric
    )
    GROUP BY producto_id, almacen_id
    ORDER BY producto_id, almacen_id
  LOOP
    SELECT cantidad_disponible INTO v_stock_disponible
    FROM public.stock_por_almacen
    WHERE producto_id = v_item.producto_id AND almacen_id = v_item.almacen_id
    FOR UPDATE;

    IF NOT FOUND OR v_stock_disponible < v_item.cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente para el producto % en el almacén %.',
        v_item.producto_id, v_item.almacen_id;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.productos WHERE id = v_item.producto_id AND activo = true
    ) THEN
      RAISE EXCEPTION 'El producto % no existe o está inactivo.', v_item.producto_id;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.almacenes WHERE id = v_item.almacen_id AND activo = true
    ) THEN
      RAISE EXCEPTION 'El almacén % no existe o está inactivo.', v_item.almacen_id;
    END IF;
  END LOOP;

  v_codigo_venta := 'V-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  INSERT INTO public.ventas (
    codigo_venta, cliente_id, usuario_id, metodo_pago, estado, observacion
  ) VALUES (
    v_codigo_venta, p_cliente_id, v_usuario_id, p_metodo_pago, 'pendiente', nullif(trim(p_observacion), '')
  )
  RETURNING id INTO v_venta_id;

  FOR v_item IN
    SELECT * FROM jsonb_to_recordset(p_items) AS item(
      producto_id uuid, almacen_id uuid, cantidad numeric,
      precio_unitario numeric, descuento numeric
    )
  LOOP
    SELECT codigo_interno, nombre, descripcion INTO v_producto
    FROM public.productos WHERE id = v_item.producto_id;

    INSERT INTO public.detalle_ventas (
      venta_id, producto_id, almacen_id, codigo_producto_snapshot,
      descripcion_producto, cantidad, precio_unitario, tipo_precio, descuento
    ) VALUES (
      v_venta_id, v_item.producto_id, v_item.almacen_id, v_producto.codigo_interno,
      concat_ws(' - ', v_producto.nombre, v_producto.descripcion), v_item.cantidad,
      v_item.precio_unitario, 'pieza', v_item.descuento
    );
  END LOOP;

  -- Si el trigger detecta cualquier problema, PostgreSQL revierte toda la
  -- llamada RPC: venta, detalles, stock y movimientos.
  UPDATE public.ventas AS venta
  SET descuento_venta = COALESCE(p_descuento_venta, 0), estado = 'confirmada'
  WHERE venta.id = v_venta_id
  RETURNING venta.total, venta.estado INTO v_total, v_estado;

  venta_id := v_venta_id;
  codigo_venta := v_codigo_venta;
  total := v_total;
  estado := v_estado;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_venta(uuid, text, text, numeric, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_venta(uuid, text, text, numeric, jsonb) TO authenticated;

-- Permite registrar ventas con stock cero sin generar stock negativo.
-- Si existe stock positivo, solo se descuenta la cantidad realmente disponible.

CREATE OR REPLACE FUNCTION public.fn_aplicar_inventario_venta()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    item RECORD;
    v_stock_anterior NUMERIC(16,3);
    v_stock_resultante NUMERIC(16,3);
    v_cantidad_movimiento NUMERIC(16,3);
    v_cantidad_devolver NUMERIC(16,3);
BEGIN
    IF NEW.estado IN ('confirmada', 'facturada') AND OLD.inventario_aplicado = FALSE THEN
        IF NOT EXISTS (SELECT 1 FROM public.detalle_ventas WHERE venta_id = NEW.id) THEN
            RAISE EXCEPTION 'No se puede confirmar una venta sin productos.';
        END IF;

        FOR item IN SELECT * FROM public.detalle_ventas WHERE venta_id = NEW.id LOOP
            SELECT cantidad_disponible
              INTO v_stock_anterior
              FROM public.stock_por_almacen
             WHERE producto_id = item.producto_id
               AND almacen_id = item.almacen_id
             FOR UPDATE;

            -- Una ubicacion sin fila de stock o con stock cero permite vender,
            -- pero no crea movimiento ni modifica el inventario.
            IF FOUND AND v_stock_anterior > 0 THEN
                v_stock_resultante := GREATEST(0, v_stock_anterior - item.cantidad);
                v_cantidad_movimiento := v_stock_anterior - v_stock_resultante;

                UPDATE public.stock_por_almacen
                   SET cantidad_disponible = v_stock_resultante,
                       updated_at = NOW()
                 WHERE producto_id = item.producto_id
                   AND almacen_id = item.almacen_id;

                IF v_cantidad_movimiento > 0 THEN
                    INSERT INTO public.movimientos_inventario (
                        producto_id, almacen_id, tipo_movimiento, cantidad,
                        stock_anterior, stock_resultante, motivo, venta_id,
                        detalle_venta_id, usuario_id
                    ) VALUES (
                        item.producto_id, item.almacen_id, 'salida',
                        v_cantidad_movimiento, v_stock_anterior,
                        v_stock_resultante, 'Venta confirmada', NEW.id,
                        item.id, NEW.usuario_id
                    );
                END IF;
            END IF;
        END LOOP;

        NEW.inventario_aplicado := TRUE;
    END IF;

    IF NEW.estado = 'anulada' AND OLD.estado <> 'anulada' THEN
        IF NEW.motivo_anulacion IS NULL OR TRIM(NEW.motivo_anulacion) = '' THEN
            RAISE EXCEPTION 'Debe indicar el motivo de anulacion.';
        END IF;

        NEW.fecha_anulacion := COALESCE(NEW.fecha_anulacion, NOW());

        IF OLD.inventario_aplicado = TRUE THEN
            FOR item IN SELECT * FROM public.detalle_ventas WHERE venta_id = NEW.id LOOP
                -- Solo se devuelve lo que realmente se desconto al confirmar.
                SELECT COALESCE(SUM(cantidad), 0)
                  INTO v_cantidad_devolver
                  FROM public.movimientos_inventario
                 WHERE venta_id = NEW.id
                   AND detalle_venta_id = item.id
                   AND tipo_movimiento = 'salida';

                IF v_cantidad_devolver > 0 THEN
                    SELECT cantidad_disponible
                      INTO v_stock_anterior
                      FROM public.stock_por_almacen
                     WHERE producto_id = item.producto_id
                       AND almacen_id = item.almacen_id
                     FOR UPDATE;

                    IF NOT FOUND THEN
                        v_stock_anterior := 0;
                        INSERT INTO public.stock_por_almacen (
                            producto_id, almacen_id, cantidad_disponible
                        ) VALUES (
                            item.producto_id, item.almacen_id, v_cantidad_devolver
                        );
                        v_stock_resultante := v_cantidad_devolver;
                    ELSE
                        UPDATE public.stock_por_almacen
                           SET cantidad_disponible = cantidad_disponible + v_cantidad_devolver,
                               updated_at = NOW()
                         WHERE producto_id = item.producto_id
                           AND almacen_id = item.almacen_id
                        RETURNING cantidad_disponible INTO v_stock_resultante;
                    END IF;

                    INSERT INTO public.movimientos_inventario (
                        producto_id, almacen_id, tipo_movimiento, cantidad,
                        stock_anterior, stock_resultante, motivo, venta_id,
                        detalle_venta_id, usuario_id
                    ) VALUES (
                        item.producto_id, item.almacen_id, 'devolucion_venta',
                        v_cantidad_devolver, v_stock_anterior,
                        v_stock_resultante, 'Venta anulada', NEW.id,
                        item.id, NEW.usuario_anulacion_id
                    );
                END IF;
            END LOOP;

            NEW.inventario_aplicado := FALSE;
        END IF;
    END IF;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_venta(
  p_cliente_id uuid,
  p_metodo_pago text,
  p_observacion text,
  p_descuento_venta numeric,
  p_items jsonb
)
RETURNS TABLE (venta_id uuid, codigo_venta text, total numeric, estado text)
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
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'La venta debe incluir al menos un producto.';
  END IF;
  IF COALESCE(p_descuento_venta, 0) < 0 THEN
    RAISE EXCEPTION 'El descuento de la venta no puede ser negativo.';
  END IF;
  IF p_metodo_pago NOT IN ('EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'QR', 'OTRO') THEN
    RAISE EXCEPTION 'El metodo de pago no es valido.';
  END IF;

  SELECT id INTO v_usuario_id
    FROM public.usuarios
   WHERE auth_user_id = auth.uid() AND activo = true;
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'El usuario autenticado no esta vinculado a un usuario activo del sistema.';
  END IF;
  IF p_cliente_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.clientes WHERE id = p_cliente_id AND activo = true
  ) THEN
    RAISE EXCEPTION 'El cliente seleccionado no existe o esta inactivo.';
  END IF;

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
      RAISE EXCEPTION 'Uno de los detalles de venta tiene datos invalidos.';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.productos WHERE id = v_item.producto_id AND activo = true) THEN
      RAISE EXCEPTION 'El producto % no existe o esta inactivo.', v_item.producto_id;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.almacenes WHERE id = v_item.almacen_id AND activo = true) THEN
      RAISE EXCEPTION 'La ubicacion % no existe o esta inactiva.', v_item.almacen_id;
    END IF;

    -- Se bloquea la fila si existe, pero no se exige stock para vender.
    PERFORM 1
      FROM public.stock_por_almacen
     WHERE producto_id = v_item.producto_id AND almacen_id = v_item.almacen_id
     FOR UPDATE;

    v_subtotal := v_subtotal + (v_item.cantidad * v_item.precio_unitario);
    v_descuento_items := v_descuento_items + v_item.descuento;
  END LOOP;

  IF p_descuento_venta > v_subtotal - v_descuento_items THEN
    RAISE EXCEPTION 'El descuento de la venta excede el importe disponible.';
  END IF;

  v_codigo_venta := 'V-' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  INSERT INTO public.ventas (
    codigo_venta, cliente_id, usuario_id, metodo_pago, estado, observacion
  ) VALUES (
    v_codigo_venta, p_cliente_id, v_usuario_id, p_metodo_pago, 'pendiente', nullif(trim(p_observacion), '')
  ) RETURNING id INTO v_venta_id;

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

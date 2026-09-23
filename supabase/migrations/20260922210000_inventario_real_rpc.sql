BEGIN;

ALTER TABLE public.movimientos_inventario
  ADD COLUMN IF NOT EXISTS anulado boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.registrar_movimiento_inventario(
  p_producto_id uuid,
  p_almacen_id uuid,
  p_tipo text,
  p_cantidad numeric,
  p_fecha date,
  p_observacion text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_stock public.stock_por_almacen%ROWTYPE;
  v_resultante numeric(16,3);
  v_id uuid;
BEGIN
  IF NOT public.app_has_permission('inventory.update') THEN
    RAISE EXCEPTION 'No tiene permisos para actualizar el inventario.';
  END IF;
  IF p_tipo NOT IN ('INGRESO', 'AJUSTE_AUMENTO', 'AJUSTE_DISMINUCION') OR p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'Los datos del movimiento no son válidos.';
  END IF;

  SELECT * INTO v_stock
  FROM public.stock_por_almacen
  WHERE producto_id = p_producto_id AND almacen_id = p_almacen_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe stock configurado para el producto y la ubicación seleccionados.';
  END IF;

  v_resultante := v_stock.cantidad_disponible + CASE WHEN p_tipo = 'AJUSTE_DISMINUCION' THEN -p_cantidad ELSE p_cantidad END;
  IF v_resultante < 0 THEN
    RAISE EXCEPTION 'No existe suficiente stock para realizar la disminución.';
  END IF;

  UPDATE public.stock_por_almacen
  SET cantidad_disponible = v_resultante, updated_at = now()
  WHERE id = v_stock.id;

  INSERT INTO public.movimientos_inventario (
    producto_id, almacen_id, tipo_movimiento, cantidad, stock_anterior,
    stock_resultante, motivo, observacion, fecha
  ) VALUES (
    p_producto_id, p_almacen_id,
    CASE WHEN p_tipo = 'INGRESO' THEN 'entrada' ELSE 'ajuste' END, p_cantidad, v_stock.cantidad_disponible,
    v_resultante, 'Movimiento de inventario', nullif(trim(p_observacion), ''),
    COALESCE(p_fecha::timestamp with time zone, now())
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.registrar_traslado_inventario(
  p_producto_id uuid,
  p_origen_id uuid,
  p_destino_id uuid,
  p_cantidad numeric,
  p_fecha date,
  p_observacion text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_origen public.stock_por_almacen%ROWTYPE;
  v_destino public.stock_por_almacen%ROWTYPE;
  v_id uuid;
BEGIN
  IF NOT public.app_has_permission('inventory.update') THEN
    RAISE EXCEPTION 'No tiene permisos para actualizar el inventario.';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 OR p_origen_id = p_destino_id THEN
    RAISE EXCEPTION 'Los datos del traslado no son válidos.';
  END IF;

  SELECT * INTO v_origen FROM public.stock_por_almacen
  WHERE producto_id = p_producto_id AND almacen_id = p_origen_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe stock configurado para el almacén de origen.';
  END IF;
  SELECT * INTO v_destino FROM public.stock_por_almacen
  WHERE producto_id = p_producto_id AND almacen_id = p_destino_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existe stock configurado para la ubicación de destino.';
  END IF;
  IF v_origen.cantidad_disponible < p_cantidad THEN
    RAISE EXCEPTION 'El almacén de origen no tiene suficiente stock.';
  END IF;

  UPDATE public.stock_por_almacen SET cantidad_disponible = cantidad_disponible - p_cantidad, updated_at = now() WHERE id = v_origen.id;
  UPDATE public.stock_por_almacen SET cantidad_disponible = cantidad_disponible + p_cantidad, updated_at = now() WHERE id = v_destino.id;
  INSERT INTO public.movimientos_inventario (
    producto_id, almacen_id, tipo_movimiento, cantidad, stock_anterior,
    stock_resultante, motivo, observacion, fecha
  ) VALUES (
    p_producto_id, p_destino_id, 'entrada', p_cantidad, v_destino.cantidad_disponible,
    v_destino.cantidad_disponible + p_cantidad, 'Traslado de inventario', nullif(trim(p_observacion), ''),
    COALESCE(p_fecha::timestamp with time zone, now())
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.anular_movimiento_inventario(p_movimiento_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mov public.movimientos_inventario%ROWTYPE;
  v_stock public.stock_por_almacen%ROWTYPE;
  v_origen public.stock_por_almacen%ROWTYPE;
  v_almacen_id uuid;
BEGIN
  IF NOT public.app_has_permission('movements.update') THEN
    RAISE EXCEPTION 'No tiene permisos para anular movimientos.';
  END IF;
  SELECT * INTO v_mov FROM public.movimientos_inventario WHERE id = p_movimiento_id FOR UPDATE;
  IF NOT FOUND OR v_mov.anulado THEN RETURN; END IF;

  SELECT * INTO v_stock FROM public.stock_por_almacen
  WHERE producto_id = v_mov.producto_id AND almacen_id = v_mov.almacen_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'No existe stock para revertir el movimiento.'; END IF;

  IF v_mov.motivo = 'Traslado de inventario' THEN
    SELECT id INTO v_almacen_id FROM public.almacenes
    WHERE activo = true AND (codigo ILIKE '%UQUISAMANA%' OR nombre ILIKE '%UQUISAMA%') LIMIT 1;
    SELECT * INTO v_origen FROM public.stock_por_almacen
    WHERE producto_id = v_mov.producto_id AND almacen_id = v_almacen_id FOR UPDATE;
    IF v_stock.cantidad_disponible < v_mov.cantidad THEN RAISE EXCEPTION 'No se puede anular: el destino ya no tiene todo el stock trasladado.'; END IF;
    UPDATE public.stock_por_almacen SET cantidad_disponible = cantidad_disponible - v_mov.cantidad, updated_at = now() WHERE id = v_stock.id;
    UPDATE public.stock_por_almacen SET cantidad_disponible = cantidad_disponible + v_mov.cantidad, updated_at = now() WHERE id = v_origen.id;
  ELSE
    IF v_mov.tipo_movimiento = 'entrada' AND v_stock.cantidad_disponible < v_mov.cantidad THEN
      RAISE EXCEPTION 'No se puede anular: el stock actual es insuficiente.';
    END IF;
    UPDATE public.stock_por_almacen
    SET cantidad_disponible = cantidad_disponible + CASE WHEN v_mov.tipo_movimiento = 'ajuste' AND v_mov.stock_resultante < v_mov.stock_anterior THEN v_mov.cantidad ELSE -v_mov.cantidad END,
        updated_at = now()
    WHERE id = v_stock.id;
  END IF;
  UPDATE public.movimientos_inventario SET anulado = true WHERE id = p_movimiento_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.registrar_movimiento_inventario(uuid, uuid, text, numeric, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.registrar_traslado_inventario(uuid, uuid, uuid, numeric, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.anular_movimiento_inventario(uuid) TO authenticated;

COMMIT;

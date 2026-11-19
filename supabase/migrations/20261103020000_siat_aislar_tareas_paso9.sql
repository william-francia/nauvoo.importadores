-- Mantiene intactas las tareas bloqueadas: ni las reclama ni cambia sus estados.
CREATE OR REPLACE FUNCTION public.siat_reclamar_outbox_9a(p_worker_id text, p_lock_segundos integer DEFAULT 90, p_habilitar_anulacion boolean DEFAULT false)
RETURNS SETOF public.siat_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF COALESCE(trim(p_worker_id), '') = '' OR p_lock_segundos NOT BETWEEN 15 AND 600 THEN
    RAISE EXCEPTION 'Parámetros de worker inválidos.';
  END IF;
  SELECT id INTO v_id FROM public.siat_outbox
  WHERE estado IN ('PENDIENTE', 'REINTENTAR') AND disponible_desde <= now()
    AND (locked_until IS NULL OR locked_until < now())
    -- Hasta aplicar 0300 no existe la tabla de notificaciones: bloquear todo 9A.
    AND tipo_tarea NOT IN ('ANULAR_FACTURA', 'CONCILIAR_ANULACION', 'REVERTIR_ANULACION', 'CONCILIAR_REVERSION')
    -- 9B permanece retenido hasta validar los escenarios de contingencia.
    AND tipo_tarea NOT IN ('REGISTRAR_EVENTO', 'CONCILIAR_EVENTO', 'GENERAR_PAQUETES_EVENTO', 'ENVIAR_PAQUETE', 'VALIDAR_PAQUETE', 'CONCILIAR_FACTURA_PAQUETE')
  ORDER BY disponible_desde, created_at FOR UPDATE SKIP LOCKED LIMIT 1;
  IF v_id IS NULL THEN RETURN; END IF;
  RETURN QUERY UPDATE public.siat_outbox
    SET estado = 'PROCESANDO', locked_by = p_worker_id,
        locked_until = now() + make_interval(secs => p_lock_segundos), intentos = intentos + 1
    WHERE id = v_id RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION public.siat_reclamar_outbox_9a(text, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siat_reclamar_outbox_9a(text, integer, boolean) TO service_role;

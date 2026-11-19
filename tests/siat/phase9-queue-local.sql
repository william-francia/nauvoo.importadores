-- Solo en la base sintética local: cualquier cambio se revierte al finalizar.
BEGIN;
DO $$ BEGIN IF current_database() <> 'paso9_evidence_v2' THEN RAISE EXCEPTION 'Solo base sintética local.'; END IF; END $$;
UPDATE public.siat_outbox SET estado = 'CANCELADA' WHERE estado IN ('PENDIENTE', 'REINTENTAR');
INSERT INTO public.siat_outbox (tipo_tarea, payload, estado, idempotency_key)
SELECT tipo, '{}'::jsonb, 'PENDIENTE', 'test-cola:' || tipo
FROM unnest(ARRAY['ANULAR_FACTURA', 'REVERTIR_ANULACION', 'CONCILIAR_ANULACION', 'CONCILIAR_REVERSION', 'REGISTRAR_EVENTO', 'CONCILIAR_EVENTO', 'GENERAR_PAQUETES_EVENTO', 'ENVIAR_PAQUETE', 'VALIDAR_PAQUETE', 'CONCILIAR_FACTURA_PAQUETE']) AS tipo;
INSERT INTO public.siat_outbox (tipo_tarea, payload, estado, idempotency_key) VALUES ('RENOVAR_CUIS','{}','PENDIENTE','test-cola:normal');
INSERT INTO public.siat_outbox (tipo_tarea, payload, estado, idempotency_key) VALUES
  ('ENVIAR_PAQUETE','{}','REINTENTAR','test-cola:reintento'),
  ('EMITIR_FACTURA_ONLINE','{"reenvioAutomaticoBloqueado":true}','CANCELADA','test-cola:retenida');
DO $$
DECLARE r public.siat_outbox%ROWTYPE; n integer;
BEGIN
  SELECT * INTO r FROM public.siat_reclamar_outbox_9a('test-worker', 120, false);
  IF r.tipo_tarea IS DISTINCT FROM 'RENOVAR_CUIS' OR r.estado IS DISTINCT FROM 'PROCESANDO' THEN RAISE EXCEPTION 'No seleccionó la tarea permitida.'; END IF;
  SELECT count(*) INTO n FROM public.siat_outbox WHERE idempotency_key LIKE 'test-cola:%' AND estado = 'PENDIENTE' AND locked_by IS NULL AND intentos = 0;
  IF n <> 10 THEN RAISE EXCEPTION 'Las tareas bloqueadas fueron alteradas.'; END IF;
  SELECT count(*) INTO n FROM public.siat_outbox WHERE idempotency_key = 'test-cola:reintento' AND estado = 'REINTENTAR' AND intentos = 0 AND locked_by IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'El reintento bloqueado fue alterado.'; END IF;
  SELECT count(*) INTO n FROM public.siat_outbox WHERE idempotency_key = 'test-cola:retenida' AND estado = 'CANCELADA' AND intentos = 0 AND (payload->>'reenvioAutomaticoBloqueado')::boolean;
  IF n <> 1 THEN RAISE EXCEPTION 'La tarea retenida fue alterada.'; END IF;
  SELECT count(*) INTO n FROM public.siat_reclamar_outbox_9a('test-worker', 120, false);
  IF n <> 0 THEN RAISE EXCEPTION 'Se reclamó una tarea bloqueada.'; END IF;
END;
$$;
ROLLBACK;

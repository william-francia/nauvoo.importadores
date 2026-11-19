-- Retención autorizada: no cambia la factura, numeración, CUF ni historial.
DO $$
DECLARE v_job public.siat_outbox%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_job FROM public.siat_outbox
  WHERE id = 'e4d9ce8e-1c5c-4a08-94db-f4f50c3a8a0e'
    AND factura_id = 'c2279bbb-e851-468b-afe6-8ebf0b436d28' FOR UPDATE;
  IF v_job.estado <> 'REINTENTAR' OR v_job.intentos <> 1
    OR v_job.locked_by IS NOT NULL OR v_job.locked_until IS NOT NULL THEN
    RAISE EXCEPTION 'Estado inesperado; no se aplicó retención';
  END IF;
  IF EXISTS (SELECT 1 FROM public.siat_outbox WHERE factura_id = v_job.factura_id
    AND id <> v_job.id AND estado IN ('PENDIENTE', 'REINTENTAR', 'PROCESANDO')) THEN
    RAISE EXCEPTION 'Otra tarea activa; no se aplicó retención';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.facturas_siat WHERE id = v_job.factura_id
    AND origen_fiscal = 'PILOTO' AND ambiente = 'PRUEBAS' AND estado_fiscal = 'ENVIANDO') THEN
    RAISE EXCEPTION 'Factura fuera del alcance autorizado';
  END IF;
  UPDATE public.siat_outbox SET estado = 'CANCELADA', payload = payload || jsonb_build_object(
    'reenvioAutomaticoBloqueado', true, 'motivoRetencion', 'CORRECCION_FECHA_ENVIO_SOLO_CONCILIACION',
    'retencionAt', now()) WHERE id = v_job.id;
  INSERT INTO public.siat_auditoria(entidad, entidad_id, accion, estado_anterior, estado_nuevo, contexto)
  VALUES ('siat_outbox', v_job.id::text, 'RETENCION_ENVIO_AUTORIZADA',
    jsonb_build_object('estado', v_job.estado), jsonb_build_object('estado', 'CANCELADA'),
    jsonb_build_object('facturaId', v_job.factura_id,
      'motivo', 'Solicitud expresa del usuario: bloquear reenvío automático y consultar CUF sin recepcionFactura',
      'sinCambiosFiscales', true));
END $$;

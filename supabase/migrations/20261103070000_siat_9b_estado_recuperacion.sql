-- Consulta administrativa del agente; no envía, no reintenta y no modifica estados fiscales.
CREATE FUNCTION public.siat_9b_estado_recuperacion(p_agente uuid,p_evento uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e public.siat_eventos_significativos%ROWTYPE; complete boolean;
BEGIN
  SELECT * INTO e FROM public.siat_eventos_significativos WHERE id=p_evento AND agente_local_id=p_agente;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.siat_agentes_locales WHERE id=p_agente AND estado<>'BLOQUEADO')
    OR NOT EXISTS (SELECT 1 FROM public.siat_configuracion WHERE id=true AND ambiente='PRUEBAS') THEN RAISE EXCEPTION 'Evento no disponible para este agente.'; END IF;
  SELECT e.estado='VALIDADO' AND NULLIF(trim(e.codigo_recepcion),'') IS NOT NULL
    AND jsonb_path_exists(COALESCE(e.respuesta_siat,'{}'::jsonb),'$.**.transaccion ? (@ == true || @ == "true")')
    AND NOT EXISTS (SELECT 1 FROM jsonb_path_query(COALESCE(e.respuesta_siat,'{}'::jsonb),'$.**.transaccion') AS v WHERE trim(both '"' from v::text)<>'true')
    AND EXISTS (SELECT 1 FROM public.siat_paquetes p WHERE p.evento_id=e.id)
    AND EXISTS (SELECT 1 FROM public.facturas_siat f WHERE f.evento_id=e.id AND f.tipo_emision='OFFLINE')
    AND NOT EXISTS (SELECT 1 FROM public.siat_paquetes p WHERE p.evento_id=e.id AND (
      p.estado NOT IN ('VALIDADO','OBSERVADO') OR p.cantidad_facturas NOT BETWEEN 1 AND 500 OR NULLIF(trim(p.codigo_recepcion),'') IS NULL
      OR (p.estado='VALIDADO' AND (NOT jsonb_path_exists(COALESCE(p.respuesta_siat,'{}'::jsonb),'$.**.transaccion ? (@ == true || @ == "true")')
      OR EXISTS (SELECT 1 FROM jsonb_path_query(COALESCE(p.respuesta_siat,'{}'::jsonb),'$.**.transaccion') AS v WHERE trim(both '"' from v::text)<>'true')
      OR NOT jsonb_path_exists(COALESCE(p.respuesta_siat,'{}'::jsonb),'$.**.codigoEstado ? (@ == 908 || @ == "908")')
      OR EXISTS (SELECT 1 FROM jsonb_path_query(COALESCE(p.respuesta_siat,'{}'::jsonb),'$.**.codigoEstado') AS v WHERE trim(both '"' from v::text)<>'908')
      OR jsonb_path_exists(COALESCE(p.respuesta_siat,'{}'::jsonb),'$.**.numeroArchivo ? (@ != null)')
      OR jsonb_path_exists(COALESCE(p.respuesta_siat,'{}'::jsonb),'$.**.numeroDetalle ? (@ != null)')
      ))
      OR (p.estado='OBSERVADO' AND EXISTS (SELECT 1 FROM siat_paquete_facturas pf JOIN facturas_siat f ON f.id=pf.factura_id WHERE pf.paquete_id=p.id AND (f.estado_fiscal<>'VALIDADA' OR f.codigo_estado IS DISTINCT FROM 908 OR f.transaccion IS DISTINCT FROM true OR NULLIF(trim(f.codigo_recepcion),'') IS NULL)))
      OR p.cantidad_facturas<>(SELECT count(*) FROM public.siat_paquete_facturas pf WHERE pf.paquete_id=p.id)))
    AND NOT EXISTS (SELECT 1 FROM public.facturas_siat f WHERE f.evento_id=e.id AND f.tipo_emision='OFFLINE' AND (
      f.ambiente<>'PRUEBAS' OR f.estado_fiscal<>'VALIDADA' OR NOT EXISTS (SELECT 1 FROM public.siat_paquete_facturas pf JOIN public.siat_paquetes p ON p.id=pf.paquete_id WHERE pf.factura_id=f.id AND p.evento_id=e.id AND p.estado IN ('VALIDADO','OBSERVADO'))))
    AND NOT EXISTS (SELECT 1 FROM public.siat_paquete_facturas pf JOIN public.siat_paquetes p ON p.id=pf.paquete_id JOIN public.facturas_siat f ON f.id=pf.factura_id WHERE p.evento_id=e.id AND (f.evento_id IS DISTINCT FROM e.id OR f.tipo_emision<>'OFFLINE'))
    AND NOT EXISTS (SELECT 1 FROM public.siat_outbox o WHERE o.estado IN ('PENDIENTE','PROCESANDO','REINTENTAR','FALLIDA')
      AND o.tipo_tarea IN ('REGISTRAR_EVENTO','CONCILIAR_EVENTO','GENERAR_PAQUETES_EVENTO','ENVIAR_PAQUETE','VALIDAR_PAQUETE','CONCILIAR_FACTURA_PAQUETE')
      AND (o.payload->>'eventoId'=e.id::text OR EXISTS (SELECT 1 FROM public.siat_paquetes p WHERE p.evento_id=e.id AND o.payload->>'paqueteId'=p.id::text)
        OR EXISTS (SELECT 1 FROM public.facturas_siat f WHERE f.evento_id=e.id AND o.factura_id=f.id)))
    INTO complete;
  RETURN jsonb_build_object('eventoId',e.id,'confirmada',COALESCE(complete,false));
END; $$;
REVOKE ALL ON FUNCTION public.siat_9b_estado_recuperacion(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.siat_9b_estado_recuperacion(uuid,uuid) TO service_role;

-- Cola 9B separada: no cambia el reclamador 9A ni procesa tareas comerciales.
CREATE FUNCTION public.siat_reclamar_outbox_9b(p_worker text,p_agente text)
RETURNS SETOF public.siat_outbox LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_id uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM siat_configuracion WHERE id=true AND ambiente='PRUEBAS' AND siat_habilitado=false) THEN RETURN; END IF;
 SELECT o.id INTO v_id FROM siat_outbox o
 JOIN siat_eventos_significativos e ON e.id::text=o.payload->>'eventoId'
   OR EXISTS(SELECT 1 FROM siat_paquetes p WHERE p.evento_id=e.id AND p.id::text=o.payload->>'paqueteId')
 JOIN siat_agentes_locales a ON a.id=e.agente_local_id
 WHERE a.codigo=p_agente AND a.estado<>'BLOQUEADO' AND e.tipo_evento_codigo::text IN ('1','2','3','4') AND e.cafc_id IS NULL
 AND NOT EXISTS(SELECT 1 FROM facturas_siat f WHERE f.evento_id=e.id AND (f.ambiente<>'PRUEBAS' OR f.id IN ('c2279bbb-e851-468b-afe6-8ebf0b436d28','08dd889e-f2f7-4acb-be2e-2f911aae9919','8c5c0f1d-efd5-492f-ad26-3013f33cc3fe')))
 AND o.tipo_tarea IN ('REGISTRAR_EVENTO','CONCILIAR_EVENTO','GENERAR_PAQUETES_EVENTO','ENVIAR_PAQUETE','VALIDAR_PAQUETE','CONCILIAR_FACTURA_PAQUETE')
 AND o.estado IN ('PENDIENTE','REINTENTAR','PROCESANDO') AND o.disponible_desde<=now()
 AND (o.locked_until IS NULL OR o.locked_until<now())
 ORDER BY o.created_at FOR UPDATE OF o SKIP LOCKED LIMIT 1;
 IF v_id IS NULL THEN RETURN; END IF;
 RETURN QUERY UPDATE siat_outbox SET estado='PROCESANDO',locked_by=p_worker,locked_until=now()+interval '120 seconds',intentos=intentos+1 WHERE id=v_id RETURNING *;
END $$;
REVOKE ALL ON FUNCTION public.siat_reclamar_outbox_9b(text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.siat_reclamar_outbox_9b(text,text) TO service_role;

CREATE FUNCTION public.siat_9b_marcar_cufd(p_job uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 UPDATE siat_outbox SET payload=payload || jsonb_build_object('cufdRecuperacionIniciadaAt',now())
 WHERE id=p_job AND tipo_tarea='REGISTRAR_EVENTO' AND estado='PROCESANDO' AND NOT (payload ? 'cufdRecuperacionIniciadaAt');
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.siat_9b_marcar_cufd(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.siat_9b_marcar_cufd(uuid) TO service_role;

-- Numeración digital piloto; publicar únicamente con autorización explícita y
-- con el agente y local-ingest coordinados. CAFC conserva su bloqueo histórico.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.siat_bloques_numeracion_offline) THEN
    RAISE EXCEPTION 'NUMERACION_BLOQUES_HISTORICOS_REQUIEREN_CLASIFICACION';
  END IF;
END $$;
CREATE FUNCTION public.siat_9b_proteger_facturas_piloto() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.factura_id IN ('c2279bbb-e851-468b-afe6-8ebf0b436d28'::uuid,'08dd889e-f2f7-4acb-be2e-2f911aae9919'::uuid,'8c5c0f1d-efd5-492f-ad26-3013f33cc3fe'::uuid) THEN
    RAISE EXCEPTION 'CAFC_FACTURA_PILOTO_PROTEGIDA';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.siat_9b_proteger_facturas_piloto() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER siat_9b_cafc_proteger_piloto BEFORE INSERT OR UPDATE OF factura_id ON public.siat_9b_cafc_vinculos
  FOR EACH ROW EXECUTE FUNCTION public.siat_9b_proteger_facturas_piloto();
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
ALTER TABLE public.siat_bloques_numeracion_offline
  ADD COLUMN ambiente text NOT NULL DEFAULT 'PRUEBAS' CHECK (ambiente IN ('PRUEBAS','PRODUCCION')),
  ADD COLUMN codigo_sucursal integer NOT NULL,
  ADD COLUMN codigo_punto_venta integer NOT NULL,
  ADD COLUMN estado_reserva text NOT NULL DEFAULT 'ABIERTA' CHECK (estado_reserva IN ('ABIERTA','CONCILIADA')),
  ADD COLUMN cierre_siguiente bigint,
  ADD COLUMN cierre_evento_id uuid REFERENCES public.siat_eventos_significativos(id) ON DELETE RESTRICT,
  ADD COLUMN conciliada_at timestamptz,
  ADD CONSTRAINT siat_bloque_cierre_coherente CHECK (
    (estado_reserva='ABIERTA' AND cierre_siguiente IS NULL AND cierre_evento_id IS NULL AND conciliada_at IS NULL)
    OR (estado_reserva='CONCILIADA' AND cierre_siguiente BETWEEN numero_desde AND numero_hasta+1 AND conciliada_at IS NOT NULL)
  );
CREATE UNIQUE INDEX siat_bloque_agente_ambiente_unico
  ON public.siat_bloques_numeracion_offline (ambiente, agente_id, documento_sector) WHERE estado_reserva='ABIERTA';
CREATE UNIQUE INDEX siat_facturas_numero_piloto_unico
  ON public.facturas_siat (ambiente,codigo_sucursal,codigo_punto_venta,documento_sector,numero_factura) NULLS NOT DISTINCT
  WHERE ambiente='PRUEBAS' AND numero_factura IS NOT NULL AND NOT es_manual_cafc;
SET LOCAL search_path = public, extensions;
ALTER TABLE public.siat_bloques_numeracion_offline
  ADD CONSTRAINT siat_bloques_no_superpuestos EXCLUDE USING gist
  (ambiente WITH =, codigo_sucursal WITH =, codigo_punto_venta WITH =,
   documento_sector WITH =, (int8range(numero_desde,numero_hasta,'[]')) WITH &&);

-- Serializa la asociación de documentos y paquetes con el cierre, para que
-- una importación tardía no invalide la evidencia utilizada al liberar.
CREATE FUNCTION public.siat_9b_proteger_evento_conciliado() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.evento_id IS NULL OR (TG_OP='UPDATE' AND NEW.evento_id IS NOT DISTINCT FROM OLD.evento_id) THEN RETURN NEW; END IF;
  PERFORM 1 FROM public.siat_eventos_significativos WHERE id=NEW.evento_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.siat_bloques_numeracion_offline WHERE cierre_evento_id=NEW.evento_id AND estado_reserva='CONCILIADA') THEN
    RAISE EXCEPTION 'EVENTO_CON_RESERVA_YA_CONCILIADA';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.siat_9b_proteger_evento_conciliado() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER siat_factura_evento_conciliado BEFORE INSERT OR UPDATE OF evento_id ON public.facturas_siat
  FOR EACH ROW EXECUTE FUNCTION public.siat_9b_proteger_evento_conciliado();
CREATE TRIGGER siat_cafc_evento_conciliado BEFORE INSERT OR UPDATE OF evento_id ON public.siat_9b_cafc_vinculos
  FOR EACH ROW EXECUTE FUNCTION public.siat_9b_proteger_evento_conciliado();
CREATE TRIGGER siat_paquete_evento_conciliado BEFORE INSERT OR UPDATE OF evento_id ON public.siat_paquetes
  FOR EACH ROW EXECUTE FUNCTION public.siat_9b_proteger_evento_conciliado();

-- Las facturas CAFC históricas permanecen intactas; nuevas transcripciones
-- piloto quedan cerradas hasta confirmar su tratamiento fiscal específico.
CREATE FUNCTION public.siat_9b_bloquear_cafc_piloto() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF NEW.ambiente='PRUEBAS' AND NEW.es_manual_cafc THEN RAISE EXCEPTION 'CAFC_DESHABILITADO_PENDIENTE_AUTORIZACION'; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.siat_9b_bloquear_cafc_piloto() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER siat_factura_cafc_piloto_bloqueada BEFORE INSERT OR UPDATE OF ambiente,es_manual_cafc ON public.facturas_siat
  FOR EACH ROW EXECUTE FUNCTION public.siat_9b_bloquear_cafc_piloto();

CREATE OR REPLACE FUNCTION public.siat_reservar_numero(
  p_sucursal_id uuid,p_punto_venta_id uuid,p_documento_sector integer,p_tipo_emision text
) RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_numero bigint; v_siguiente bigint; v_bloque_fin bigint; v_max_factura bigint; v_max_secuencia bigint; v_ambiente text; v_sucursal integer; v_punto integer;
BEGIN
  IF p_tipo_emision NOT IN ('ONLINE','OFFLINE') THEN RAISE EXCEPTION 'Tipo de emisión no permitido.'; END IF;
  SELECT ambiente INTO v_ambiente FROM public.siat_configuracion WHERE id=true;
  IF v_ambiente IS DISTINCT FROM 'PRUEBAS' THEN
    INSERT INTO public.siat_secuencias(sucursal_id,punto_venta_id,documento_sector,tipo_emision,siguiente_numero)
    VALUES(p_sucursal_id,p_punto_venta_id,p_documento_sector,p_tipo_emision,1)
    ON CONFLICT(sucursal_id,punto_venta_id,documento_sector,tipo_emision) DO NOTHING;
    UPDATE public.siat_secuencias SET siguiente_numero=siguiente_numero+1,updated_at=now()
     WHERE sucursal_id=p_sucursal_id AND punto_venta_id IS NOT DISTINCT FROM p_punto_venta_id
       AND documento_sector=p_documento_sector AND tipo_emision=p_tipo_emision
     RETURNING siguiente_numero-1 INTO v_numero;
    IF v_numero IS NULL THEN RAISE EXCEPTION 'No fue posible reservar la numeración fiscal.'; END IF;
    RETURN v_numero;
  END IF;
  SELECT s.codigo,coalesce(p.codigo,0) INTO v_sucursal,v_punto FROM public.siat_sucursales s
    LEFT JOIN public.siat_puntos_venta p ON p.id=p_punto_venta_id AND p.sucursal_id=s.id
    WHERE s.id=p_sucursal_id AND (p_punto_venta_id IS NULL OR p.id IS NOT NULL);
  IF NOT FOUND THEN RAISE EXCEPTION 'SUCURSAL_O_PUNTO_INVALIDO'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':','siat-numeracion',v_sucursal::text,v_punto::text),0));
  IF p_tipo_emision='ONLINE' AND EXISTS (
    SELECT 1 FROM public.siat_bloques_numeracion_offline b
    WHERE b.ambiente=v_ambiente AND b.codigo_sucursal=v_sucursal AND b.codigo_punto_venta=v_punto AND b.estado_reserva='ABIERTA'
  ) THEN RAISE EXCEPTION 'EMISION_ONLINE_PAUSADA_POR_RESERVA_OFFLINE'; END IF;
  INSERT INTO public.siat_secuencias(sucursal_id,punto_venta_id,documento_sector,tipo_emision,siguiente_numero)
  VALUES(p_sucursal_id,p_punto_venta_id,p_documento_sector,p_tipo_emision,1)
  ON CONFLICT(sucursal_id,punto_venta_id,documento_sector,tipo_emision) DO NOTHING;
  SELECT siguiente_numero INTO v_siguiente FROM public.siat_secuencias
   WHERE sucursal_id=p_sucursal_id AND punto_venta_id IS NOT DISTINCT FROM p_punto_venta_id
     AND documento_sector=p_documento_sector AND tipo_emision=p_tipo_emision FOR UPDATE;
  SELECT max(numero_factura) INTO v_max_factura FROM public.facturas_siat
   WHERE codigo_sucursal=v_sucursal AND codigo_punto_venta=v_punto AND documento_sector=p_documento_sector AND NOT es_manual_cafc;
  SELECT max(q.siguiente_numero-1) INTO v_max_secuencia FROM public.siat_secuencias q
    JOIN public.siat_sucursales s ON s.id=q.sucursal_id LEFT JOIN public.siat_puntos_venta p ON p.id=q.punto_venta_id
    WHERE s.codigo=v_sucursal AND coalesce(p.codigo,0)=v_punto AND q.documento_sector=p_documento_sector;
  v_numero := greatest(v_siguiente,coalesce(v_max_factura,0)+1,coalesce(v_max_secuencia,0)+1);
  LOOP
    SELECT greatest(
      (SELECT max(numero_hasta) FROM public.siat_bloques_numeracion_offline WHERE codigo_sucursal=v_sucursal AND codigo_punto_venta=v_punto
       AND documento_sector=p_documento_sector AND v_numero BETWEEN numero_desde AND numero_hasta),
      (SELECT max(numero_factura) FROM public.facturas_siat WHERE codigo_sucursal=v_sucursal AND codigo_punto_venta=v_punto
       AND documento_sector=p_documento_sector AND es_manual_cafc AND numero_factura=v_numero)) INTO v_bloque_fin;
    EXIT WHEN v_bloque_fin IS NULL;
    v_numero := v_bloque_fin+1;
  END LOOP;
  UPDATE public.siat_secuencias SET siguiente_numero=v_numero+1,updated_at=now()
   WHERE sucursal_id=p_sucursal_id AND punto_venta_id IS NOT DISTINCT FROM p_punto_venta_id
     AND documento_sector=p_documento_sector AND tipo_emision=p_tipo_emision;
  RETURN v_numero;
END $$;

CREATE OR REPLACE FUNCTION public.siat_reservar_bloque_offline(p_agente_codigo text,p_cantidad integer DEFAULT NULL)
RETURNS TABLE(numero_desde bigint,numero_hasta bigint) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.siat_agentes_locales%ROWTYPE; v_sector integer; v_ambiente text; v_bloque public.siat_bloques_numeracion_offline%ROWTYPE; v_max bigint; v_manual bigint; v_sucursal integer; v_punto integer;
BEGIN
  IF p_cantidad IS NULL OR p_cantidad NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Cantidad offline inválida.'; END IF;
  SELECT * INTO a FROM public.siat_agentes_locales WHERE codigo=p_agente_codigo AND estado IN ('PENDIENTE','ACTIVO','DEGRADADO','OFFLINE') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Agente local no habilitado.'; END IF;
  SELECT ambiente,documento_sector INTO v_ambiente,v_sector FROM public.siat_configuracion WHERE id=true;
  IF v_ambiente IS DISTINCT FROM 'PRUEBAS' OR v_sector IS NULL THEN RAISE EXCEPTION 'Reserva permitida solo en piloto.'; END IF;
  SELECT s.codigo,coalesce(p.codigo,0) INTO v_sucursal,v_punto FROM public.siat_sucursales s
    LEFT JOIN public.siat_puntos_venta p ON p.id=a.punto_venta_id AND p.sucursal_id=s.id
    WHERE s.id=a.sucursal_id AND (a.punto_venta_id IS NULL OR p.id IS NOT NULL);
  IF NOT FOUND THEN RAISE EXCEPTION 'SUCURSAL_O_PUNTO_INVALIDO'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':','siat-numeracion',v_sucursal::text,v_punto::text),0));
  SELECT * INTO v_bloque FROM public.siat_bloques_numeracion_offline b WHERE b.agente_id=a.id AND b.ambiente=v_ambiente AND b.documento_sector=v_sector AND b.estado_reserva='ABIERTA';
  IF FOUND THEN
    RETURN QUERY SELECT v_bloque.numero_desde,v_bloque.numero_hasta; RETURN;
  END IF;
  SELECT greatest(
    coalesce((SELECT max(f.numero_factura) FROM public.facturas_siat f WHERE f.codigo_sucursal=v_sucursal AND f.codigo_punto_venta=v_punto AND f.documento_sector=v_sector AND NOT f.es_manual_cafc),0),
    coalesce((SELECT max(q.siguiente_numero-1) FROM public.siat_secuencias q JOIN public.siat_sucursales s ON s.id=q.sucursal_id LEFT JOIN public.siat_puntos_venta p ON p.id=q.punto_venta_id WHERE s.codigo=v_sucursal AND coalesce(p.codigo,0)=v_punto AND q.documento_sector=v_sector),0),
    coalesce((SELECT max(b.numero_hasta) FROM public.siat_bloques_numeracion_offline b WHERE b.codigo_sucursal=v_sucursal AND b.codigo_punto_venta=v_punto AND b.documento_sector=v_sector),0)
  ) INTO v_max;
  -- La restricción histórica todavía impide un mismo número OFFLINE manual y
  -- digital; saltar solo colisiones efectivas, sin adoptar el correlativo CAFC.
  LOOP
    SELECT max(f.numero_factura) INTO v_manual FROM public.facturas_siat f
      WHERE f.codigo_sucursal=v_sucursal
        AND f.codigo_punto_venta=v_punto AND f.documento_sector=v_sector AND f.es_manual_cafc
        AND f.numero_factura BETWEEN v_max+1 AND v_max+p_cantidad;
    EXIT WHEN v_manual IS NULL;
    v_max:=v_manual;
  END LOOP;
  INSERT INTO public.siat_bloques_numeracion_offline(agente_id,sucursal_id,punto_venta_id,documento_sector,numero_desde,numero_hasta,ambiente,codigo_sucursal,codigo_punto_venta)
  VALUES(a.id,a.sucursal_id,a.punto_venta_id,v_sector,v_max+1,v_max+p_cantidad,v_ambiente,v_sucursal,v_punto)
  RETURNING * INTO v_bloque;
  RETURN QUERY SELECT v_bloque.numero_desde,v_bloque.numero_hasta;
END $$;

-- Solo confirma la situación local cuando el SIN ya aceptó el evento y no
-- existen documentos ni trabajos que puedan representar una emisión pendiente.
CREATE FUNCTION public.siat_9b_evento_vacio_confirmado(p_agente uuid,p_evento uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e public.siat_eventos_significativos%ROWTYPE;
BEGIN
  SELECT * INTO e FROM public.siat_eventos_significativos WHERE id=p_evento AND agente_local_id=p_agente;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM public.siat_configuracion WHERE id=true AND ambiente='PRUEBAS')
    OR NOT EXISTS (SELECT 1 FROM public.siat_agentes_locales WHERE id=p_agente AND estado<>'BLOQUEADO') THEN RETURN false; END IF;
  RETURN COALESCE(e.estado='VALIDADO' AND e.fecha_fin IS NOT NULL AND e.cafc_id IS NULL
    AND e.tipo_evento_codigo::text IN ('1','2','3','4') AND NULLIF(trim(e.codigo_recepcion),'') IS NOT NULL
    AND jsonb_path_exists(COALESCE(e.respuesta_siat,'{}'::jsonb),'$.**.transaccion ? (@ == true || @ == "true")')
    AND NOT EXISTS (SELECT 1 FROM jsonb_path_query(COALESCE(e.respuesta_siat,'{}'::jsonb),'$.**.transaccion') v WHERE trim(both '"' from v::text)<>'true')
    AND NOT EXISTS (SELECT 1 FROM public.facturas_siat f WHERE f.evento_id=e.id)
    AND NOT EXISTS (SELECT 1 FROM public.siat_9b_cafc_vinculos l WHERE l.evento_id=e.id)
    AND NOT EXISTS (SELECT 1 FROM public.siat_paquetes p WHERE p.evento_id=e.id)
    AND NOT EXISTS (SELECT 1 FROM public.siat_outbox o WHERE o.payload->>'eventoId'=e.id::text AND o.estado IN ('PENDIENTE','PROCESANDO','REINTENTAR','FALLIDA'))
    AND NOT EXISTS (SELECT 1 FROM public.siat_intentos_envio i WHERE i.evento_id=e.id AND i.estado IN ('INICIADO','AMBIGUO','REINTENTO'))
  ,false);
END $$;
REVOKE ALL ON FUNCTION public.siat_9b_evento_vacio_confirmado(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.siat_9b_evento_vacio_confirmado(uuid,uuid) TO service_role;

-- Comprobación de persistencia del nonce de diagnóstico, sin tocar datos fiscales.
CREATE FUNCTION public.siat_9b_verificar_nonce_prueba(p_agente uuid,p_nonce text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF p_nonce !~ '^9bprobe_[a-f0-9]{32}$'
    OR NOT EXISTS (SELECT 1 FROM public.siat_configuracion WHERE id=true AND ambiente='PRUEBAS' AND siat_habilitado=false)
    OR NOT EXISTS (SELECT 1 FROM public.siat_agentes_locales WHERE id=p_agente AND estado<>'BLOQUEADO') THEN
    RAISE EXCEPTION 'SONDA_9B_NO_AUTORIZADA';
  END IF;
  RETURN jsonb_build_object('persistido',EXISTS (
    SELECT 1 FROM public.siat_agent_nonces n WHERE n.agente_id=p_agente AND n.nonce=p_nonce AND n.expira_at>now()
  ));
END $$;
REVOKE ALL ON FUNCTION public.siat_9b_verificar_nonce_prueba(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.siat_9b_verificar_nonce_prueba(uuid,text) TO service_role;

-- Solo el agente autenticado puede presentar su bloque retirado. No se borra
-- ni se reutiliza el rango: la incertidumbre mantiene la reserva abierta.
CREATE FUNCTION public.siat_9b_conciliar_reserva(p_agente_codigo text,p_desde bigint,p_hasta bigint,p_siguiente bigint,p_evento uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a public.siat_agentes_locales%ROWTYPE; b public.siat_bloques_numeracion_offline%ROWTYPE; v_count bigint; v_ok jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.siat_configuracion WHERE id=true AND ambiente='PRUEBAS') THEN RAISE EXCEPTION 'RESERVA_SOLO_PILOTO'; END IF;
  SELECT * INTO a FROM public.siat_agentes_locales WHERE codigo=p_agente_codigo AND estado<>'BLOQUEADO' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENTE_NO_DISPONIBLE'; END IF;
  SELECT * INTO b FROM public.siat_bloques_numeracion_offline WHERE agente_id=a.id AND ambiente='PRUEBAS' AND numero_desde=p_desde AND numero_hasta=p_hasta FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVA_NO_PERTENECE_AL_AGENTE'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(concat_ws(':','siat-numeracion',b.codigo_sucursal::text,b.codigo_punto_venta::text),0));
  IF b.estado_reserva='CONCILIADA' THEN
    IF b.cierre_siguiente IS DISTINCT FROM p_siguiente OR b.cierre_evento_id IS DISTINCT FROM p_evento THEN RAISE EXCEPTION 'CIERRE_RESERVA_DATOS_DISTINTOS'; END IF;
    RETURN jsonb_build_object('estado','CONCILIADA','desde',b.numero_desde,'hasta',b.numero_hasta);
  END IF;
  IF p_siguiente IS NULL OR p_siguiente<b.numero_desde OR p_siguiente>b.numero_hasta+1 THEN RAISE EXCEPTION 'CIERRE_RESERVA_LIMITE_INVALIDO'; END IF;
  IF p_evento IS NOT NULL THEN
    PERFORM 1 FROM public.siat_eventos_significativos e WHERE e.id=p_evento AND e.agente_local_id=a.id AND e.created_at>=b.asignado_at FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'RESERVA_EVENTO_NO_PERTENECE_AL_AGENTE'; END IF;
  END IF;
  SELECT count(*) INTO v_count FROM public.facturas_siat f
    WHERE f.ambiente='PRUEBAS' AND f.codigo_sucursal=b.codigo_sucursal AND f.codigo_punto_venta=b.codigo_punto_venta
      AND f.documento_sector=b.documento_sector AND f.numero_factura BETWEEN b.numero_desde AND b.numero_hasta AND NOT f.es_manual_cafc;
  IF v_count<>p_siguiente-b.numero_desde OR EXISTS (
    SELECT 1 FROM public.facturas_siat f WHERE f.ambiente='PRUEBAS' AND f.codigo_sucursal=b.codigo_sucursal
      AND f.codigo_punto_venta=b.codigo_punto_venta AND f.documento_sector=b.documento_sector
      AND f.numero_factura BETWEEN b.numero_desde AND b.numero_hasta AND NOT f.es_manual_cafc
      AND (f.numero_factura>=p_siguiente OR f.agente_local_id IS DISTINCT FROM a.id OR f.evento_id IS DISTINCT FROM p_evento
        OR f.estado_fiscal<>'VALIDADA' OR f.codigo_estado IS DISTINCT FROM 908 OR f.transaccion IS DISTINCT FROM true OR NULLIF(trim(f.codigo_recepcion),'') IS NULL)
  ) THEN RAISE EXCEPTION 'RESERVA_FACTURAS_NO_CONCILIADAS'; END IF;
  IF p_evento IS NULL THEN
    IF p_siguiente<>b.numero_desde OR EXISTS (SELECT 1 FROM public.siat_eventos_significativos e WHERE e.agente_local_id=a.id AND e.created_at>=b.asignado_at) THEN RAISE EXCEPTION 'RESERVA_SIN_EVENTO_NO_VERIFICABLE'; END IF;
  ELSE
    IF NOT (p_siguiente=b.numero_desde AND public.siat_9b_evento_vacio_confirmado(a.id,p_evento)) THEN
      v_ok:=public.siat_9b_estado_recuperacion(a.id,p_evento);
      IF v_ok->>'confirmada' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'RESERVA_EVENTO_NO_CONCILIADO'; END IF;
    END IF;
  END IF;
  UPDATE public.siat_bloques_numeracion_offline SET estado_reserva='CONCILIADA',cierre_siguiente=p_siguiente,cierre_evento_id=p_evento,conciliada_at=now() WHERE id=b.id;
  INSERT INTO public.siat_auditoria(entidad,entidad_id,accion,contexto) VALUES ('siat_bloques_numeracion_offline',b.id::text,'RESERVA_CONCILIADA',jsonb_build_object('agente',a.codigo,'evento',p_evento,'desde',p_desde,'hasta',p_hasta,'siguiente',p_siguiente));
  RETURN jsonb_build_object('estado','CONCILIADA','desde',b.numero_desde,'hasta',b.numero_hasta);
END $$;
REVOKE ALL ON FUNCTION public.siat_9b_conciliar_reserva(text,bigint,bigint,bigint,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.siat_9b_conciliar_reserva(text,bigint,bigint,bigint,uuid) TO service_role;
COMMIT;

-- Evidencia acotada al único fixture piloto. Ninguna aprobación habilita transmisión.
BEGIN;
ALTER TABLE public.siat_piloto_control
  ADD COLUMN nit_cliente_id uuid,
  ADD COLUMN nit_cliente_documento text,
  ADD COLUMN nit_ambiente text,
  ADD COLUMN nit_consultado_at timestamptz,
  ADD COLUMN nit_verificado_at timestamptz,
  ADD COLUMN nit_codigo_respuesta integer,
  ADD COLUMN nit_resultado text,
  ADD COLUMN nit_actor_auth_user_id uuid,
  ADD COLUMN eku_tipo_evidencia text,
  ADD COLUMN eku_entidad_confirmadora text,
  ADD COLUMN eku_fecha_confirmacion date,
  ADD COLUMN eku_referencia_documental text,
  ADD COLUMN eku_cert_sha256 text,
  ADD COLUMN eku_aprobado_por uuid,
  ADD COLUMN eku_aprobado_at timestamptz,
  ADD CONSTRAINT siat_piloto_nit_evidencia_check CHECK (
    NOT nit_cliente_verificado OR
    ((nit_cliente_id IS NOT NULL AND nit_cliente_documento = '9204357'
      AND nit_ambiente = 'PRUEBAS' AND nit_codigo_respuesta = 986
      AND nit_resultado = 'ACTIVO' AND nit_verificado_at IS NOT NULL) IS TRUE)
  ),
  ADD CONSTRAINT siat_piloto_eku_evidencia_check CHECK (
    NOT eku_fiscal_aprobado OR
    ((eku_tipo_evidencia = 'ACEPTACION_SIAT_PILOTO'
      AND eku_entidad_confirmadora = 'SIN' AND eku_fecha_confirmacion IS NOT NULL
      AND length(eku_referencia_documental) BETWEEN 8 AND 200
      AND eku_cert_sha256 ~ '^[a-f0-9]{64}$'
      AND eku_aprobado_por IS NOT NULL AND eku_aprobado_at IS NOT NULL) IS TRUE)
  ),
  ADD CONSTRAINT siat_piloto_transmision_evidencia_check CHECK (
    NOT emision_habilitada OR (nit_cliente_verificado AND eku_fiscal_aprobado)
  );

CREATE OR REPLACE FUNCTION public.siat_registrar_nit_cliente_piloto(
  p_actor_auth_user_id uuid, p_cliente_id uuid, p_documento text, p_ambiente text,
  p_transaccion boolean, p_codigo integer, p_resultado text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_aprobado boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE auth_user_id = p_actor_auth_user_id
    AND activo = true AND lower(rol) = 'administrador') THEN
    RAISE EXCEPTION 'PILOTO_ADMIN_REQUERIDO';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.siat_configuracion WHERE id = true
    AND ambiente = 'PRUEBAS' AND nit = '72229012' AND siat_habilitado = false) THEN
    RAISE EXCEPTION 'PILOTO_CONFIGURACION_INVALIDA';
  END IF;
  IF p_ambiente <> 'PRUEBAS' OR p_documento <> '9204357'
    OR NOT EXISTS (SELECT 1 FROM public.clientes WHERE id = p_cliente_id
      AND codigo_cliente = 'CLI-000006' AND activo = true
      AND tipo_documento = 'NIT' AND numero_documento = p_documento) THEN
    RAISE EXCEPTION 'PILOTO_CLIENTE_INVALIDO';
  END IF;
  IF p_resultado NOT IN ('ACTIVO','INACTIVO','INEXISTENTE','ERROR_SERVICIO') THEN
    RAISE EXCEPTION 'PILOTO_RESPUESTA_NIT_INVALIDA';
  END IF;
  v_aprobado := p_transaccion IS TRUE AND p_codigo = 986 AND p_resultado = 'ACTIVO';
  IF p_resultado = 'ACTIVO' AND NOT v_aprobado THEN
    RAISE EXCEPTION 'PILOTO_RESPUESTA_NIT_INVALIDA';
  END IF;
  UPDATE public.siat_piloto_control SET
    nit_cliente_verificado = v_aprobado,
    nit_cliente_id = p_cliente_id, nit_cliente_documento = p_documento,
    nit_ambiente = p_ambiente, nit_consultado_at = now(),
    nit_verificado_at = CASE WHEN v_aprobado THEN now() ELSE NULL END,
    nit_codigo_respuesta = p_codigo, nit_resultado = p_resultado,
    nit_actor_auth_user_id = p_actor_auth_user_id,
    emision_habilitada = false, updated_at = now()
  WHERE id = true;
  INSERT INTO public.siat_auditoria
    (actor_auth_user_id, entidad, entidad_id, accion, contexto, resultado)
  VALUES (p_actor_auth_user_id, 'siat_piloto_control', 'true', 'VERIFICAR_NIT_CLIENTE_PILOTO',
    jsonb_build_object('clienteId', p_cliente_id, 'documento', p_documento,
      'ambiente', p_ambiente, 'transaccion', p_transaccion,
      'codigo', p_codigo, 'resultado', p_resultado),
    CASE WHEN v_aprobado THEN 'EXITOSO' ELSE 'BLOQUEADO' END);
  RETURN v_aprobado;
END;
$$;
REVOKE ALL ON FUNCTION public.siat_registrar_nit_cliente_piloto(uuid,uuid,text,text,boolean,integer,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siat_registrar_nit_cliente_piloto(uuid,uuid,text,text,boolean,integer,text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.siat_invalidar_nit_piloto_si_cambia_cliente()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.codigo_cliente = 'CLI-000006' AND
    (NEW.numero_documento IS DISTINCT FROM OLD.numero_documento
      OR NEW.tipo_documento IS DISTINCT FROM OLD.tipo_documento
      OR NEW.activo IS DISTINCT FROM OLD.activo) THEN
    UPDATE public.siat_piloto_control SET nit_cliente_verificado = false,
      nit_verificado_at = NULL, emision_habilitada = false, updated_at = now()
    WHERE id = true;
    INSERT INTO public.siat_auditoria (entidad, entidad_id, accion, contexto, resultado)
    VALUES ('siat_piloto_control', 'true', 'INVALIDAR_NIT_CLIENTE_PILOTO',
      jsonb_build_object('clienteId', OLD.id), 'BLOQUEADO');
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER siat_invalidar_nit_piloto_si_cambia_cliente
AFTER UPDATE OF numero_documento, tipo_documento, activo ON public.clientes
FOR EACH ROW EXECUTE FUNCTION public.siat_invalidar_nit_piloto_si_cambia_cliente();

CREATE OR REPLACE FUNCTION public.siat_aprobar_certificado_piloto(
  p_actor_auth_user_id uuid, p_tipo_evidencia text, p_entidad text,
  p_fecha_confirmacion date, p_referencia text, p_cert_sha256 text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.usuarios WHERE auth_user_id = p_actor_auth_user_id
    AND activo = true AND lower(rol) = 'administrador') THEN
    RAISE EXCEPTION 'PILOTO_ADMIN_REQUERIDO';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.siat_configuracion WHERE id = true
    AND ambiente = 'PRUEBAS' AND nit = '72229012' AND siat_habilitado = false) THEN
    RAISE EXCEPTION 'PILOTO_CONFIGURACION_INVALIDA';
  END IF;
  IF p_tipo_evidencia IS DISTINCT FROM 'ACEPTACION_SIAT_PILOTO'
    OR p_entidad IS DISTINCT FROM 'SIN'
    OR p_fecha_confirmacion IS NULL OR p_fecha_confirmacion > current_date
    OR length(trim(p_referencia)) NOT BETWEEN 8 AND 200
    OR p_cert_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'PILOTO_EVIDENCIA_CERTIFICADO_INSUFICIENTE';
  END IF;
  UPDATE public.siat_piloto_control SET eku_fiscal_aprobado = true,
    eku_tipo_evidencia = p_tipo_evidencia, eku_entidad_confirmadora = p_entidad,
    eku_fecha_confirmacion = p_fecha_confirmacion,
    eku_referencia_documental = trim(p_referencia), eku_cert_sha256 = p_cert_sha256,
    eku_aprobado_por = p_actor_auth_user_id, eku_aprobado_at = now(),
    emision_habilitada = false, updated_at = now()
  WHERE id = true;
  INSERT INTO public.siat_auditoria
    (actor_auth_user_id, entidad, entidad_id, accion, contexto, resultado)
  VALUES (p_actor_auth_user_id, 'siat_piloto_control', 'true', 'APROBAR_CERTIFICADO_PILOTO',
    jsonb_build_object('tipoEvidencia', p_tipo_evidencia, 'entidad', p_entidad,
      'fechaConfirmacion', p_fecha_confirmacion, 'referencia', trim(p_referencia),
      'certSha256', p_cert_sha256), 'EXITOSO');
END;
$$;
REVOKE ALL ON FUNCTION public.siat_aprobar_certificado_piloto(uuid,text,text,date,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.siat_aprobar_certificado_piloto(uuid,text,text,date,text,text)
  TO service_role;

COMMIT;

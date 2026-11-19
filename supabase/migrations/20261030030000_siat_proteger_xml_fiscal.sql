-- El XML firmado solo se entrega mediante el gateway autenticado y autorizado.
BEGIN;
REVOKE SELECT ON public.facturas_siat FROM PUBLIC, anon, authenticated;
REVOKE SELECT (xml_documento) ON public.facturas_siat FROM PUBLIC, anon, authenticated;
DO $$
DECLARE permitted_columns text;
BEGIN
  SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum) INTO permitted_columns
  FROM pg_attribute WHERE attrelid = 'public.facturas_siat'::regclass
    AND attnum > 0 AND NOT attisdropped AND attname <> 'xml_documento';
  IF permitted_columns IS NULL THEN RAISE EXCEPTION 'Columnas fiscales no disponibles'; END IF;
  EXECUTE format('GRANT SELECT (%s) ON public.facturas_siat TO authenticated', permitted_columns);
END $$;
COMMIT;

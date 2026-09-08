-- Integración del módulo de clientes con public.clientes.
-- La migración inicial ya creó la tabla; aquí completamos el comportamiento
-- que necesita la aplicación.

CREATE SEQUENCE IF NOT EXISTS public.clientes_codigo_seq;

CREATE OR REPLACE FUNCTION public.fn_generar_codigo_cliente()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NULLIF(trim(NEW.codigo_cliente), '') IS NULL THEN
    NEW.codigo_cliente := 'CLI-' || lpad(nextval('public.clientes_codigo_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_clientes_codigo ON public.clientes;
CREATE TRIGGER trg_clientes_codigo
BEFORE INSERT ON public.clientes
FOR EACH ROW EXECUTE FUNCTION public.fn_generar_codigo_cliente();

-- Permite aplicar la migración sobre una base que ya tenga clientes sin código.
WITH numerados AS (
  SELECT id, 'CLI-' || lpad(row_number() OVER (ORDER BY created_at, id)::text, 6, '0') AS codigo
  FROM public.clientes
  WHERE NULLIF(trim(codigo_cliente), '') IS NULL
)
UPDATE public.clientes AS c
SET codigo_cliente = n.codigo
FROM numerados AS n
WHERE c.id = n.id;

DO $do$
DECLARE
  ultimo_codigo bigint;
BEGIN
  SELECT max(NULLIF(regexp_replace(codigo_cliente, '\D', '', 'g'), '')::bigint)
  INTO ultimo_codigo
  FROM public.clientes;

  IF ultimo_codigo IS NULL OR ultimo_codigo < 1 THEN
    PERFORM setval('public.clientes_codigo_seq', 1, false);
  ELSE
    PERFORM setval('public.clientes_codigo_seq', ultimo_codigo, true);
  END IF;
END
$do$;

CREATE UNIQUE INDEX IF NOT EXISTS clientes_documento_unico_idx
ON public.clientes (tipo_documento, numero_documento, COALESCE(complemento, ''))
WHERE numero_documento IS NOT NULL AND NULLIF(trim(numero_documento), '') IS NOT NULL;

ALTER TABLE public.clientes
  ADD CONSTRAINT clientes_estado_documento_check
  CHECK (tipo_documento IS NULL OR tipo_documento IN ('CI', 'CEX', 'NIT', 'PASAPORTE', 'OTRO'));

-- El valor anterior REMOTO no satisface la propia constraint de la columna.
-- Las facturas online nacen sincronizadas; las importaciones locales indican su estado explícitamente.
ALTER TABLE public.facturas_siat
  ALTER COLUMN estado_sincronizacion SET DEFAULT 'SINCRONIZADA';

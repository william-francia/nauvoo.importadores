-- PASO 5 SIAT: la unicidad de facturas debe coincidir con la clave de la secuencia fiscal.
-- La reserva ya es atomica en siat_reservar_numero; este constraint evita colisiones
-- entre documentos sector o tipos de emision distintos.

BEGIN;

ALTER TABLE public.facturas_siat
  DROP CONSTRAINT IF EXISTS factura_sucursal_numero_unico;

ALTER TABLE public.facturas_siat
  ADD CONSTRAINT facturas_siat_numeracion_fiscal_unica
  UNIQUE NULLS NOT DISTINCT (
    codigo_sucursal,
    codigo_punto_venta,
    documento_sector,
    tipo_emision,
    numero_factura
  );

COMMIT;

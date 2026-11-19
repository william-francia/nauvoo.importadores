-- Vincula la autorización al nombre de producto visto en el preview.
ALTER TABLE public.siat_piloto_autorizaciones
  ADD COLUMN producto_descripcion_snapshot text NOT NULL
  CHECK (length(trim(producto_descripcion_snapshot)) > 0);

CREATE OR REPLACE FUNCTION public.siat_validar_descripcion_piloto()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public
AS $$
DECLARE
  v_descripcion text;
  v_nombre_actual text;
BEGIN
  IF NEW.origen_fiscal <> 'PILOTO' THEN RETURN NEW; END IF;
  SELECT a.producto_descripcion_snapshot, p.nombre
    INTO v_descripcion, v_nombre_actual
  FROM public.siat_piloto_autorizaciones a
  JOIN public.productos p ON p.id = a.producto_id
  WHERE a.id = NEW.piloto_autorizacion_id;
  IF v_descripcion IS NULL OR v_nombre_actual IS DISTINCT FROM v_descripcion
     OR NEW.detalle_snapshot->0->>'descripcion' IS DISTINCT FROM v_descripcion THEN
    RAISE EXCEPTION 'PILOTO_DESCRIPCION_CAMBIO_DESDE_PREVIEW';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_siat_validar_descripcion_piloto
  BEFORE INSERT ON public.facturas_siat
  FOR EACH ROW EXECUTE FUNCTION public.siat_validar_descripcion_piloto();

-- Solo productos nuevos. No reclasifica inventario histórico ni homologa productos SIN.
ALTER TABLE public.productos ADD COLUMN actividad_economica text;

CREATE FUNCTION public.productos_actividad_economica_fija()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.siat_catalogos c
      JOIN public.siat_catalogo_items i ON i.catalogo_id=c.id
      WHERE c.codigo='ACTIVIDADES' AND c.estado='VIGENTE' AND c.version_normativa='SIAT_VIGENTE'
        AND i.codigo='4752100' AND i.activo=true
    ) THEN
      RAISE EXCEPTION 'La actividad 4752100 no está vigente en el catálogo SIAT.';
    END IF;
    NEW.actividad_economica := '4752100';
  ELSIF NEW.actividad_economica IS DISTINCT FROM OLD.actividad_economica THEN
    RAISE EXCEPTION 'La actividad económica del producto es de solo lectura.';
  END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER productos_actividad_economica_fija
BEFORE INSERT OR UPDATE OF actividad_economica ON public.productos
FOR EACH ROW EXECUTE FUNCTION public.productos_actividad_economica_fija();

-- Reutiliza la homologación completa existente; nunca inventa producto SIN, unidad u origen.
CREATE FUNCTION public.siat_homologacion_actividad_producto()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
DECLARE actividad text;
BEGIN
  SELECT actividad_economica INTO actividad FROM public.productos WHERE id=NEW.producto_id;
  IF actividad IS NOT NULL AND NEW.actividad_economica IS DISTINCT FROM actividad THEN
    RAISE EXCEPTION 'La actividad de homologación debe coincidir con la actividad del producto.';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER siat_homologacion_actividad_producto
BEFORE INSERT OR UPDATE OF actividad_economica,producto_id ON public.siat_producto_homologaciones
FOR EACH ROW EXECUTE FUNCTION public.siat_homologacion_actividad_producto();

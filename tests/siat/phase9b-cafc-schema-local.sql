-- Esquema mínimo sintético, exclusivamente para una base local efímera.
CREATE SCHEMA storage;
CREATE TABLE storage.objects(bucket_id text,name text);
CREATE TABLE public.usuarios(id uuid PRIMARY KEY,auth_user_id uuid,activo boolean,rol text);
CREATE TABLE public.clientes(id uuid PRIMARY KEY,nombre_razon_social text,tipo_documento text,numero_documento text,complemento text);
CREATE TABLE public.ventas(id uuid PRIMARY KEY,cliente_id uuid,estado text,inventario_aplicado boolean,total numeric,descuento_venta numeric,metodo_pago text);
CREATE TABLE public.detalle_ventas(id uuid PRIMARY KEY,venta_id uuid,codigo_producto_snapshot text,descripcion_producto text,cantidad numeric,precio_unitario numeric,descuento numeric,subtotal numeric);
CREATE TABLE public.movimientos_inventario(id uuid PRIMARY KEY,venta_id uuid,cantidad numeric);
CREATE TABLE public.stock_por_almacen(id uuid PRIMARY KEY,cantidad_disponible numeric);
CREATE TABLE public.siat_configuracion(id boolean PRIMARY KEY,ambiente text,modalidad text,siat_habilitado boolean,nit text);
CREATE TABLE public.siat_agentes_locales(id uuid PRIMARY KEY,estado text,sucursal_id uuid,punto_venta_id uuid,codigo text);
CREATE TABLE public.siat_sucursales(id uuid PRIMARY KEY,codigo integer);
CREATE TABLE public.siat_puntos_venta(id uuid PRIMARY KEY,codigo integer);
CREATE TABLE public.siat_cuis(id uuid PRIMARY KEY,codigo text);
CREATE TABLE public.siat_cufd(id uuid PRIMARY KEY,cuis_id uuid,codigo text,ambiente text,sucursal_id uuid,punto_venta_id uuid,fecha_inicio timestamptz,fecha_expiracion timestamptz);
CREATE TABLE public.siat_rangos_cafc(id uuid PRIMARY KEY,sucursal_id uuid,punto_venta_id uuid,estado text,vigente_desde timestamptz,vigente_hasta timestamptz,rango_desde bigint,rango_hasta bigint,autorizacion text);
CREATE TABLE public.siat_eventos_significativos(id uuid PRIMARY KEY,agente_local_id uuid,tipo_evento_codigo text,fecha_inicio timestamptz,fecha_fin timestamptz,cafc_id uuid,cufd_id uuid,sucursal_id uuid,punto_venta_id uuid,descripcion text,evidencia_deteccion jsonb,actor_auth_user_id uuid,origen text);
CREATE TABLE public.siat_metodo_pago_mapeos(metodo_interno text,codigo_metodo_pago integer,version_normativa text);
CREATE TABLE public.facturas_siat(id uuid PRIMARY KEY,venta_id uuid UNIQUE,origen_fiscal text,idempotency_key text UNIQUE,correlation_id uuid UNIQUE,ambiente text,version_especificacion text,modalidad text,documento_sector integer,tipo_factura integer,sucursal_id uuid,punto_venta_id uuid,cuis_id uuid,cufd_id uuid,tipo_emision text,estado_fiscal text,numero_factura bigint,fecha_emision timestamptz,codigo_sucursal integer,codigo_punto_venta integer,cuis text,cufd text,cuf text,nombre_razon_social text,tipo_documento text,numero_documento text,complemento text,monto_total numeric,cliente_snapshot jsonb,detalle_snapshot jsonb,totales_snapshot jsonb,pago_snapshot jsonb,sucursal_snapshot jsonb,punto_venta_snapshot jsonb,xml_hash text,xml_firmado boolean,xml_storage_path text,qr_contenido text,evento_id uuid,agente_local_id uuid,origen_caja text,local_created_at timestamptz,estado_sincronizacion text,es_manual_cafc boolean,cafc_id uuid,numero_manual bigint,evidencia_original_storage_path text,version_xsd text,hash_xsd text);
CREATE TABLE public.siat_cafc_usos(rango_cafc_id uuid,numero bigint CHECK(numero<>56),factura_id uuid UNIQUE,evento_id uuid,agente_id uuid,estado text,evidencia_storage_path text,UNIQUE(rango_cafc_id,numero));
CREATE TABLE public.siat_importaciones_offline(agente_id uuid,idempotency_key text UNIQUE,venta_id uuid UNIQUE,factura_id uuid UNIQUE,evento_id uuid,origen_caja text,payload_hash text);
CREATE TABLE public.siat_9b_importacion_huellas(idempotency_key text PRIMARY KEY,agente_id uuid,factura_id uuid,contenido_sha256 text);
CREATE TABLE public.siat_auditoria(actor_auth_user_id uuid,entidad text,entidad_id text,accion text,contexto jsonb);
CREATE FUNCTION public.siat_importar_factura_offline(text,jsonb) RETURNS uuid LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'IMPORTACION_OFFLINE_CONTRATO_V1_DESHABILITADO'; END $$;
CREATE FUNCTION public.siat_importar_factura_offline_v2(text,jsonb) RETURNS uuid LANGUAGE sql AS $$ SELECT gen_random_uuid() $$;
CREATE FUNCTION public.siat_importar_evento_offline(p_agente text,p_payload jsonb) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE a public.siat_agentes_locales%ROWTYPE; result uuid:=(p_payload->>'id')::uuid;
BEGIN
  SELECT * INTO a FROM public.siat_agentes_locales WHERE codigo=p_agente;
  INSERT INTO public.siat_eventos_significativos(id,agente_local_id,tipo_evento_codigo,fecha_inicio,fecha_fin,cufd_id,sucursal_id,punto_venta_id,descripcion,evidencia_deteccion,actor_auth_user_id,origen)
    VALUES(result,a.id,p_payload->>'tipoEventoCodigo',(p_payload->>'fechaInicio')::timestamptz,(p_payload->>'fechaFin')::timestamptz,(p_payload->>'cufdId')::uuid,a.sucursal_id,a.punto_venta_id,p_payload->>'descripcion',COALESCE(p_payload->'evidencia','{}'::jsonb),NULLIF(p_payload->>'actorAuthUserId','')::uuid,CASE WHEN COALESCE((p_payload->>'automatico')::boolean,false) THEN 'AUTOMATICO' ELSE 'MANUAL_ADMINISTRATIVO' END);
  RETURN result;
END; $$;
\ir ../../supabase/migrations/20261103080000_siat_9b_cafc_venta_existente.sql

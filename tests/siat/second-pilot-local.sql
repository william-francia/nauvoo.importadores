-- Ejecutar solo en una base PostgreSQL local desechable, sin red ni datos reales.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.usuarios (auth_user_id uuid, activo boolean, rol text, nombre text, apellidos text);
CREATE TABLE public.clientes (id uuid, codigo_cliente text, nombre_razon_social text, numero_documento text, tipo_documento text, complemento text, activo boolean, correo text);
CREATE TABLE public.productos (id uuid, codigo_interno text, nombre text, activo boolean);
CREATE TABLE public.siat_piloto_control (id boolean, emision_habilitada boolean, autorizacion_habilitada_id uuid, eku_fiscal_aprobado boolean, eku_alcance text, eku_cert_sha256 text, nit_cliente_verificado boolean, nit_cliente_id uuid, nit_cliente_documento text, nit_ambiente text, nit_codigo_respuesta integer, nit_verificado_at timestamptz, updated_at timestamptz);
CREATE TABLE public.siat_piloto_autorizaciones (id uuid, actor_auth_user_id uuid, cliente_id uuid, producto_id uuid, estado text, expires_at timestamptz, precio_unitario numeric, descuento numeric, confirmed_at timestamptz);
CREATE TABLE public.siat_configuracion (id boolean, ambiente text, nit text, siat_habilitado boolean, modalidad text, version_normativa text, actividad_economica text, documento_sector integer, tipo_factura integer, sucursal_predeterminada_id uuid, punto_venta_predeterminado_id uuid);
CREATE TABLE public.siat_sucursales (id uuid, codigo integer, activo boolean);
CREATE TABLE public.siat_puntos_venta (id uuid, sucursal_id uuid, codigo integer, activo boolean);
CREATE TABLE public.siat_cuis (id uuid, sucursal_id uuid, punto_venta_id uuid, ambiente text, estado text, fecha_expiracion timestamptz, codigo text);
CREATE TABLE public.siat_cufd (id uuid, cuis_id uuid, sucursal_id uuid, punto_venta_id uuid, ambiente text, estado text, fecha_inicio timestamptz, fecha_expiracion timestamptz, codigo text);
CREATE TABLE public.siat_catalogos (id integer, codigo text, estado text, version_normativa text);
CREATE TABLE public.siat_catalogo_items (catalogo_id integer, codigo text, activo boolean, metadatos jsonb, descripcion text);
CREATE TABLE public.siat_metodo_pago_mapeos (codigo_metodo_pago integer, metodo_interno text, version_normativa text);
CREATE TABLE public.facturas_siat (id uuid DEFAULT gen_random_uuid(), venta_id uuid, origen_fiscal text, piloto_autorizacion_id uuid, idempotency_key text, ambiente text, version_especificacion text, modalidad text, documento_sector integer, tipo_factura integer, sucursal_id uuid, punto_venta_id uuid, cuis_id uuid, cufd_id uuid, tipo_emision text, estado_fiscal text, numero_factura bigint, fecha_emision timestamptz, codigo_sucursal integer, codigo_punto_venta integer, cuis text, cufd text, nombre_razon_social text, tipo_documento text, numero_documento text, complemento text, monto_total numeric, cliente_snapshot jsonb, detalle_snapshot jsonb, totales_snapshot jsonb, pago_snapshot jsonb, sucursal_snapshot jsonb, punto_venta_snapshot jsonb, codigo_estado integer, transaccion boolean, mensajes_siat jsonb);
CREATE UNIQUE INDEX ON public.facturas_siat (piloto_autorizacion_id) WHERE piloto_autorizacion_id IS NOT NULL;
CREATE TABLE public.siat_outbox (id uuid DEFAULT gen_random_uuid(), factura_id uuid, tipo_tarea text, payload jsonb, estado text, idempotency_key text, locked_by text, locked_until timestamptz);
CREATE TABLE public.siat_auditoria (entidad text, entidad_id text, accion text, contexto jsonb, actor_auth_user_id uuid, resultado text);
CREATE FUNCTION public.siat_reservar_numero(uuid, uuid, integer, text) RETURNS bigint LANGUAGE sql AS $$ SELECT 2::bigint $$;
\ir ../../supabase/migrations/20261030020000_siat_segundo_piloto_controlado.sql

INSERT INTO usuarios VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true,'administrador','Admin','Prueba');
INSERT INTO clientes VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','CLI-000006','William Benjamin Francia Poma','9204357','CI',NULL,true,NULL);
INSERT INTO productos VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','ph1234','Perno cabeza hexagonal 1/4x2"',true);
INSERT INTO siat_sucursales VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd',0,true);
INSERT INTO siat_configuracion VALUES (true,'PRUEBAS','72229012',false,'ELECTRONICA','SIAT_VIGENTE','4752100',1,1,'dddddddd-dddd-4ddd-8ddd-dddddddddddd',NULL);
INSERT INTO siat_piloto_control VALUES (true,true,'704b7c5b-31ea-4d76-90af-6a6f76c152f8',true,'PRUEBAS',repeat('a',64),false,NULL,NULL,NULL,NULL,NULL,now());
INSERT INTO siat_piloto_autorizaciones VALUES
 ('704b7c5b-31ea-4d76-90af-6a6f76c152f8','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc','CONSUMIDA',now()-interval '1 day',5,0,now()),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc','PREPARADA',now()+interval '1 hour',5,0,NULL);
INSERT INTO facturas_siat (id,origen_fiscal,piloto_autorizacion_id,ambiente,estado_fiscal,codigo_estado,transaccion,mensajes_siat) VALUES
 ('c2279bbb-e851-468b-afe6-8ebf0b436d28','PILOTO','704b7c5b-31ea-4d76-90af-6a6f76c152f8','PRUEBAS','SIN_RESPUESTA',902,false,'[{"codigo":924}]');
INSERT INTO siat_outbox (id,factura_id,estado,payload) VALUES ('e4d9ce8e-1c5c-4a08-94db-f4f50c3a8a0e','c2279bbb-e851-468b-afe6-8ebf0b436d28','CANCELADA','{"reenvioAutomaticoBloqueado":true,"conciliacionCufdVigenteIniciadaAt":"2026-10-30T01:46:00Z"}');
INSERT INTO siat_auditoria (entidad,entidad_id,accion,contexto) VALUES ('facturas_siat','c2279bbb-e851-468b-afe6-8ebf0b436d28','CONCILIACION_CUFD_VIGENTE_UNICA','{"codigoEstado":902,"transaccion":false,"respuesta":{"Envelope":{"Body":{"verificacionEstadoFacturaResponse":{"RespuestaServicioFacturacion":{"mensajesList":{"codigo":"924"}}}}}}}');
INSERT INTO siat_cuis VALUES ('11111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-dddddddddddd',NULL,'PRUEBAS','VIGENTE',now()+interval '1 day','CUIS_TEST');
INSERT INTO siat_cufd VALUES ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-dddddddddddd',NULL,'PRUEBAS','VIGENTE',now()-interval '1 hour',now()+interval '1 day','CUFD_TEST');
INSERT INTO siat_catalogos VALUES (1,'ACTIVIDADES','VIGENTE','SIAT_VIGENTE'),(2,'PRODUCTOS_SERVICIOS','VIGENTE','SIAT_VIGENTE'),(3,'UNIDADES_MEDIDA','VIGENTE','SIAT_VIGENTE'),(4,'METODOS_PAGO','VIGENTE','SIAT_VIGENTE'),(5,'TIPOS_DOCUMENTO','VIGENTE','SIAT_VIGENTE'),(6,'LEYENDAS_FACTURA','VIGENTE','SIAT_VIGENTE');
INSERT INTO siat_catalogo_items VALUES (1,'4752100',true,'{}','actividad'),(2,'1003451',true,'{"codigoActividad":"4752100"}','producto'),(3,'47',true,'{}','pieza'),(4,'1',true,'{}','efectivo'),(5,'1',true,'{}','CI'),(6,'1',true,'{"actividadEconomica":"4752100"}','leyenda');
INSERT INTO siat_metodo_pago_mapeos VALUES (1,'EFECTIVO','SIAT_VIGENTE');
DO $$
DECLARE v_id uuid; v_again uuid;
BEGIN
  IF siat_etapa_segundo_piloto() <> 1 THEN RAISE EXCEPTION '924 no habilita preparacion'; END IF;
  UPDATE siat_outbox SET estado='REINTENTAR' WHERE id='e4d9ce8e-1c5c-4a08-94db-f4f50c3a8a0e';
  IF siat_etapa_segundo_piloto() <> -1 THEN RAISE EXCEPTION 'Outbox activo no bloqueado'; END IF;
  UPDATE siat_outbox SET estado='CANCELADA' WHERE id='e4d9ce8e-1c5c-4a08-94db-f4f50c3a8a0e';
  UPDATE siat_auditoria SET contexto=jsonb_set(contexto,'{respuesta,Envelope,Body,verificacionEstadoFacturaResponse,RespuestaServicioFacturacion,mensajesList,codigo}','"123"');
  IF siat_etapa_segundo_piloto() <> -1 THEN RAISE EXCEPTION 'Falta evidencia 924'; END IF;
  UPDATE siat_auditoria SET contexto=jsonb_set(contexto,'{respuesta,Envelope,Body,verificacionEstadoFacturaResponse,RespuestaServicioFacturacion,mensajesList,codigo}','"924"');
  BEGIN
    PERFORM siat_crear_factura_piloto_outbox('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','');
    RAISE EXCEPTION 'Se omitio la confirmacion';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'PILOTO_CONFIRMACION_REQUERIDA' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM siat_habilitar_autorizacion_piloto('99999999-9999-4999-8999-999999999999','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',repeat('a',64));
    RAISE EXCEPTION 'Se omitio el administrador';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'PILOTO_ADMIN_REQUERIDO' THEN RAISE; END IF;
  END;
  PERFORM siat_habilitar_autorizacion_piloto('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',repeat('a',64));
  v_id := siat_crear_factura_piloto_outbox('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','AUTORIZO EMITIR ESTA UNICA FACTURA EN SIAT PILOTO');
  v_again := siat_crear_factura_piloto_outbox('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','AUTORIZO EMITIR ESTA UNICA FACTURA EN SIAT PILOTO');
  IF v_id <> v_again OR (SELECT count(*) FROM facturas_siat WHERE origen_fiscal='PILOTO') <> 2 THEN RAISE EXCEPTION 'Idempotencia fallida'; END IF;
  IF siat_etapa_segundo_piloto() <> -1 THEN RAISE EXCEPTION 'Tercera factura no bloqueada'; END IF;
  INSERT INTO siat_piloto_autorizaciones VALUES ('ffffffff-ffff-4fff-8fff-ffffffffffff','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc','PREPARADA',now()+interval '1 hour',5,0,NULL);
  BEGIN
    PERFORM siat_habilitar_autorizacion_piloto('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ffffffff-ffff-4fff-8fff-ffffffffffff',repeat('a',64));
    RAISE EXCEPTION 'Tercera habilitacion permitida';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'PILOTO_UNICA_FACTURA_YA_CREADA' THEN RAISE; END IF;
  END;
  IF NOT EXISTS (SELECT 1 FROM siat_outbox WHERE id='e4d9ce8e-1c5c-4a08-94db-f4f50c3a8a0e' AND estado='CANCELADA' AND payload->'reenvioAutomaticoBloqueado'='true'::jsonb) THEN RAISE EXCEPTION 'Outbox anterior alterado'; END IF;
  IF NOT EXISTS (SELECT 1 FROM facturas_siat WHERE id=v_id AND numero_factura=2 AND numero_documento='9204357' AND tipo_documento='CI' AND monto_total=5 AND detalle_snapshot->0->>'precioUnitario'='5') THEN RAISE EXCEPTION 'Datos nuevos incorrectos'; END IF;
END $$;

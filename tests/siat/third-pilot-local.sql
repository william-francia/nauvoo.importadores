-- Solo PostgreSQL sintético local. No conexión al SIN, no datos remotos.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database() !~ '^nuvoo_9a_third_[a-f0-9]{32}$' OR current_setting('data_directory') NOT LIKE '%nuvoo-cafc-pg-task' THEN RAISE EXCEPTION 'Base no autorizada para prueba'; END IF;
 IF EXISTS(SELECT 1 FROM facturas_siat) THEN RAISE EXCEPTION 'La base sintética debe estar vacía'; END IF;
END $$;

INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','third-test@example.invalid','{}');
UPDATE usuarios SET rol='administrador',activo=true WHERE auth_user_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
INSERT INTO clientes(id,codigo_cliente,nombre_razon_social,tipo_documento,numero_documento,activo) VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','CLI-000006','William Benjamin Francia Poma','CI','9204357',true);
INSERT INTO productos(id,codigo_interno,nombre,activo) VALUES('cccccccc-cccc-4ccc-8ccc-cccccccccccc','ph1234','Perno sintético',true);
INSERT INTO siat_sucursales(id,codigo,nombre,activo) VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd',0,'Sucursal sintética',true);
UPDATE siat_configuracion SET ambiente='PRUEBAS',nit='72229012',siat_habilitado=false,modalidad='ELECTRONICA',version_normativa='SIAT_VIGENTE',actividad_economica='4752100',documento_sector=1,tipo_factura=1,sucursal_predeterminada_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd',punto_venta_predeterminado_id=NULL WHERE id=true;
INSERT INTO siat_piloto_autorizaciones(id,actor_auth_user_id,cliente_id,producto_id,preview_hash,precio_unitario,producto_descripcion_snapshot,estado,expires_at,proposito) VALUES
 ('704b7c5b-31ea-4d76-90af-6a6f76c152f8','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc',repeat('1',64),5,'Perno sintético','CONSUMIDA',now()-interval '1 day',NULL),
 ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc',repeat('2',64),5,'Perno sintético','CONSUMIDA',now()-interval '1 day',NULL),
 ('ffffffff-ffff-4fff-8fff-ffffffffffff','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc',repeat('3',64),5,'Perno sintético','PREPARADA',now()+interval '1 hour','ANULACION_9A');
UPDATE siat_piloto_control SET emision_habilitada=true,autorizacion_habilitada_id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',eku_fiscal_aprobado=true,eku_alcance='PRUEBAS',eku_cert_sha256=repeat('a',64),eku_tipo_evidencia='CONFIRMACION_VERBAL_REPORTADA_POR_USUARIO',eku_entidad_confirmadora='SIN_REPORTADO_POR_USUARIO',eku_declaracion_at=now(),eku_aprobado_at=now(),eku_aprobado_por='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',nit_cliente_verificado=false WHERE id=true;
INSERT INTO facturas_siat(id,origen_fiscal,piloto_autorizacion_id,ambiente,modalidad,documento_sector,tipo_factura,sucursal_id,estado_fiscal,numero_factura,codigo_estado,transaccion,codigo_recepcion,cuf,detalle_snapshot) VALUES
 ('c2279bbb-e851-468b-afe6-8ebf0b436d28','PILOTO','704b7c5b-31ea-4d76-90af-6a6f76c152f8','PRUEBAS','ELECTRONICA',1,1,'dddddddd-dddd-4ddd-8ddd-dddddddddddd','SIN_RESPUESTA',1,902,false,NULL,'CUF_SINTETICO_1','[{"descripcion":"Perno sintético"}]'),
 ('08dd889e-f2f7-4acb-be2e-2f911aae9919','PILOTO','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','PRUEBAS','ELECTRONICA',1,1,'dddddddd-dddd-4ddd-8ddd-dddddddddddd','VALIDADA',2,908,true,'RECEPCION_SINTETICA_2','CUF_SINTETICO_2','[{"descripcion":"Perno sintético"}]');
INSERT INTO siat_outbox(id,factura_id,tipo_tarea,estado,payload,idempotency_key) VALUES('e4d9ce8e-1c5c-4a08-94db-f4f50c3a8a0e','c2279bbb-e851-468b-afe6-8ebf0b436d28','EMITIR_FACTURA_ONLINE','CANCELADA','{"reenvioAutomaticoBloqueado":true}','test:old-held');
INSERT INTO siat_cuis(id,sucursal_id,ambiente,estado,fecha_expiracion,codigo) VALUES('11111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-dddddddddddd','PRUEBAS','VIGENTE',now()+interval '1 day','CUIS_TEST');
INSERT INTO siat_cufd(id,cuis_id,sucursal_id,ambiente,estado,fecha_inicio,fecha_expiracion,codigo,codigo_control) VALUES('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','dddddddd-dddd-4ddd-8ddd-dddddddddddd','PRUEBAS','VIGENTE',now()-interval '1 hour',now()+interval '1 day','CUFD_TEST','ABCD');
INSERT INTO siat_secuencias(sucursal_id,documento_sector,tipo_emision,siguiente_numero) VALUES('dddddddd-dddd-4ddd-8ddd-dddddddddddd',1,'ONLINE',3);
UPDATE siat_catalogos SET estado='VIGENTE',version_normativa='SIAT_VIGENTE';
INSERT INTO siat_catalogos(codigo,nombre,version_normativa,estado)
 SELECT code,code,'SIAT_VIGENTE','VIGENTE' FROM unnest(ARRAY['ACTIVIDADES','PRODUCTOS_SERVICIOS','UNIDADES_MEDIDA','METODOS_PAGO','TIPOS_DOCUMENTO','LEYENDAS_FACTURA','MOTIVOS_ANULACION']) AS code
 ON CONFLICT(codigo,version_normativa) DO NOTHING;
INSERT INTO siat_catalogo_items(catalogo_id,codigo,descripcion,activo,metadatos,clave_natural)
 SELECT c.id,x.codigo,x.descripcion,true,x.meta::jsonb,x.codigo FROM siat_catalogos c JOIN (VALUES
 ('ACTIVIDADES','4752100','Actividad','{}'),('PRODUCTOS_SERVICIOS','1003451','Perno','{"codigoActividad":"4752100"}'),('UNIDADES_MEDIDA','47','Pieza','{}'),
 ('METODOS_PAGO','1','Efectivo','{}'),('TIPOS_DOCUMENTO','1','CI','{}'),('LEYENDAS_FACTURA','1','Leyenda sintética','{"actividadEconomica":"4752100"}'),('MOTIVOS_ANULACION','1','FACTURA MAL EMITIDA','{}')
 ) AS x(catalog,codigo,descripcion,meta) ON x.catalog=c.codigo;
INSERT INTO siat_metodo_pago_mapeos(metodo_interno,codigo_metodo_pago,version_normativa) VALUES('EFECTIVO',1,'SIAT_VIGENTE') ON CONFLICT DO NOTHING;

CREATE TABLE test_9a_before AS SELECT id,md5(to_jsonb(f)::text) AS hash FROM facturas_siat f;
DO $$
DECLARE blocked boolean;
BEGIN
 IF siat_etapa_segundo_piloto()<>2 THEN RAISE EXCEPTION 'No habilita la etapa tercera'; END IF;
 IF (SELECT siguiente_numero FROM siat_secuencias WHERE sucursal_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd')<>3 THEN RAISE EXCEPTION 'Preview consumio numeracion'; END IF;
 IF has_function_privilege('authenticated','siat_crear_factura_piloto_outbox(uuid,uuid,text)','EXECUTE') THEN RAISE EXCEPTION 'Permiso inseguro'; END IF;
 BEGIN
  PERFORM siat_habilitar_autorizacion_piloto(gen_random_uuid(),'ffffffff-ffff-4fff-8fff-ffffffffffff',repeat('a',64)); RAISE EXCEPTION 'Permiso omitido';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'PILOTO_ADMIN_REQUERIDO' THEN RAISE; END IF; END;
 BEGIN
  UPDATE siat_piloto_autorizaciones SET proposito=NULL WHERE id='ffffffff-ffff-4fff-8fff-ffffffffffff';
  PERFORM siat_habilitar_autorizacion_piloto('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ffffffff-ffff-4fff-8fff-ffffffffffff',repeat('a',64)); RAISE EXCEPTION 'Acepto autorizacion anterior';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'PILOTO_AUTORIZACION_NO_CORRESPONDE_A_ETAPA' THEN RAISE; END IF; END;
 BEGIN
  UPDATE siat_configuracion SET ambiente='PRODUCCION';
  PERFORM siat_habilitar_autorizacion_piloto('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ffffffff-ffff-4fff-8fff-ffffffffffff',repeat('a',64)); RAISE EXCEPTION 'Acepto produccion';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'PILOTO_CONFIGURACION_INVALIDA' THEN RAISE; END IF; END;
 PERFORM siat_habilitar_autorizacion_piloto('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ffffffff-ffff-4fff-8fff-ffffffffffff',repeat('a',64));
 BEGIN
  UPDATE siat_cufd SET fecha_inicio=now()-interval '2 days',fecha_expiracion=now()-interval '1 day';
  PERFORM siat_crear_factura_piloto_outbox('ffffffff-ffff-4fff-8fff-ffffffffffff','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','AUTORIZO EMITIR ESTA UNICA FACTURA EN SIAT PILOTO'); RAISE EXCEPTION 'Acepto CUFD vencido';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'PILOTO_CUFD_NO_VIGENTE' THEN RAISE; END IF; END;
 blocked:=false;
 BEGIN
  INSERT INTO siat_piloto_autorizaciones(actor_auth_user_id,cliente_id,producto_id,preview_hash,precio_unitario,producto_descripcion_snapshot,proposito) VALUES(gen_random_uuid(),'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','cccccccc-cccc-4ccc-8ccc-cccccccccccc',repeat('4',64),5,'Perno sintético','ANULACION_9A');
 EXCEPTION WHEN unique_violation THEN blocked:=true; END;
 IF NOT blocked THEN RAISE EXCEPTION 'Dos autorizaciones 9A permitidas'; END IF;
 IF (SELECT count(*) FROM facturas_siat)<>2 OR (SELECT siguiente_numero FROM siat_secuencias WHERE sucursal_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd')<>3 THEN RAISE EXCEPTION 'Fallo consumio numero'; END IF;
END $$;

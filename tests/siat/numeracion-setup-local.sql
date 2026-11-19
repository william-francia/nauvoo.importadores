-- Fixture sintético, aplicar solo en la base local aislada de esta prueba.
CREATE SCHEMA extensions;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE siat_configuracion(id boolean PRIMARY KEY,ambiente text,documento_sector integer,siat_habilitado boolean DEFAULT false);
CREATE TABLE siat_sucursales(id uuid PRIMARY KEY,codigo integer UNIQUE NOT NULL);
CREATE TABLE siat_puntos_venta(id uuid PRIMARY KEY,sucursal_id uuid,codigo integer);
CREATE TABLE siat_agentes_locales(id uuid PRIMARY KEY,codigo text UNIQUE,estado text,sucursal_id uuid,punto_venta_id uuid);
CREATE TABLE siat_eventos_significativos(id uuid PRIMARY KEY,agente_local_id uuid,created_at timestamptz DEFAULT now(),estado text,codigo_recepcion text,respuesta_siat jsonb,fecha_fin timestamptz,cafc_id uuid,tipo_evento_codigo text);
CREATE TABLE siat_secuencias(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sucursal_id uuid NOT NULL,punto_venta_id uuid,documento_sector integer NOT NULL,tipo_emision text NOT NULL,siguiente_numero bigint NOT NULL,updated_at timestamptz DEFAULT now(),UNIQUE NULLS NOT DISTINCT(sucursal_id,punto_venta_id,documento_sector,tipo_emision));
CREATE TABLE facturas_siat(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),sucursal_id uuid,punto_venta_id uuid,codigo_sucursal integer NOT NULL,codigo_punto_venta integer NOT NULL,documento_sector integer,numero_factura bigint,ambiente text,tipo_emision text,es_manual_cafc boolean NOT NULL DEFAULT false,cafc_id uuid,numero_manual bigint,agente_local_id uuid,evento_id uuid,estado_fiscal text,codigo_estado integer,transaccion boolean,codigo_recepcion text,UNIQUE NULLS NOT DISTINCT(codigo_sucursal,codigo_punto_venta,documento_sector,tipo_emision,numero_factura));
CREATE TABLE siat_bloques_numeracion_offline(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),agente_id uuid NOT NULL,sucursal_id uuid NOT NULL,punto_venta_id uuid,documento_sector integer NOT NULL,numero_desde bigint NOT NULL,numero_hasta bigint NOT NULL,asignado_at timestamptz DEFAULT now(),UNIQUE(sucursal_id,punto_venta_id,documento_sector,numero_desde),CHECK(numero_hasta>=numero_desde));
CREATE TABLE siat_auditoria(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,entidad text,entidad_id text,accion text,contexto jsonb);
CREATE TABLE siat_9b_cafc_vinculos(factura_id uuid,evento_id uuid);
CREATE TABLE siat_paquetes(id uuid PRIMARY KEY,evento_id uuid,estado text,cantidad_facturas integer,codigo_recepcion text,respuesta_siat jsonb);
CREATE TABLE siat_paquete_facturas(paquete_id uuid,factura_id uuid);
CREATE TABLE siat_outbox(estado text,tipo_tarea text,payload jsonb,factura_id uuid);
CREATE TABLE siat_intentos_envio(evento_id uuid,estado text);
CREATE TABLE siat_agent_nonces(agente_id uuid,nonce text,fecha_solicitud timestamptz,expira_at timestamptz,UNIQUE(agente_id,nonce));
INSERT INTO siat_configuracion(id,ambiente,documento_sector) VALUES(true,'PRUEBAS',1);
-- Históricos sintéticos previos a la migración: CAFC no define el siguiente digital.
INSERT INTO siat_sucursales VALUES ('00000000-0000-4000-8000-000000000091',1999999999);
INSERT INTO siat_agentes_locales VALUES ('00000000-0000-4000-8000-000000000092','TEST-CAFC-HISTORICO','ACTIVO','00000000-0000-4000-8000-000000000091',NULL);
INSERT INTO facturas_siat(codigo_sucursal,codigo_punto_venta,documento_sector,numero_factura,ambiente,tipo_emision,es_manual_cafc,cafc_id,numero_manual)
 SELECT 1999999999,0,1,n,'PRUEBAS','ONLINE',false,NULL,NULL FROM generate_series(1,3) n;
INSERT INTO facturas_siat(codigo_sucursal,codigo_punto_venta,documento_sector,numero_factura,ambiente,tipo_emision,es_manual_cafc,cafc_id,numero_manual)
 SELECT 1999999999,0,1,n,'PRUEBAS','OFFLINE',true,'00000000-0000-4000-8000-000000000093',n FROM unnest(ARRAY[4,1000000]) n;
INSERT INTO siat_sucursales VALUES ('00000000-0000-4000-8000-000000000094',1999999998);
INSERT INTO siat_agentes_locales VALUES ('00000000-0000-4000-8000-000000000095','TEST-CAFC-RANGO','ACTIVO','00000000-0000-4000-8000-000000000094',NULL);
INSERT INTO facturas_siat(codigo_sucursal,codigo_punto_venta,documento_sector,numero_factura,ambiente,tipo_emision,es_manual_cafc)
 SELECT 1999999998,0,1,n,'PRUEBAS','ONLINE',false FROM generate_series(1,3) n;
INSERT INTO facturas_siat(codigo_sucursal,codigo_punto_venta,documento_sector,numero_factura,ambiente,tipo_emision,es_manual_cafc,cafc_id,numero_manual)
 VALUES (1999999998,0,1,5,'PRUEBAS','OFFLINE',true,'00000000-0000-4000-8000-000000000096',5);

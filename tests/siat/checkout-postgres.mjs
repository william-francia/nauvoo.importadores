// PostgreSQL nativo, temporal y sintético. No conecta a Supabase ni a servicios externos.
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

const bin = process.env.PG_BIN ?? 'C:/Program Files/PostgreSQL/18/bin';
const executable = name => join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
const dir = mkdtempSync(join(tmpdir(), 'nuvoo-checkout-synthetic-'));
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const command = (name, args, input) => execFileSync(executable(name), args, { encoding: 'utf8', windowsHide: true, input, stdio: ['pipe', 'pipe', 'pipe'] });
// No heredar pipes al proceso servidor: en Windows impediría que execFileSync finalice.
const control = args => execFileSync(executable('pg_ctl'), args, { windowsHide: true, stdio: 'ignore' });
command('initdb', ['-D', dir, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--no-locale']);
let started = false;
const args = ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'];
const sql = query => command('psql', args, query).trim();
const uid='11111111-1111-4111-8111-111111111111', customer='22222222-2222-4222-8222-222222222222',product='33333333-3333-4333-8333-333333333333',branch='44444444-4444-4444-8444-444444444444',warehouse='55555555-5555-4555-8555-555555555555';
try {
 control(['-D',dir,'-l',join(dir,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']); started=true;
 sql(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA extensions; CREATE SCHEMA auth;
 CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,raw_user_meta_data jsonb);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 GRANT USAGE ON SCHEMA auth,public TO authenticated,service_role;
 CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(bucket_id text,name text);`);
 let base=readFileSync('supabase/migraciones/20260908120000_initial_schema.sql','utf8');
 const pk=[...base.matchAll(/ALTER TABLE public\.[\w]+\s+ADD CONSTRAINT [\w]+ PRIMARY KEY \([^;]+\);/g)].map(m=>m[0]);
 base=base.replace(/ALTER TABLE public\.[\w]+\s+ADD CONSTRAINT [\w]+ PRIMARY KEY \([^;]+\);/g,'');
 const pos=base.indexOf('ALTER TABLE public.'); sql(base.slice(0,pos)+pk.join('\n')+'\n'+base.slice(pos));
 sql(readFileSync('supabase/migraciones/20260908130000_clientes_integracion.sql','utf8'));
 // Solo cadena aplicada y el cambio bajo prueba: no ejecutar fixtures/migraciones ajenas.
 const omit=['20260918175000','20260923120000'];
 for(const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')&&!omit.some(v=>f.startsWith(v))).sort()) {
   try {sql(readFileSync('supabase/migrations/'+file,'utf8'));} catch(e){throw Error(file+': '+e.stderr);}
 }
 sql(`INSERT INTO auth.users(id,email) VALUES('${uid}','synthetic@example.invalid');
 INSERT INTO usuarios(auth_user_id,nombre,apellidos,numero_documento,rol) VALUES('${uid}','Prueba','Sintetica','TEST-CHECKOUT','administrador') ON CONFLICT DO NOTHING;
 UPDATE usuarios SET rol='administrador',activo=true WHERE auth_user_id='${uid}';
 INSERT INTO siat_sucursales(id,codigo,nombre) VALUES('${branch}',999,'SINTETICA');
 INSERT INTO almacenes(id,codigo,nombre) VALUES('${warehouse}','SYNTH-CHECKOUT','SINTETICO');
 INSERT INTO clientes(id,nombre_razon_social,tipo_documento,numero_documento,correo,telefono) VALUES('${customer}','Cliente sintetico','CI','1234567',NULL,NULL);
 UPDATE siat_configuracion SET nit='1234567',codigo_sistema='SINTETICO',razon_social='SINTETICO',actividad_economica='4752100',modalidad='ELECTRONICA',documento_sector=1,tipo_factura=1,sucursal_predeterminada_id='${branch}',siat_habilitado=true;
 INSERT INTO siat_catalogos(codigo,nombre,estado) VALUES('ACTIVIDADES','Actividades','VIGENTE'),('PRODUCTOS_SERVICIOS','Productos','VIGENTE'),('UNIDADES_MEDIDA','Unidades','VIGENTE'),('METODOS_PAGO','Pagos','VIGENTE'),('LEYENDAS_FACTURA','Leyendas','VIGENTE');
 INSERT INTO siat_catalogo_items(catalogo_id,clave_natural,codigo,descripcion,metadatos) SELECT id,codigo,CASE codigo WHEN 'ACTIVIDADES' THEN '4752100' WHEN 'PRODUCTOS_SERVICIOS' THEN 'TEST' WHEN 'UNIDADES_MEDIDA' THEN '47' WHEN 'METODOS_PAGO' THEN '1' ELSE 'LEYENDA-TEST' END,'Sintetico','{"codigoActividad":"4752100","actividadEconomica":"4752100"}' FROM siat_catalogos;
 INSERT INTO productos(id,codigo_interno,nombre,medida) VALUES('${product}','TEST-CHECKOUT','Producto sintetico','PIEZA');
 INSERT INTO stock_por_almacen(producto_id,almacen_id,cantidad_disponible) VALUES('${product}','${warehouse}',10);
 INSERT INTO siat_producto_homologaciones(producto_id,codigo_interno_snapshot,codigo_producto_sin,actividad_economica,unidad_medida_sin,origen,estado) VALUES('${product}','SINTETICO','TEST','4752100','47','IMPORTADO','HOMOLOGADO');
 INSERT INTO siat_metodo_pago_mapeos(metodo_interno,codigo_metodo_pago) VALUES('EFECTIVO',1) ON CONFLICT DO NOTHING;
 INSERT INTO siat_cuis(sucursal_id,ambiente,codigo,fecha_expiracion) VALUES('${branch}','PRUEBAS','SYNTH',now()+interval '1 year');
 INSERT INTO siat_cufd(sucursal_id,cuis_id,ambiente,codigo,codigo_control,fecha_inicio,fecha_expiracion) SELECT '${branch}',id,'PRUEBAS','SYNTH','ABCD',now()-interval '1 hour',now()+interval '1 day' FROM siat_cuis;`);
 const venta={cliente_id:customer,metodo_pago:'EFECTIVO',tarjeta_ofuscada:null,observacion:'SINTETICA',descuento_venta:0,items:[{producto_id:product,almacen_id:warehouse,cantidad:1,precio_unitario:5,descuento:0}]};
 const delivery={canal:'NINGUNO',destinatario:'',consentimiento:false};
 const call=(id,v=venta)=>`SET request.jwt.claim.sub='${uid}'; SET ROLE authenticated; SELECT registrar_venta_checkout('${id}','${JSON.stringify(v)}','${JSON.stringify(delivery)}');`;
 const id='66666666-6666-4666-8666-666666666666';
 const run=promisify(execFile);
 const results=await Promise.all([run(executable('psql'),[...args,'-c',call(id)]),run(executable('psql'),[...args,'-c',call(id)])]);
 assert(results.every(r=>r.stdout.includes('facturaId')));
 assert.equal(sql('SELECT count(*) FROM ventas'),'1'); assert.equal(sql('SELECT count(*) FROM facturas_siat'),'1');
 assert.equal(sql('SELECT count(*) FROM movimientos_inventario'),'1');
 assert.equal(Number(sql('SELECT cantidad_disponible FROM stock_por_almacen WHERE producto_id=\''+product+'\'')),9);
 assert.equal(sql("SELECT count(*) FROM siat_outbox WHERE tipo_tarea='EMITIR_FACTURA_ONLINE'"),'1');
 assert.throws(()=>sql(call(id,{...venta,descuento_venta:1})));
 assert(sql(call(id)).includes('true'));
 sql(`UPDATE siat_producto_homologaciones SET estado='PENDIENTE' WHERE producto_id='${product}'`);
 assert.throws(()=>sql(call('77777777-7777-4777-8777-777777777777')));
 assert.equal(sql('SELECT count(*) FROM ventas'),'1');
 assert.equal(sql("SELECT has_table_privilege('authenticated','siat_checkout_ventas','INSERT')"),'f');
 assert.throws(()=>sql(`SET ROLE anon; SELECT registrar_venta_checkout('${id}','{}','{}');`));
 console.log('Checkout SQL aprobado: cadena real, cliente sin contactos, venta/factura vinculadas, concurrencia, un movimiento, stock una vez, reintento, rechazo y permisos.');
} finally { if(started)control(['-D',dir,'-m','fast','-w','stop']); }

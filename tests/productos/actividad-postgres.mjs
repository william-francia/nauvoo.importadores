// Clúster nativo temporal con datos sintéticos; nunca conecta a Supabase.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
const bin='C:/Program Files/PostgreSQL/18/bin';
const dir=mkdtempSync(join(tmpdir(),'nuvoo-product-activity-'));
const server=createServer(); await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port; await new Promise(r=>server.close(r));
const run=(name,args,input)=>execFileSync(join(bin,name+'.exe'),args,{input,encoding:'utf8',windowsHide:true,stdio:input===undefined?'ignore':['pipe','pipe','pipe']});
const sql=query=>run('psql',['-X','-h','127.0.0.1','-p',String(port),'-U','postgres','-d','postgres','-qAt','-v','ON_ERROR_STOP=1'],query).trim();
run('initdb',['-D',dir,'-U','postgres','-A','trust','--encoding=UTF8','--no-locale']);
run('pg_ctl',['-D',dir,'-l',join(dir,'server.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
try {
  sql(`CREATE TABLE productos(id int PRIMARY KEY,nombre text); INSERT INTO productos VALUES(1,'historico');
    CREATE TABLE siat_catalogos(id int,codigo text,estado text,version_normativa text);
    CREATE TABLE siat_catalogo_items(catalogo_id int,codigo text,activo boolean);
    CREATE TABLE siat_producto_homologaciones(producto_id int,actividad_economica text,codigo_producto_sin text);
    INSERT INTO siat_catalogos VALUES(1,'ACTIVIDADES','VIGENTE','SIAT_VIGENTE');
    INSERT INTO siat_catalogo_items VALUES(1,'4752100',true);`);
  sql(readFileSync(new URL('../../supabase/migrations/20261125010000_producto_actividad_economica.sql',import.meta.url),'utf8'));
  assert.equal(sql('SELECT actividad_economica IS NULL FROM productos WHERE id=1'),'t');
  sql("INSERT INTO productos(id,nombre,actividad_economica) VALUES(2,'nuevo','999')");
  assert.equal(sql('SELECT actividad_economica FROM productos WHERE id=2'),'4752100');
  assert.throws(()=>sql("UPDATE productos SET actividad_economica='999' WHERE id=2"));
  sql("UPDATE productos SET nombre='editado' WHERE id=2");
  assert.equal(sql('SELECT actividad_economica FROM productos WHERE id=2'),'4752100');
  assert.equal(sql('SELECT count(*) FROM siat_producto_homologaciones'),'0');
  assert.throws(()=>sql("INSERT INTO siat_producto_homologaciones VALUES(2,'475200','TEST')"));
  sql("INSERT INTO siat_producto_homologaciones VALUES(2,'4752100','TEST')");
  sql('UPDATE siat_catalogo_items SET activo=false');
  assert.throws(()=>sql("INSERT INTO productos(id,nombre) VALUES(3,'rechazado')"));
  assert.equal(sql('SELECT count(*) FROM productos'),'2');
  console.log('SQL aprobado: persistencia, edición, protección backend, catálogo vigente, legado intacto y coherencia con homologación.');
} finally {run('pg_ctl',['-D',dir,'-m','fast','-w','stop']);}

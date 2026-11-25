// PostgreSQL nativo, temporal y sintético. No conecta a Supabase ni a servicios externos.
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

const bin = process.env.PG_BIN ?? 'C:/Program Files/PostgreSQL/18/bin';
const executable = name => join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
const dir = mkdtempSync(join(tmpdir(), 'nuvoo-email-synthetic-'));
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
const admin = '11111111-1111-4111-8111-111111111111', seller = '22222222-2222-4222-8222-222222222222';
const factura = '33333333-3333-4333-8333-333333333333', attempt = '44444444-4444-4444-8444-444444444444';
const claim = (id = attempt, actor = admin, hash = 'A', confirm = 'true') => `SELECT siat_reservar_correo_documento('${id}','${factura}','${actor}',repeat('${hash}',64),'b***@example.invalid',${confirm});`;
const asService = query => `SET ROLE service_role; ${query}`;
try {
  control(['-D', dir, '-l', join(dir, 'server.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
  started = true;
  assert.equal(sql('SHOW data_directory').replaceAll('\\', '/'), dir.replaceAll('\\', '/'));
  sql(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role,anon;
    CREATE TABLE usuarios(auth_user_id uuid PRIMARY KEY, activo boolean NOT NULL, rol text NOT NULL);
    GRANT SELECT ON usuarios TO authenticated;
    CREATE TABLE facturas_siat(id uuid PRIMARY KEY, ambiente text, estado_fiscal text, codigo_estado integer, transaccion boolean, codigo_recepcion text, xml_firmado boolean, xml_storage_path text, xml_hash text);
    CREATE TABLE siat_auditoria(id bigint GENERATED ALWAYS AS IDENTITY,actor_auth_user_id uuid,entidad text,entidad_id text,accion text,contexto jsonb);
    INSERT INTO auth.users VALUES('${admin}'),('${seller}');
    INSERT INTO usuarios VALUES('${admin}',true,'administrador'),('${seller}',true,'vendedor');
    INSERT INTO facturas_siat VALUES('${factura}','PRUEBAS','VALIDADA',908,true,'SYNTHETIC',true,'synthetic.xml.gz',repeat('A',64));
  `);
  sql(readFileSync(new URL('../../supabase/migrations/20261124010000_siat_entrega_correo_factura.sql', import.meta.url), 'utf8'));
  const before = sql('SELECT md5(row_to_json(f)::text) FROM facturas_siat f');
  assert.throws(() => sql(`SET ROLE authenticated; ${claim()}`), /permission denied/);
  assert.throws(() => sql(asService(claim(attempt, seller))), /Administrador/);
  assert.throws(() => sql(asService(claim(attempt, admin, 'A', 'false'))), /Administrador/);
  const parallel = await Promise.all([1, 2].map(() => promisify(execFile)(executable('psql'), [...args, '-c', asService(claim())], { encoding: 'utf8', windowsHide: true })));
  const results = parallel.map(result => JSON.parse(result.stdout.trim()));
  assert.equal(results.filter(result => result.claimed).length, 1);
  assert.equal(sql('SELECT count(*) FROM siat_documento_correos'), '1');
  assert.throws(() => sql(asService(claim(attempt, admin, 'B'))), /Idempotencia/);
  assert.throws(() => sql(asService(claim('55555555-5555-4555-8555-555555555555'))), /previo pendiente/);
  assert.equal(sql(asService(`SELECT siat_finalizar_correo_documento('${attempt}','${admin}','ENVIADA',repeat('B',64));`)), 'ENVIADA');
  assert.equal(JSON.parse(sql(asService(claim()))).estado, 'ENVIADA');
  assert.equal(sql(asService(`SELECT siat_finalizar_correo_documento('${attempt}','${admin}','INCIERTA',null);`)), 'ENVIADA');
  assert.equal(sql(`SET ROLE authenticated; SET request.jwt.claim.sub='${seller}'; SELECT count(*) FROM siat_documento_correos;`), '0');
  assert.equal(sql(`SET ROLE authenticated; SET request.jwt.claim.sub='${admin}'; SELECT count(*) FROM siat_documento_correos;`), '1');
  assert.throws(() => sql(`SET ROLE authenticated; DELETE FROM siat_documento_correos;`), /permission denied/);
  const uncertain = '66666666-6666-4666-8666-666666666666';
  assert.equal(JSON.parse(sql(asService(claim(uncertain, admin, 'C')))).claimed, true);
  sql(asService(`SELECT siat_finalizar_correo_documento('${uncertain}','${admin}','INCIERTA',null);`));
  assert.throws(() => sql(asService(claim('77777777-7777-4777-8777-777777777777', admin, 'C'))), /previo pendiente/);
  assert.throws(() => sql(asService(`SELECT siat_finalizar_correo_documento('${uncertain}','${admin}','ENVIADA',repeat('C',64));`)), /revisión administrativa/);
  assert.equal(sql('SELECT count(*) FROM siat_auditoria'), '4');
  assert.equal(sql('SELECT md5(row_to_json(f)::text) FROM facturas_siat f'), before);
  console.log('SQL local aprobado: migración, permisos/RLS, concurrencia, idempotencia, incertidumbre, auditoría; factura sintética intacta.');
} finally {
  if (started) control(['-D', dir, '-m', 'fast', '-w', 'stop']);
  console.log('Clúster temporal detenido; solo datos sintéticos en ' + dir);
}

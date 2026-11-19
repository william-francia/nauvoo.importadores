// Solo el clúster local sintético existente; no red externa ni SIN.
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
const database=process.env.NUVOO_THIRD_TEST_DB??'';
if(!/^nuvoo_9a_third_[a-f0-9]{32}$/.test(database))throw Error('Base no autorizada');
const bin='C:/Program Files/PostgreSQL/18/bin/psql.exe';
const args=['-h','127.0.0.1','-p','55449','-U','postgres','-d',database,'-X','-qAt','-v','ON_ERROR_STOP=1','-c'];
const query=sql=>execFileSync(bin,[...args,sql],{encoding:'utf8'}).trim();
if(!query('SHOW data_directory').replaceAll('\\','/').endsWith('/Temp/nuvoo-cafc-pg-task'))throw Error('Cluster distinto');
const create="SELECT siat_crear_factura_piloto_outbox('ffffffff-ffff-4fff-8fff-ffffffffffff','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','AUTORIZO EMITIR ESTA UNICA FACTURA EN SIAT PILOTO')";
const result=await Promise.all([promisify(execFile)(bin,[...args,create]),promisify(execFile)(bin,[...args,create])]);
if(result[0].stdout.trim()!==result[1].stdout.trim() || query(create)!==result[0].stdout.trim())throw Error('Idempotencia fallida');
const state=JSON.parse(query(`SELECT json_build_object(
 'count',(SELECT count(*) FROM facturas_siat),'next',(SELECT siguiente_numero FROM siat_secuencias WHERE sucursal_id='dddddddd-dddd-4ddd-8ddd-dddddddddddd'),
 'old_intact',(SELECT bool_and(md5(to_jsonb(f)::text)=b.hash) FROM facturas_siat f JOIN test_9a_before b USING(id)),
 'new_correct',EXISTS(SELECT 1 FROM facturas_siat WHERE piloto_autorizacion_id='ffffffff-ffff-4fff-8fff-ffffffffffff' AND numero_factura=3 AND cuf IS NULL AND xml_documento IS NULL AND venta_id IS NULL AND monto_total=5 AND estado_fiscal='EN_COLA' AND fecha_emision>now()-interval '5 minutes'),
 'jobs',(SELECT count(*) FROM siat_outbox WHERE factura_id='${result[0].stdout.trim()}'::uuid),'stage',siat_etapa_segundo_piloto(),
 'sales',(SELECT count(*) FROM ventas),'inventory',(SELECT count(*) FROM movimientos_inventario))`));
if(state.count!==3 || state.next!==4 || !state.old_intact || !state.new_correct || state.jobs!==1 || state.stage!==-1 || state.sales!==0 || state.inventory!==0)throw Error('Persistencia incorrecta: '+JSON.stringify(state));
query(`DO $$ BEGIN
 BEGIN
  PERFORM siat_habilitar_autorizacion_piloto('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','ffffffff-ffff-4fff-8fff-ffffffffffff',repeat('a',64));
  RAISE EXCEPTION 'Rehabilito autorizacion consumida';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'PILOTO_AUTORIZACION_INVALIDA' THEN RAISE; END IF; END;
END $$`);
console.log('SQL local: permisos, propósito, CUFD vencido, rollback, autorización única, concurrencia e idempotencia aprobados; 3 facturas sintéticas, 0 ventas y 0 movimientos.');

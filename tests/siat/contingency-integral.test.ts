import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { AgentStore } from '../../agent-local/src/store.ts';
import { LocalAgentApp } from '../../agent-local/src/app.ts';
import type { AgentConfig } from '../../agent-local/src/config.ts';
import type { BootstrapBundle } from '../../agent-local/src/types.ts';
import { SiatEngine } from '../../supabase/functions/_shared/siat/engine.ts';
import type { SiatRepository } from '../../supabase/functions/_shared/siat/repository.ts';
import type { SiatAdapter } from '../../supabase/functions/_shared/siat/types.ts';
import { validateElectronicInvoiceXml } from '../../supabase/functions/_shared/siat/xsd.ts';
import { xsdSiat } from '../../supabase/functions/_shared/siat/xsd-embebidos.ts';
import { verifyInvoiceSignature } from '../../supabase/functions/_shared/siat/xmldsig.ts';
import { SyntheticContingencySin } from '../fixtures/siat-contingency-simulator.ts';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
// Motor, agente, SQLite cifrado, XMLDSig, XSD, GZIP y TAR reales.
// Solo se simulan transporte SIN y persistencia remota (SQL se prueba por separado).
describe('circuito integral digital 9B sin red', () => {
 it('corte → firma → reinicio → CUFD → evento → 901/904 → conciliación 908 sin duplicados', async () => {
  const dir=mkdtempSync(join(tmpdir(),'nuvoo-9b-digital-'));
  execFileSync('C:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=Test 9B','-keyout',join(dir,'test-key.pem'),'-out',join(dir,'test-cert.pem')],{stdio:'ignore',env:{SystemRoot:process.env.SystemRoot,TEMP:tmpdir(),MSYS2_ARG_CONV_EXCL:'*'}});
  vi.stubEnv('SIAT_PRIVATE_KEY_PEM',readFileSync(join(dir,'test-key.pem'),'utf8')); vi.stubEnv('SIAT_CERTIFICATE_PEM',readFileSync(join(dir,'test-cert.pem'),'utf8'));
  vi.stubEnv('SIAT_CONTINGENCIA_PILOTO_HABILITADA','true'); vi.stubEnv('SIAT_CONTINGENCIA_AMBIENTE','PRUEBAS');
  vi.stubEnv('SIAT_AGENT_RESERVA_CANTIDAD','3');
  const config:AgentConfig={dataDir:dir,storageSecret:'synthetic-storage-key-not-real-00000',sharedSecret:'synthetic-agent-secret-not-real-0000',agentCode:'SYNTHETIC',host:'127.0.0.1',port:4737,ingestUrl:'https://synthetic.invalid/ingest',supabaseUrl:'https://synthetic.invalid',supabaseAnonKey:'synthetic',allowedOrigins:new Set(),sessionHours:1,version:'2',defaultEventCode:'1'};
  const scope={ambiente:'PRUEBAS',sucursal_id:'branch',punto_venta_id:null,estado:'VIGENTE'};
  const old={...scope,id:'old',cuis_id:'cuis',codigo:'CUFD-SYNTHETIC-OLD',codigo_control:'ABCD',direccion:'Direccion sintetica',fecha_inicio:new Date(Date.now()-3600000).toISOString(),fecha_expiracion:new Date(Date.now()+86400000).toISOString()};
  let current:Record<string,unknown>=old;
  const cuis={...scope,id:'cuis',codigo:'CUIS-SYNTHETIC',fecha_expiracion:new Date(Date.now()+86400000).toISOString()};
  const fiscal={ambiente:'PRUEBAS',siat_habilitado:false,version_normativa:'SIAT_VIGENTE',nit:'123456789',codigo_sistema:'TEST',razon_social:'Emisor sintetico',municipio:'La Paz',modalidad:'ELECTRONICA',documento_sector:1,tipo_factura:1};
  const bundle:BootstrapBundle={config:fiscal,branch:{id:'branch',codigo:0},point:null,cuis,cufd:old,products:[{id:'p',codigo_interno:'P',nombre:'Perno sintetico'}],homologations:[{producto_id:'p',estado:'HOMOLOGADO',actividad_economica:'4752100',codigo_producto_sin:'1003451',unidad_medida_sin:'47'}],stocks:[{producto_id:'p',almacen_id:'a',cantidad_disponible:10}],warehouses:[{id:'a'}],clients:[{id:'c',nombre_razon_social:'Cliente sintetico',tipo_documento:'CI',numero_documento:'12345',codigo_cliente:'TEST'}],payments:[{metodo_interno:'EFECTIVO',codigo_metodo_pago:1}],legends:[{descripcion:'Leyenda sintetica'}],cafc:[],rules:[{codigo:'REVERIFICACION_OFFLINE_MINUTOS',valor:0.000001}],numberBlock:{numero_desde:10,numero_hasta:12},generatedAt:new Date().toISOString()};
  let store=new AgentStore(config); await store.init();
  let online=true, lostImportReply=true;
  const events=new Map<string,Record<string,unknown>>(), invoices=new Map<string,Record<string,unknown>>(), packages=new Map<string,Record<string,unknown>>(), artifacts=new Map<string,Uint8Array>();
  const jobs:Array<Record<string,unknown>>=[]; const keys=new Set<string>(); const saleIds:string[]=[]; let sales=0,inventory=0, sending=false, reservationReleased=false;
  const enqueue=async(facturaId:string|null,type:string,key:string,payload:unknown)=>{if(keys.has(key))return;keys.add(key);jobs.push({id:crypto.randomUUID(),factura_id:facturaId,tipo_tarea:type,payload,estado:'PENDIENTE'});};
  const repo={
   configuration:async()=>fiscal,branch:async()=>({codigo:0,activo:true}),point:async()=>null,
   event:async(id:string)=>events.get(id)!,invoice:async(id:string)=>invoices.get(id)!,package:async(id:string)=>packages.get(id)!,cufd:async()=>old,
   activeFiscalCodes:async()=>({cuis,cufd:current}),
   activeCuisForScope:async()=>cuis,
   saveCufd:async(_c:unknown,_id:string,r:Record<string,unknown>)=>{current={...old,id:'new',codigo:r.codigo,fecha_inicio:new Date().toISOString()};return 'new';},
   markRecoveryCufdStarted:async(id:string)=>{const job=jobs.find(x=>x.id===id)!; if(job.renewal)return false;job.renewal=true;return true;},
   markFiscalMutationStarted:async(job:Record<string,unknown>)=>{if(job.started)return false;job.started=true;return true;},
   updateEvent:async(id:string,v:unknown)=>{Object.assign(events.get(id)!,v);},updatePackage:async(id:string,v:unknown)=>{Object.assign(packages.get(id)!,v);},
   updateInvoiceIfState:async(id:string,expected:string,v:unknown)=>{const inv=invoices.get(id)!;if(inv.estado_fiscal!==expected)return false;Object.assign(inv,v);return true;},
   offlineInvoices:async(id:string)=>[...invoices.values()].filter(x=>x.evento_id===id&&x.estado_fiscal==='OFFLINE'),
   store:async(path:string,bytes:Uint8Array)=>{artifacts.set(path,bytes);},download:async(path:string)=>artifacts.get(path)!,
   createPackage:async(eventId:string,ids:string[],hash:string,path:string)=>{const id='package'; if(packages.has(id))return id;packages.set(id,{id,evento_id:eventId,sucursal_id:'branch',cufd_evento_id:'old',documento_sector:1,cantidad_facturas:ids.length,archivo_hash:hash,storage_path:path}); for(const id of ids)invoices.get(id)!.estado_fiscal='EMPAQUETADA';await enqueue(null,'ENVIAR_PAQUETE','send:'+id,{paqueteId:id});return id;},
   packageInvoices:async()=>[...invoices.values()].map((factura,i)=>({posicion:i+1,factura})),
   refreshEventFromPackages:async(id:string)=>{events.get(id)!.estado=[...invoices.values()].every(x=>x.estado_fiscal==='VALIDADA')?'VALIDADO':'OBSERVADO';},
   completeJob:async(id:string)=>{jobs.find(x=>x.id===id)!.estado='COMPLETADA';},audit:async()=>{},auditEntity:async()=>{},enqueue,
  };
  const simulator=new SyntheticContingencySin();
  const sin={solicitarCufd:vi.spyOn(simulator,'solicitarCufd'),registrarEvento:vi.spyOn(simulator,'registrarEvento'),recepcionarPaquete:vi.spyOn(simulator,'recepcionarPaquete'),validarPaquete:vi.spyOn(simulator,'validarPaquete'),verificarFactura:vi.spyOn(simulator,'verificarFactura')};
  const engine=new SiatEngine(repo as unknown as SiatRepository,sin as unknown as SiatAdapter,{},async n=>xsdSiat(n),undefined,true);
  const drain=async()=>{if(sending)return;sending=true;try{for(const job of jobs){if(job.estado==='PENDIENTE'){job.estado='PROCESANDO';await engine.process(job);}}}finally{sending=false;}};
  vi.stubGlobal('fetch',async(url:string,init?:RequestInit)=>{
   if(!online) throw new TypeError('Simulated network loss');
   if(url==='https://siatinfo.impuestos.gob.bo/')return new Response(null,{status:200});
   if(url!==config.ingestUrl)throw new Error('EXTERNAL NETWORK FORBIDDEN');
   const b=JSON.parse(String(init!.body)); expect(b.contrato).toBe(2);
   if(b.action==='probe')return Response.json({siatOnline:true});
   if(b.action==='bootstrap'){ if(b.reserveNumbers){expect(b.reserveCount).toBe(3);return Response.json(bundle);} return Response.json({...bundle,cufd:current,numberBlock:null,stocks:[{producto_id:'p',almacen_id:'a',cantidad_disponible:9}]}); }
   if(b.action==='import-event'){const e=b.evento;if(!events.has(e.id))events.set(e.id,{id:e.id,tipo_evento_codigo:e.tipoEventoCodigo,descripcion:e.descripcion,fecha_inicio:e.fechaInicio,fecha_fin:e.fechaFin,cufd_id:e.cufdId,sucursal_id:'branch',evidencia_deteccion:e.evidencia}); return Response.json({eventoId:e.id});}
   if(b.action==='import-invoice'){
    const f=b.factura,bytes=Buffer.from(b.xmlGzipBase64,'base64'); const xml=gunzipSync(bytes).toString();validateElectronicInvoiceXml(xml,xsdSiat('facturaElectronicaCompraVenta.xsd'),xsdSiat('SignatureSchema.xsd'));
    saleIds.push(f.ventaId);
    if(!invoices.has(f.facturaId)){sales++;inventory++;invoices.set(f.facturaId,{...f,id:f.facturaId,ambiente:'PRUEBAS',estado_fiscal:'OFFLINE',codigo_sucursal:0,sucursal_id:'branch',cufd_id:'old',cufd:old.codigo,cuis:cuis.codigo,tipo_factura:1,documento_sector:1,fecha_emision:f.fechaEmision,evento_id:f.eventoId,xml_storage_path:'xml',xml_hash:f.xmlHash,modalidad:'ELECTRONICA'});artifacts.set('xml',bytes);}
    if(lostImportReply){lostImportReply=false;throw new TypeError('Response lost after persistence');} return Response.json({facturaId:f.facturaId});
   }
   if(b.action==='finalize-event'){await enqueue(null,'REGISTRAR_EVENTO','register:'+b.eventoId,{eventoId:b.eventoId});await drain();return Response.json({estado:'EN_COLA'});}
   if(b.action==='recovery-status'){await drain();return Response.json({eventoId:b.eventoId,confirmada:events.get(b.eventoId)?.estado==='VALIDADO'&&jobs.every(x=>x.estado==='COMPLETADA')});}
   if(b.action==='release-reservation') { expect(events.get(b.eventoId)?.estado).toBe('VALIDADO'); expect([...invoices.values()].every(x=>x.estado_fiscal==='VALIDADA')).toBe(true); expect(b.siguiente).toBe(11); reservationReleased=true; return Response.json({estado:'CONCILIADA',desde:b.desde,hasta:b.hasta}); }
   throw new Error('Unexpected action');
  });
  const session={id:'s',userId:crypto.randomUUID(),userName:'Admin sintetico',role:'administrador',expiresAt:new Date(Date.now()+3600000).toISOString()};
  let app=new LocalAgentApp(config,store); await app.bootstrap(session); expect(store.hasOfflineNumber()).toBe(true); await app.checkConnectivity();expect(app.machine.state).toBe('ONLINE');
  online=false;for(let i=0;i<3;i++)await app.checkConnectivity(); expect(app.machine.state).toBe('OFFLINE');expect(store.activeEvent()?.tipoEventoCodigo).toBe('1');
  const sale={idempotencyKey:'synthetic-sale-0000000001',cajaId:'TEST',clienteId:'c',metodoPago:'EFECTIVO',tarjetaOfuscada:null,descuentoAdicional:0,items:[{productoId:'p',almacenId:'a',cantidad:1,precioUnitario:5,descuento:0}]};
  const [a,b]=await Promise.all([app.issuer.issue(sale,session),app.issuer.issue(sale,session)]);expect(a.id).toBe(b.id);expect(a.numeroFactura).toBe(10);expect(verifyInvoiceSignature(app.document(a.id,'XML').toString(),process.env.SIAT_CERTIFICATE_PEM!)).toBe(true);
  await expect(app.issuer.issue({...sale,items:[{...sale.items[0],precioUnitario:6}]},session)).rejects.toThrow('datos no coinciden');
  store=new AgentStore(config);await store.init();app=new LocalAgentApp(config,store);expect(store.pendingCount()).toBe(1);online=true;
  await app.checkConnectivity();expect(store.pendingCount()).toBe(1);expect(app.machine.state).toBe('OFFLINE');
  // Avanzar únicamente el backoff local; no repetir la emisión ni el evento.
  const now=Date.now();const clock=vi.spyOn(Date,'now').mockReturnValue(now+60000);
  // pendingInvoices usa new Date: marcar el reintento como disponible mediante el reloj simulado.
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now+60000);clock.mockRestore();
  try{await app.checkConnectivity();await Promise.all([app.confirmRemoteRecovery(),app.confirmRemoteRecovery()]);}finally{vi.useRealTimers();}
  expect(app.machine.state).toBe('ONLINE');expect(store.listInvoices()).toHaveLength(1);expect(sales).toBe(1);expect(inventory).toBe(1);
  expect(reservationReleased).toBe(true); expect(store.hasOfflineNumber()).toBe(false);
  expect(saleIds).toHaveLength(2);expect(new Set(saleIds).size).toBe(1);expect(saleIds[0]).toBe((a.snapshot.local as {ventaId:string}).ventaId);
  expect(sin.solicitarCufd).toHaveBeenCalledOnce();expect(sin.registrarEvento).toHaveBeenCalledOnce();expect(sin.recepcionarPaquete).toHaveBeenCalledOnce();expect(sin.verificarFactura).toHaveBeenCalledOnce();
  expect(gunzipSync(sin.recepcionarPaquete.mock.calls[0][0].archivo).toString()).toContain('<Signature');
  expect([...invoices.values()][0].estado_fiscal).toBe('VALIDADA');expect(jobs.every(x=>x.estado==='COMPLETADA')).toBe(true);
  expect(readFileSync(join(dir,'agent.sqlite.enc'),'utf8')).not.toContain('Cliente sintetico');
 },60000);
});

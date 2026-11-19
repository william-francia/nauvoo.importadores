// Solo la base sintética creada para esta prueba; nunca utiliza Supabase.
import { execFileSync, spawn } from "node:child_process";
import { randomInt, randomUUID } from "node:crypto";
const exe = "C:/Program Files/PostgreSQL/18/bin/psql.exe";
const args = ["-h", "127.0.0.1", "-p", "55479", "-U", "postgres", "-d", "nuvoo_numeracion_v12_test", "-v", "ON_ERROR_STOP=1", "-qAt"];
const query = sql => execFileSync(exe, [...args, "-c", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
if (!/\/nuvoo-numero-prueba-[0-9a-f]{32}$/i.test(query("SHOW data_directory"))) throw Error("PostgreSQL no es el entorno sintético esperado");
if (query("SELECT has_function_privilege('authenticated','public.siat_9b_conciliar_reserva(text,bigint,bigint,bigint,uuid)','EXECUTE')") !== 'f') throw Error('Usuario no autorizado puede cerrar reservas');
if (query("SELECT has_function_privilege('service_role','public.siat_9b_conciliar_reserva(text,bigint,bigint,bigint,uuid)','EXECUTE')") !== 't') throw Error('Edge no tiene permiso para cierre controlado');
for (const id of ['c2279bbb-e851-468b-afe6-8ebf0b436d28','08dd889e-f2f7-4acb-be2e-2f911aae9919','8c5c0f1d-efd5-492f-ad26-3013f33cc3fe']) {
  let protectedId = false; try { query(`INSERT INTO siat_9b_cafc_vinculos(factura_id) VALUES ('${id}')`); } catch (error) { protectedId = String(error.stderr).includes('CAFC_FACTURA_PILOTO_PROTEGIDA'); }
  if (!protectedId) throw Error('Factura piloto sin protección en CAFC');
}
const run = sql => new Promise((resolve, reject) => {
  const child = spawn(exe, [...args, "-c", sql]); let out = "", error = "";
  child.stdout.on("data", data => out += data); child.stderr.on("data", data => error += data);
  child.on("close", code => code ? reject(Error(error)) : resolve(out.trim()));
});
const branch = randomUUID(), branchCode = randomInt(1, 1000000000), agent = randomUUID(), agent2 = randomUUID(), agent5 = randomUUID(), code = `TEST-${agent}`;
query(`INSERT INTO siat_sucursales(id,codigo) VALUES ('${branch}',${branchCode});
  INSERT INTO siat_agentes_locales VALUES ('${agent}','${code}','ACTIVO','${branch}',null),('${agent2}','TEST-${agent2}','ACTIVO','${branch}',null),('${agent5}','TEST-${agent5}','ACTIVO','${branch}',null);
  INSERT INTO siat_secuencias(sucursal_id,punto_venta_id,documento_sector,tipo_emision,siguiente_numero) VALUES ('${branch}',null,1,'ONLINE',4);
  INSERT INTO facturas_siat(sucursal_id,punto_venta_id,codigo_sucursal,codigo_punto_venta,documento_sector,numero_factura,ambiente,tipo_emision) SELECT CASE WHEN n=3 THEN null ELSE '${branch}'::uuid END,null,${branchCode},0,1,n,'PRUEBAS','ONLINE' FROM generate_series(1,3)n`);
const probeNonce=`9bprobe_${randomUUID().replaceAll('-','')}`;
if (query("SELECT has_function_privilege('authenticated','public.siat_9b_verificar_nonce_prueba(uuid,text)','EXECUTE')")!=='f') throw Error('Sonda accesible sin service_role');
if (query(`SELECT (siat_9b_verificar_nonce_prueba('${agent}','${probeNonce}')->>'persistido')`) !== 'false') throw Error('Sonda confirmó nonce inexistente');
query(`INSERT INTO siat_agent_nonces VALUES ('${agent}','${probeNonce}',now(),now()+interval '10 minutes')`);
if (query(`SELECT (siat_9b_verificar_nonce_prueba('${agent}','${probeNonce}')->>'persistido')`) !== 'true') throw Error('Sonda no confirmó persistencia');
if (query(`SELECT (siat_9b_verificar_nonce_prueba('${agent2}','${probeNonce}')->>'persistido')`) !== 'false') throw Error('Sonda aceptó nonce de otro agente');
let probeProductionBlocked=false; try { query(`BEGIN; UPDATE siat_configuracion SET ambiente='PRODUCCION'; SELECT siat_9b_verificar_nonce_prueba('${agent}','${probeNonce}'); ROLLBACK`); } catch { probeProductionBlocked=true; }
if (!probeProductionBlocked) throw Error('Sonda permitió producción');
let probeEnabledBlocked=false; try { query(`BEGIN; UPDATE siat_configuracion SET siat_habilitado=true; SELECT siat_9b_verificar_nonce_prueba('${agent}','${probeNonce}'); ROLLBACK`); } catch { probeEnabledBlocked=true; }
if (!probeEnabledBlocked) throw Error('Sonda permitió emisión general habilitada');
let probeRepeat=false; try { query(`INSERT INTO siat_agent_nonces VALUES ('${agent}','${probeNonce}',now(),now()+interval '10 minutes')`); } catch { probeRepeat=true; }
if (!probeRepeat) throw Error('Nonce permitió repetición');
query(`UPDATE siat_agent_nonces SET expira_at=now()-interval '1 second' WHERE agente_id='${agent}' AND nonce='${probeNonce}'`);
if (query(`SELECT (siat_9b_verificar_nonce_prueba('${agent}','${probeNonce}')->>'persistido')`) !== 'false') throw Error('Sonda aceptó nonce vencido');
query(`DELETE FROM siat_agent_nonces WHERE agente_id='${agent}' AND nonce='${probeNonce}' AND expira_at<now()`);
if (query(`SELECT count(*) FROM siat_agent_nonces WHERE agente_id='${agent}' AND nonce='${probeNonce}'`) !== '0') throw Error('Limpieza de nonce no verificable');
const before = query(`SELECT siguiente_numero FROM siat_secuencias WHERE sucursal_id='${branch}' AND tipo_emision='ONLINE'`);
const block = `BEGIN; SELECT numero_desde||'-'||numero_hasta FROM siat_reservar_bloque_offline('${code}',2); SELECT pg_sleep(0.5); COMMIT;`;
const online = `BEGIN; SELECT siat_reservar_numero('${branch}',NULL,1,'ONLINE'); COMMIT;`;
const onlineResult = run(online).then(value => ({ value })).catch(error => {
  if (!String(error).includes("EMISION_ONLINE_PAUSADA_POR_RESERVA_OFFLINE")) throw error;
  return { value: null };
});
const [first, repeated, allocated] = await Promise.all([run(block), run(block), onlineResult]);
if (first !== repeated) throw Error("Dos aprovisionamientos no fueron idempotentes");
const [start, end] = first.split("-").map(Number), number = allocated.value === null ? null : Number(allocated.value);
if ((number !== null && (!Number.isSafeInteger(number) || (number >= start && number <= end))) || start < 4 || end - start !== 1) throw Error("Se produjo un solapamiento");
if (query(`SELECT count(*) FROM siat_bloques_numeracion_offline WHERE agente_id='${agent}'`) !== "1") throw Error("Bloque duplicado");
if (query(`SELECT numero_desde||'-'||numero_hasta FROM siat_reservar_bloque_offline('${code}',1)`) !== first) throw Error("Reintento en otra conexión devolvió otro bloque");
if (query(`SELECT count(*) FROM facturas_siat WHERE codigo_sucursal=${branchCode} AND numero_factura IN (1,2,3)`) !== "3") throw Error("Facturas históricas alteradas");
const after = Number(query(`SELECT siguiente_numero FROM siat_secuencias WHERE sucursal_id='${branch}' AND tipo_emision='ONLINE'`));
if ((number !== null && after <= Number(before)) || (number === null && after !== Number(before))) throw Error("Contador online inconsistente");
const [second, third] = await Promise.all([
  run(`SELECT numero_desde||'-'||numero_hasta FROM siat_reservar_bloque_offline('TEST-${agent2}',2)`),
  run(`SELECT numero_desde||'-'||numero_hasta FROM siat_reservar_bloque_offline('TEST-${agent5}',2)`),
]);
const [s2, e2] = second.split("-").map(Number);
if (!(s2 > end || e2 < start) || (number !== null && number >= s2 && number <= e2)) throw Error("Reservas de agentes superpuestas");
const [s3, e3] = third.split("-").map(Number);
if (!(s3 > e2 || e3 < s2) || !(s3 > end || e3 < start)) throw Error("Reservas concurrentes de agentes superpuestas");
let rejected = false;
try { query(`INSERT INTO siat_bloques_numeracion_offline(agente_id,sucursal_id,punto_venta_id,documento_sector,numero_desde,numero_hasta,ambiente,codigo_sucursal,codigo_punto_venta) VALUES ('${randomUUID()}','${branch}',NULL,1,${start},${end},'PRUEBAS',${branchCode},0)`); } catch { rejected = true; }
if (!rejected) throw Error("La restricción PostgreSQL no impidió el solapamiento");
const branch3 = randomUUID(), branchCode3 = randomInt(1000000001,2000000000), agent3 = randomUUID(), code3 = `TEST-${agent3}`;
query(`INSERT INTO siat_sucursales(id,codigo) VALUES ('${branch3}',${branchCode3});
  INSERT INTO siat_agentes_locales VALUES ('${agent3}','${code3}','ACTIVO','${branch3}',null);
  INSERT INTO siat_secuencias(sucursal_id,punto_venta_id,documento_sector,tipo_emision,siguiente_numero) VALUES ('${branch3}',null,1,'ONLINE',4);
  INSERT INTO facturas_siat(sucursal_id,punto_venta_id,codigo_sucursal,codigo_punto_venta,documento_sector,numero_factura,ambiente,tipo_emision) SELECT '${branch3}',null,${branchCode3},0,1,n,'PRUEBAS','ONLINE' FROM generate_series(1,3)n`);
if (query(`SELECT numero_desde||'-'||numero_hasta FROM siat_reservar_bloque_offline('${code3}',1)`) !== "4-4") throw Error("Reserva mínima incorrecta");
if (query(`SELECT siguiente_numero FROM siat_secuencias WHERE sucursal_id='${branch3}' AND tipo_emision='ONLINE'`) !== "4") throw Error("La reserva modificó la secuencia online");
for (const sector of [1, 2]) {
  let paused = false;
  try { query(`SELECT siat_reservar_numero('${branch3}',null,${sector},'ONLINE')`); }
  catch (error) { paused = String(error.stderr).includes("EMISION_ONLINE_PAUSADA_POR_RESERVA_OFFLINE"); }
  if (!paused) throw Error("La emisión online no se pausó para el punto de venta");
}
if (query(`SELECT siguiente_numero FROM siat_secuencias WHERE sucursal_id='${branch3}' AND tipo_emision='ONLINE'`) !== "4") throw Error("La emisión pausada alteró la secuencia");
let releaseRejected = false;
try { query(`UPDATE siat_bloques_numeracion_offline SET estado_reserva='CONCILIADA' WHERE agente_id='${agent3}'`); } catch { releaseRejected = true; }
if (!releaseRejected) throw Error("La reserva se liberó sin comprobación de conciliación");
let invoiceRejected = false;
try { query(`INSERT INTO facturas_siat(sucursal_id,codigo_sucursal,codigo_punto_venta,documento_sector,numero_factura,ambiente,tipo_emision) VALUES ('${branch3}',${branchCode3},0,1,1,'PRUEBAS','OFFLINE')`); } catch { invoiceRejected = true; }
if (!invoiceRejected) throw Error("La restricción no impidió repetir un número entre modalidades");
const manualCafc=randomUUID();
let manualBlocked = false;
try { query(`INSERT INTO facturas_siat(sucursal_id,codigo_sucursal,codigo_punto_venta,documento_sector,numero_factura,ambiente,tipo_emision,es_manual_cafc,cafc_id,numero_manual) VALUES ('${branch3}',${branchCode3},0,1,1,'PRUEBAS','OFFLINE',true,'${manualCafc}',1)`); } catch (error) { manualBlocked=String(error.stderr).includes('CAFC_DESHABILITADO_PENDIENTE_AUTORIZACION'); }
if (!manualBlocked) throw Error('Se permitió una nueva transcripción CAFC piloto');
if (query(`SELECT count(*) FROM facturas_siat WHERE codigo_sucursal=1999999999 AND es_manual_cafc AND numero_manual IN (4,1000000)`) !== '2') throw Error('Se alteraron históricos manuales');
const historicDigital=Number(query("SELECT siat_reservar_numero('00000000-0000-4000-8000-000000000091',NULL,1,'ONLINE')"));
if (historicDigital!==5) throw Error('Numeración digital no evitó la colisión CAFC sin heredar su correlativo');
if (query("SELECT numero_desde||'-'||numero_hasta FROM siat_reservar_bloque_offline('TEST-CAFC-HISTORICO',2)")!=='6-7') throw Error('CAFC histórico bloqueó o desvió la reserva digital');
if (query("SELECT numero_desde||'-'||numero_hasta FROM siat_reservar_bloque_offline('TEST-CAFC-RANGO',2)")!=='6-7') throw Error('El rango digital no evitó una colisión CAFC histórica');
const point0 = randomUUID(), agent4 = randomUUID(), code4 = `TEST-${agent4}`;
query(`INSERT INTO siat_puntos_venta(id,sucursal_id,codigo) VALUES ('${point0}','${branch3}',0);
  INSERT INTO siat_agentes_locales VALUES ('${agent4}','${code4}','ACTIVO','${branch3}','${point0}')`);
const [aliasOnline, aliasBlock] = await Promise.all([
  run(`SELECT siat_reservar_numero('${branch3}','${point0}',1,'ONLINE')`).then(() => false).catch(error => String(error).includes("EMISION_ONLINE_PAUSADA_POR_RESERVA_OFFLINE")),
  run(`SELECT numero_desde FROM siat_reservar_bloque_offline('${code4}',1)`),
]);
if (!aliasOnline || Number(aliasBlock) <= 4) throw Error("Punto 0 sin bloqueo compartido entre identificadores");
let invalidClose = false;
try { query(`SELECT siat_9b_conciliar_reserva('${code3}',4,4,5,NULL)`); } catch { invalidClose = true; }
if (!invalidClose) throw Error("Aceptó cerrar un número no conciliado");
if (!query(`SELECT siat_9b_conciliar_reserva('${code3}',4,4,4,NULL)`).includes('CONCILIADA')) throw Error("No cerró la reserva sin uso");
let stillPaused = false;
try { query(`SELECT siat_reservar_numero('${branch3}',NULL,1,'ONLINE')`); } catch (error) { stillPaused = String(error.stderr).includes('EMISION_ONLINE_PAUSADA_POR_RESERVA_OFFLINE'); }
if (!stillPaused) throw Error("Reanudó online con otra reserva abierta");
const aliasStart = Number(aliasBlock);
query(`SELECT siat_9b_conciliar_reserva('${code4}',${aliasStart},${aliasStart},${aliasStart},NULL)`);
const resumed = Number(query(`SELECT siat_reservar_numero('${branch3}',NULL,1,'ONLINE')`));
if (resumed <= Math.max(4, aliasStart)) throw Error("Reutilizó un número comprometido al reanudar");
if (!query(`SELECT siat_9b_conciliar_reserva('${code3}',4,4,4,NULL)`).includes('CONCILIADA')) throw Error("Cierre repetido no fue idempotente");
const newBlock = Number(query(`SELECT numero_desde FROM siat_reservar_bloque_offline('${code3}',1)`));
if (newBlock <= resumed) throw Error("No se permitió una nueva reserva sin reutilizar números previos");
if (!query(`SELECT siat_9b_conciliar_reserva('${code3}',4,4,4,NULL)`).includes('CONCILIADA')) throw Error("Reintento de cierre histórico falló con nueva reserva");

const branch4=randomUUID(), branchCode4=randomInt(1000000001,2000000000), agent6=randomUUID(), event=randomUUID(), code6=`TEST-${agent6}`;
query(`INSERT INTO siat_sucursales(id,codigo) VALUES ('${branch4}',${branchCode4});
  INSERT INTO siat_agentes_locales VALUES ('${agent6}','${code6}','ACTIVO','${branch4}',null)`);
const usedStart=Number(query(`SELECT numero_desde FROM siat_reservar_bloque_offline('${code6}',1)`));
query(`INSERT INTO siat_eventos_significativos(id,agente_local_id,estado) VALUES ('${event}','${agent6}','ENVIADO')`);
let partialRejected=false;
try { query(`SELECT siat_9b_conciliar_reserva('${code6}',${usedStart},${usedStart},${usedStart+1},'${event}')`); } catch { partialRejected=true; }
if (!partialRejected) throw Error('Cerró reserva sin factura persistida');
const invoiceId=randomUUID(), packageId=randomUUID();
query(`INSERT INTO facturas_siat(id,sucursal_id,codigo_sucursal,codigo_punto_venta,documento_sector,numero_factura,ambiente,tipo_emision,agente_local_id,evento_id,estado_fiscal,codigo_estado,transaccion,codigo_recepcion) VALUES ('${invoiceId}','${branch4}',${branchCode4},0,1,${usedStart},'PRUEBAS','OFFLINE','${agent6}','${event}','VALIDADA',908,true,'SINTETICO');
  INSERT INTO siat_paquetes(id,evento_id,estado,cantidad_facturas,codigo_recepcion,respuesta_siat) VALUES ('${packageId}','${event}','VALIDADO',1,'SINTETICO','{"transaccion":true,"codigoEstado":908}');
  INSERT INTO siat_paquete_facturas VALUES ('${packageId}','${invoiceId}')`);
let eventRejected=false;
try { query(`SELECT siat_9b_conciliar_reserva('${code6}',${usedStart},${usedStart},${usedStart+1},'${event}')`); } catch { eventRejected=true; }
if (!eventRejected) throw Error('Cerró reserva sin evento conciliado');
query(`UPDATE siat_eventos_significativos SET estado='VALIDADO',codigo_recepcion='SINTETICO',respuesta_siat='{"transaccion":true}' WHERE id='${event}'`);
const closure=`SELECT siat_9b_conciliar_reserva('${code6}',${usedStart},${usedStart},${usedStart+1},'${event}')`;
const [closedA,closedB]=await Promise.all([run(closure),run(closure)]);
if (closedA !== closedB || !closedA.includes('CONCILIADA')) throw Error('Cierre concurrente no idempotente');
if (Number(query(`SELECT siat_reservar_numero('${branch4}',NULL,1,'ONLINE')`)) <= usedStart) throw Error('Reutilizó el número offline conciliado');
const emptyBranch=randomUUID(), emptyCode=randomInt(1000000001,2000000000), emptyAgent=randomUUID(), emptyEvent=randomUUID(), emptyAgentCode=`TEST-${emptyAgent}`;
query(`INSERT INTO siat_sucursales VALUES ('${emptyBranch}',${emptyCode}); INSERT INTO siat_agentes_locales VALUES ('${emptyAgent}','${emptyAgentCode}','ACTIVO','${emptyBranch}',NULL)`);
const emptyStart=Number(query(`SELECT numero_desde FROM siat_reservar_bloque_offline('${emptyAgentCode}',1)`));
query(`INSERT INTO siat_eventos_significativos(id,agente_local_id,estado,codigo_recepcion,respuesta_siat,fecha_fin,tipo_evento_codigo) VALUES ('${emptyEvent}','${emptyAgent}','ENVIADO',NULL,'{}',now(),'1')`);
const emptyClose=`SELECT siat_9b_conciliar_reserva('${emptyAgentCode}',${emptyStart},${emptyStart},${emptyStart},'${emptyEvent}')`;
let uncertainRejected=false; try { query(emptyClose); } catch { uncertainRejected=true; }
if (!uncertainRejected) throw Error('Cerró evento vacío con respuesta incierta');
query(`UPDATE siat_eventos_significativos SET estado='VALIDADO',codigo_recepcion='SINTETICO',respuesta_siat='{"transaccion":true}' WHERE id='${emptyEvent}'; INSERT INTO siat_outbox(estado,tipo_tarea,payload) VALUES ('PENDIENTE','REGISTRAR_EVENTO','{"eventoId":"${emptyEvent}"}')`);
let pendingRejected=false; try { query(emptyClose); } catch { pendingRejected=true; }
if (!pendingRejected) throw Error('Cerró evento vacío con tareas pendientes');
query(`UPDATE siat_outbox SET estado='COMPLETADA' WHERE payload->>'eventoId'='${emptyEvent}'; INSERT INTO siat_intentos_envio VALUES ('${emptyEvent}','AMBIGUO')`);
let ambiguousRejected=false; try { query(emptyClose); } catch { ambiguousRejected=true; }
if (!ambiguousRejected) throw Error('Cerró evento vacío con intento ambiguo');
query(`UPDATE siat_intentos_envio SET estado='EXITOSO' WHERE evento_id='${emptyEvent}'`);
const [emptyA,emptyB]=await Promise.all([run(emptyClose),run(emptyClose)]);
if (emptyA!==emptyB || !emptyA.includes('CONCILIADA')) throw Error('Cierre de evento vacío no idempotente');
for (const late of [
  `INSERT INTO facturas_siat(codigo_sucursal,codigo_punto_venta,documento_sector,numero_factura,ambiente,tipo_emision,evento_id) VALUES (${emptyCode},0,1,${emptyStart},'PRUEBAS','OFFLINE','${emptyEvent}')`,
  `INSERT INTO siat_9b_cafc_vinculos(factura_id,evento_id) VALUES ('${randomUUID()}','${emptyEvent}')`,
  `INSERT INTO siat_paquetes(id,evento_id) VALUES ('${randomUUID()}','${emptyEvent}')`,
]) {
  let rejectedLate=false; try { query(late); } catch (error) { rejectedLate=String(error.stderr).includes('EVENTO_CON_RESERVA_YA_CONCILIADA'); }
  if (!rejectedLate) throw Error('Permitió incorporar documentos a un evento conciliado');
}
if (Number(query(`SELECT siat_reservar_numero('${emptyBranch}',NULL,1,'ONLINE')`))<=emptyStart) throw Error('Reutilizó número de reserva vacía');
const raceBranch=randomUUID(), raceCode=randomInt(1000000001,2000000000), raceAgent=randomUUID(), raceEvent=randomUUID(), raceAgentCode=`TEST-${raceAgent}`;
query(`INSERT INTO siat_sucursales VALUES ('${raceBranch}',${raceCode}); INSERT INTO siat_agentes_locales VALUES ('${raceAgent}','${raceAgentCode}','ACTIVO','${raceBranch}',NULL)`);
const raceStart=Number(query(`SELECT numero_desde FROM siat_reservar_bloque_offline('${raceAgentCode}',1)`));
query(`INSERT INTO siat_eventos_significativos(id,agente_local_id,estado,codigo_recepcion,respuesta_siat,fecha_fin,tipo_evento_codigo) VALUES ('${raceEvent}','${raceAgent}','VALIDADO','SINTETICO','{"transaccion":true}',now(),'1')`);
const [raceClose,raceInsert]=await Promise.all([
  run(`SELECT siat_9b_conciliar_reserva('${raceAgentCode}',${raceStart},${raceStart},${raceStart},'${raceEvent}')`).then(()=>true).catch(()=>false),
  run(`INSERT INTO facturas_siat(codigo_sucursal,codigo_punto_venta,documento_sector,numero_factura,ambiente,tipo_emision,evento_id) VALUES (${raceCode},0,1,${raceStart},'PRUEBAS','OFFLINE','${raceEvent}')`).then(()=>true).catch(()=>false),
]);
if (raceClose === raceInsert) throw Error('Cierre y documento concurrentes no quedaron serializados');
const normalBranch = randomUUID();
query(`INSERT INTO siat_sucursales(id,codigo) VALUES ('${normalBranch}',${randomInt(1000000001,2000000000)})`);
if (query(`SELECT siat_reservar_numero('${normalBranch}',null,1,'ONLINE')`) !== "1" || query(`SELECT siat_reservar_numero('${normalBranch}',null,1,'ONLINE')`) !== "2") throw Error("La emisión normal sin reservas cambió");
let missingCount = false; try { query(`SELECT * FROM siat_reservar_bloque_offline('${code3}')`); } catch { missingCount = true; }
if (!missingCount) throw Error("Aceptó reserva sin cantidad explícita");
console.log("PostgreSQL sintético: concurrencia, reintento, exclusión, pausa y cierre conciliado aprobados.");

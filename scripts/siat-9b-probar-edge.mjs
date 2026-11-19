// Solo ejecutar con autorización. Utiliza credenciales ya inyectadas en el proceso.
import { createHmac, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const ref = 'vzpufrxjmdjjkikvpeev';
const agent = process.env.SIAT_AGENT_CODE ?? '';
const noncePattern = /^9bprobe_[a-f0-9]{32}$/;
if (!/^[A-Za-z0-9_-]{1,120}$/.test(agent)) throw Error('SIAT_AGENT_CODE no disponible o inválido');
const mode = process.argv[2];
if (mode === 'send') {
  const secret = process.env.SIAT_AGENT_SHARED_SECRET ?? '';
  if (secret.length < 32) throw Error('La clave existente del agente no está disponible en este proceso');
  const nonce = `9bprobe_${randomBytes(16).toString('hex')}`;
  const timestamp = String(Date.now());
  const body = JSON.stringify({ action: 'probe-9b-persistencia', contrato: 2 });
  const signature = createHmac('sha256', secret).update(`${timestamp}.${nonce}.${body}`).digest('hex');
  // El identificador no es una credencial; permite limpiar incluso si se pierde la respuesta.
  console.log(`IDENTIFICADOR_SONDA=${nonce}`);
  let response;
  try {
    response = await fetch(`https://${ref}.supabase.co/functions/v1/siat-local-ingest`, {
      method: 'POST', body, signal: AbortSignal.timeout(20000),
      headers: { 'content-type': 'application/json', 'x-siat-agent': agent, 'x-siat-timestamp': timestamp, 'x-siat-nonce': nonce, 'x-siat-signature': signature },
    });
  } catch { throw Error('Respuesta incierta; no repetir. Verifique y limpie el identificador tras su vencimiento.'); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.edge !== true || result.rpc !== 'siat_9b_verificar_nonce_prueba' || result.persistido !== true || result.fiscal !== false) {
    throw Error(`Sonda no confirmada (HTTP ${response.status}); no repetir. Verifique el identificador tras su vencimiento.`);
  }
  console.log('EDGE_RPC_POSTGRES=CONFIRMADO; OPERACION_FISCAL=NO; LIMPIEZA=DESPUES_DE_VENCIMIENTO');
} else if (mode === 'replay') {
  const nonce = process.argv[3] ?? '', timestamp = process.argv[4] ?? '';
  const secret = process.env.SIAT_AGENT_SHARED_SECRET ?? '';
  if (!noncePattern.test(nonce) || !/^\d{13}$/.test(timestamp) || secret.length < 32) throw Error('Datos de sonda inválidos');
  const body = JSON.stringify({ action: 'probe-9b-persistencia', contrato: 2 });
  const signature = createHmac('sha256', secret).update(`${timestamp}.${nonce}.${body}`).digest('hex');
  const response = await fetch(`https://${ref}.supabase.co/functions/v1/siat-local-ingest`, { method: 'POST', body, signal: AbortSignal.timeout(20000), headers: { 'content-type': 'application/json', 'x-siat-agent': agent, 'x-siat-timestamp': timestamp, 'x-siat-nonce': nonce, 'x-siat-signature': signature } });
  const result = await response.json().catch(() => ({}));
  if (response.status !== 401 || !/nonce|repetida/i.test(String(result.error ?? ''))) throw Error('Reutilización de nonce no confirmada como rechazada');
  console.log('REUTILIZACION_NONCE_RECHAZADA=SI');
} else if (mode === 'cleanup') {
  const nonce = process.argv[3] ?? '';
  if (!noncePattern.test(nonce)) throw Error('Identificador de sonda inválido');
  const npx = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  const sql = `WITH borrado AS (DELETE FROM public.siat_agent_nonces WHERE nonce='${nonce}' AND agente_id=(SELECT id FROM public.siat_agentes_locales WHERE codigo='${agent}') AND expira_at<now() RETURNING 1) SELECT (SELECT count(*) FROM borrado) AS eliminados, (SELECT count(*) FROM public.siat_agent_nonces WHERE nonce='${nonce}' AND agente_id=(SELECT id FROM public.siat_agentes_locales WHERE codigo='${agent}') AND expira_at>=now()) AS sin_vencer`;
  const query = (statement) => {
    const result = spawnSync(process.execPath, [npx, 'supabase', 'db', 'query', '--linked', '--project-ref', ref, statement, '--output', 'json'], { encoding: 'utf8', timeout: 45000 });
    if (result.status !== 0) throw Error('No se pudo comprobar o limpiar la sonda; no elimine otros registros.');
    try { return JSON.parse(result.stdout); } catch { throw Error('Respuesta de limpieza no verificable'); }
  };
  const response = query(sql);
  const row = response.rows?.[0];
  if (!row || Number(row.sin_vencer) !== 0 || ![0, 1].includes(Number(row.eliminados))) throw Error('Nonce aún vigente o limpieza no confirmada; no repetir la solicitud fiscal.');
  const verify = query(`SELECT count(*) AS restantes FROM public.siat_agent_nonces WHERE nonce='${nonce}' AND agente_id=(SELECT id FROM public.siat_agentes_locales WHERE codigo='${agent}')`).rows?.[0];
  if (!verify || Number(verify.restantes) !== 0) throw Error('La ausencia del nonce no pudo verificarse.');
  console.log(`SONDA_VENCIDA_LIMPIA=SI; REGISTROS_ELIMINADOS=${row.eliminados}`);
} else {
  throw Error('Uso: node scripts/siat-9b-probar-edge.mjs send | cleanup <identificador>');
}

// Operación dirigida autorizada; no llama recepcionFactura ni procesa la cola.
// Las credenciales de proyecto permanecen en memoria y nunca se imprimen/guardan.
import { spawnSync } from "node:child_process";

const projectRef = "vzpufrxjmdjjkikvpeev";
const request = {
  action: "reconcile-held-invoice-with-current-cufd-once",
  facturaId: "c2279bbb-e851-468b-afe6-8ebf0b436d28",
  outboxId: "e4d9ce8e-1c5c-4a08-94db-f4f50c3a8a0e",
  cuf: "4F12E17A8691D075DF06D5A37DF0CF988D89E06A25B01BF34DA4BF74",
};

async function main() {
  if (!process.argv.includes("--execute") && !process.argv.includes("--check-auth")) throw new Error("Use --check-auth o --execute; sin acción por defecto.");
  const cli = spawnSync(process.execPath, ["node_modules/supabase/dist/supabase.js", "projects", "api-keys", "--project-ref", projectRef, "--reveal", "--output-format", "json"], { encoding: "utf8", env: { ...process.env, DO_NOT_TRACK: "1" } });
  if (cli.status !== 0) throw new Error("No se pudo obtener autenticación operativa; no se invocó el worker.");
  let keys;
  try { keys = JSON.parse(cli.stdout); }
  catch { throw new Error("Respuesta de autenticación no reconocida; no se invocó el worker."); }
  const entries = Array.isArray(keys) ? keys : keys.keys ?? keys.rows ?? [];
  const key = (entries.find((item) => item.type === "secret" && item.name === "default") ?? entries.find((item) => item.name === "service_role"))?.api_key;
  if (typeof key !== "string" || !/^(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sb_secret_[A-Za-z0-9_-]+)$/.test(key)) throw new Error("Credencial operativa no disponible; no se invocó el worker.");
  if (!process.argv.includes("--execute")) { console.log("Autenticación operativa disponible; sin llamada al worker ni al SIN."); return; }
  // Una sola petición. Ante timeout, inspeccionar BD; NO repetir automáticamente.
  const response = await fetch(`https://${projectRef}.supabase.co/functions/v1/siat-worker`, {
    method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(request), signal: AbortSignal.timeout(60_000),
  });
  const result = await response.json();
  console.log(JSON.stringify({ http: response.status, facturaId: result.facturaId, estadoFiscal: result.estadoFiscal, reenvioBloqueado: result.reenvioBloqueado, respuesta: result.respuesta, error: result.error }, null, 2));
  if (!response.ok) process.exitCode = 1;
}

main().catch((error) => {
  const safe = /^(Use --|No se pudo obtener autenticación|Respuesta de autenticación|Credencial operativa)/.test(error.message);
  console.error(safe ? error.message : "Operación no confirmada. Revisar persistencia sin repetir la consulta ni reenviar la factura.");
  process.exitCode = 1;
});

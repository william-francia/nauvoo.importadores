import { SiatEngine, errorMessage } from "../_shared/siat/engine.ts";
import { SiatRepository } from "../_shared/siat/repository.ts";
import { json, officialAdapter, secureEquals, serviceClient } from "../_shared/siat/runtime.ts";

const permanentError = (message: string) => /XML inválido|snapshot|CUF|documento sector|totales|no está habilitado|PENDIENTE_DE_VERIFICACION_OFICIAL/i.test(message);

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Método no permitido." }, 405);
  const configuredSecret = Deno.env.get("SIAT_WORKER_SECRET") ?? "";
  if (!configuredSecret || !await secureEquals(request.headers.get("x-worker-secret") ?? "", configuredSecret)) return json({ error: "No autorizado." }, 401);
  const repository = new SiatRepository(serviceClient());
  const engine = new SiatEngine(repository, officialAdapter(), {
    privateKeyPem: Deno.env.get("SIAT_PRIVATE_KEY_PEM"), certificatePem: Deno.env.get("SIAT_CERTIFICATE_PEM"),
  }, (name) => Deno.readTextFile(new URL(`../_shared/siat/artifacts/SIAT_VIGENTE/${name}`, import.meta.url)));
  const workerId = `edge-${crypto.randomUUID()}`; let processed = 0; const failures: string[] = [];
  for (let index = 0; index < 10; index += 1) {
    const job = await repository.claim(workerId); if (!job) break;
    try { await engine.process(job); processed += 1; }
    catch (error) { const message = errorMessage(error); failures.push(message); await repository.retryJob(String(job.id), Number(job.intentos ?? 1), message, permanentError(message)); }
  }
  return json({ processed, failures });
});

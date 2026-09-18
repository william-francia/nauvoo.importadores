import { SiatRepository } from "../_shared/siat/repository.ts";
import { json, secureEquals, serviceClient } from "../_shared/siat/runtime.ts";

const expiresWithin = (value: unknown, milliseconds: number) => !value || new Date(String(value)).getTime() <= Date.now() + milliseconds;

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Método no permitido." }, 405);
  const schedulerSecret = Deno.env.get("SIAT_SCHEDULER_SECRET") ?? "";
  if (!schedulerSecret || !await secureEquals(request.headers.get("x-scheduler-secret") ?? "", schedulerSecret)) return json({ error: "No autorizado." }, 401);
  try {
    const db = serviceClient(); const repository = new SiatRepository(db); const config = await repository.configuration();
    const { error: nonceCleanupError } = await db.from("siat_agent_nonces").delete().lt("expira_at", new Date().toISOString());
    if (nonceCleanupError && nonceCleanupError.code !== "42P01") throw nonceCleanupError;
    if (!config.siat_habilitado) return json({ queued: [], worker: "omitido" });
    const date = new Date().toISOString().slice(0, 10); const queued: string[] = [];
    const cuis = await repository.activeCuis(config);
    const renewCuis = !cuis || expiresWithin(cuis.fecha_expiracion, 5 * 24 * 60 * 60 * 1000);
    if (renewCuis) {
      await repository.enqueue(null, "RENOVAR_CUIS", `renovar_cuis:${date}`, { proceso: "mantenimiento" }); queued.push("RENOVAR_CUIS");
    }
    let cufdQuery = db.from("siat_cufd").select("id,fecha_expiracion").eq("sucursal_id", config.sucursal_predeterminada_id).eq("ambiente", config.ambiente).eq("estado", "VIGENTE");
    cufdQuery = config.punto_venta_predeterminado_id ? cufdQuery.eq("punto_venta_id", config.punto_venta_predeterminado_id) : cufdQuery.is("punto_venta_id", null);
    const { data: cufd, error: cufdError } = await cufdQuery.order("fecha_expiracion", { ascending: false }).limit(1).maybeSingle();
    if (cufdError) throw cufdError;
    if (renewCuis || !cufd || expiresWithin(cufd.fecha_expiracion, 2 * 60 * 60 * 1000)) {
      await repository.enqueue(null, "RENOVAR_CUFD", `renovar_cufd:${date}`, { proceso: "mantenimiento" }); queued.push("RENOVAR_CUFD");
    }
    if (expiresWithin(config.ultima_sincronizacion_exitosa, 20 * 60 * 60 * 1000)) {
      await repository.enqueue(null, "SINCRONIZAR_CATALOGOS", `sincronizacion:${date}`, { proceso: "mantenimiento" }); queued.push("SINCRONIZAR_CATALOGOS");
    }
    const workerSecret = Deno.env.get("SIAT_WORKER_SECRET") ?? ""; const baseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    if (!workerSecret || !baseUrl) throw new Error("Worker SIAT no configurado.");
    const workerResponse = await fetch(`${baseUrl}/functions/v1/siat-worker`, { method: "POST", headers: { "x-worker-secret": workerSecret } });
    if (!workerResponse.ok) throw new Error(`Worker SIAT respondió HTTP ${workerResponse.status}.`);
    return json({ queued, worker: await workerResponse.json() });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message.slice(0, 500) : "Error de mantenimiento SIAT." }, 500);
  }
});

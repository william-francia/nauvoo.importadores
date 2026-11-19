// La RPC rechaza los identificadores inexistentes; no crea agentes ni eventos.
export async function probeContingencyDenial(
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>,
) {
  const result = await rpc("siat_9b_estado_recuperacion", { p_agente: crypto.randomUUID(), p_evento: crypto.randomUUID() });
  if (!result.error || !result.error.message.includes("Evento no disponible para este agente")) throw new Error("PRUEBA_9B_RPC_NO_CONCLUYENTE");
  return { edge: true, rpc: "siat_9b_estado_recuperacion", rechazoEsperado: true, escritura: false };
}

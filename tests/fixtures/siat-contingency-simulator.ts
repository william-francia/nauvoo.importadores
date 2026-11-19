import type { CufdResult, PackageReceptionInput, SiatContext, SiatResponse, SignificantEventInput } from "../../supabase/functions/_shared/siat/types.ts";

// Este módulo vive exclusivamente en tests: no importa clientes HTTP ni el adaptador oficial.
// Solo acepta el NIT y el código de sistema reservados por el fixture sintético.
function assertSynthetic(context: SiatContext): void {
  if (context.ambiente !== "PRUEBAS" || context.nit !== "123456789" || context.codigoSistema !== "TEST") {
    throw new Error("SIMULADOR_CONTEXTO_NO_SINTETICO");
  }
}

const response = (code: number, reception: string): SiatResponse => ({
  codigoEstado: code, transaccion: true, codigoRecepcion: reception, codigoDescripcion: "SIMULADO",
  mensajes: [], rawSanitizado: { simulado: true, codigoEstado: code, transaccion: true, codigoRecepcion: reception },
});

export class SyntheticContingencySin {
  async solicitarCufd(context: SiatContext): Promise<CufdResult> {
    assertSynthetic(context);
    return { ...response(908, "CUFD-SYNTHETIC"), codigo: "CUFD-SYNTHETIC-NEW", codigoControl: "ABCD", fechaVigencia: new Date(Date.now() + 86_400_000).toISOString(), direccion: "Sintetica" };
  }
  async registrarEvento(input: SignificantEventInput): Promise<SiatResponse> {
    assertSynthetic(input.context);
    if (input.codigoEvento !== 1 || input.cufdEvento !== "CUFD-SYNTHETIC-OLD") throw new Error("SIMULADOR_EVENTO_NO_SINTETICO");
    return response(908, "EVENT-SYNTHETIC");
  }
  async recepcionarPaquete(input: PackageReceptionInput): Promise<SiatResponse> {
    assertSynthetic(input.context);
    if (input.codigoEvento !== "EVENT-SYNTHETIC" || input.cantidadFacturas !== 1 || !input.archivo.length) throw new Error("SIMULADOR_PAQUETE_NO_SINTETICO");
    return response(901, "PACKAGE-SYNTHETIC");
  }
  async validarPaquete(context: SiatContext, reception: string): Promise<SiatResponse> {
    assertSynthetic(context);
    if (reception !== "PACKAGE-SYNTHETIC") throw new Error("SIMULADOR_RECEPCION_NO_SINTETICA");
    return response(904, reception);
  }
  async verificarFactura(context: SiatContext): Promise<SiatResponse> {
    assertSynthetic(context);
    return response(908, "INVOICE-SYNTHETIC");
  }
}

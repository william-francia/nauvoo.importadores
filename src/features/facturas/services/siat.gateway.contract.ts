import type { AmbienteSiat, ContingenciaInput, VersionNormativaSiat } from "../types/siat.types";

export interface SiatGatewayContext {
  correlationId: string;
  idempotencyKey: string;
  ambiente: AmbienteSiat;
  versionNormativa: VersionNormativaSiat;
}

export interface PrepararFacturaCommand {
  ventaId: string;
  contexto: SiatGatewayContext;
}

export interface PrepararFacturaResult {
  facturaId: string;
  estado: string;
}

export interface SiatGatewayContract {
  prepararFactura(command: PrepararFacturaCommand): Promise<PrepararFacturaResult>;
  registrarEvento(input: ContingenciaInput, contexto: SiatGatewayContext): Promise<{ eventoId: string }>;
  sincronizarCatalogos(contexto: SiatGatewayContext): Promise<{ sincronizacionId: string }>;
}

import { PendingOfficialVerificationError } from "./types.ts";
import type { SiatAdapter } from "./types.ts";

export class Ley1733PilotAdapter implements SiatAdapter {
  private unavailable(): never { throw new PendingOfficialVerificationError("PENDIENTE_DE_VERIFICACION_OFICIAL: SIAT_LEY_1733_PILOTO no está habilitado para producción."); }
  verificarComunicacion = async () => this.unavailable();
  solicitarCuis = async () => this.unavailable();
  solicitarCufd = async () => this.unavailable();
  sincronizarFechaHora = async () => this.unavailable();
  sincronizarCatalogo = async () => this.unavailable();
  recepcionarFactura = async () => this.unavailable();
  verificarFactura = async () => this.unavailable();
  anularFactura = async () => this.unavailable();
  revertirAnulacion = async () => this.unavailable();
  registrarEvento = async () => this.unavailable();
  consultarEventos = async () => this.unavailable();
  recepcionarPaquete = async () => this.unavailable();
  validarPaquete = async () => this.unavailable();
}

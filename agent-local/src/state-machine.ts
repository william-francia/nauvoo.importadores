import type { ConnectivityEvidence, OperationalState } from "./types.ts";

const allowed: Record<OperationalState, OperationalState[]> = {
  ONLINE: ["DEGRADADO"], DEGRADADO: ["ONLINE", "INICIANDO_CONTINGENCIA"],
  INICIANDO_CONTINGENCIA: ["OFFLINE", "DEGRADADO"], OFFLINE: ["RECUPERANDO"],
  RECUPERANDO: ["OFFLINE", "REGISTRANDO_EVENTO"], REGISTRANDO_EVENTO: ["OFFLINE", "EMPAQUETANDO"],
  EMPAQUETANDO: ["ENVIANDO_PAQUETES", "OFFLINE"], ENVIANDO_PAQUETES: ["VALIDANDO_PAQUETES", "OFFLINE"],
  VALIDANDO_PAQUETES: ["ONLINE", "OFFLINE"],
};

export class OperationalMachine {
  constructor(public state: OperationalState = "ONLINE", public failures = 0) {}
  next(evidence: ConnectivityEvidence): OperationalState {
    const healthy = evidence.internetOnline && evidence.backendOnline && evidence.siatOnline;
    if (healthy) {
      this.failures = 0;
      if (this.state === "DEGRADADO") return this.move("ONLINE");
      if (this.state === "OFFLINE") return this.move("RECUPERANDO");
      return this.state;
    }
    this.failures += 1;
    if (this.state === "ONLINE") return this.move("DEGRADADO");
    if (this.state === "DEGRADADO" && this.failures >= 3) return this.move("INICIANDO_CONTINGENCIA");
    return this.state;
  }
  confirmContingency() { if (this.state !== "INICIANDO_CONTINGENCIA") throw new Error("La contingencia no puede iniciarse desde el estado actual."); return this.move("OFFLINE"); }
  move(next: OperationalState) { if (!allowed[this.state].includes(next)) throw new Error(`Transición operativa inválida: ${this.state} -> ${next}.`); this.state = next; return next; }
}

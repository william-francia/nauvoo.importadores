import { describe, expect, it } from "vitest";
import { OperationalMachine } from "../../agent-local/src/state-machine.ts";
import type { ConnectivityEvidence } from "../../agent-local/src/types.ts";

const evidence = (online: boolean): ConnectivityEvidence => ({ browserOnline: null, internetOnline: online, backendOnline: online, siatOnline: online, specificService: "test", checkedAt: new Date().toISOString() });

describe("máquina operativa del agente", () => {
  it("no entra offline por un fallo ocasional", () => {
    const machine = new OperationalMachine("ONLINE");
    expect(machine.next(evidence(false))).toBe("DEGRADADO");
    expect(machine.next(evidence(true))).toBe("ONLINE");
  });

  it("requiere tres fallos y una confirmación de evento", () => {
    const machine = new OperationalMachine("ONLINE");
    machine.next(evidence(false)); machine.next(evidence(false));
    expect(machine.state).toBe("DEGRADADO");
    expect(machine.next(evidence(false))).toBe("INICIANDO_CONTINGENCIA");
    expect(machine.confirmContingency()).toBe("OFFLINE");
    expect(machine.next(evidence(true))).toBe("RECUPERANDO");
  });

  it("impide saltos que omiten registro y validación", () => {
    const machine = new OperationalMachine("OFFLINE");
    expect(() => machine.move("ONLINE")).toThrow(/Transición operativa inválida/);
  });
});

export interface CufInput {
  nit: string;
  fechaEmision: Date | string;
  codigoSucursal: number;
  modalidad: 1 | 2;
  tipoEmision: 1 | 2;
  tipoFactura: number;
  documentoSector: number;
  numeroFactura: bigint | number | string;
  codigoPuntoVenta: number | null;
  codigoControl: string;
}

const digits = (value: string | number | bigint, length: number, label: string) => {
  const normalized = String(value);
  if (!/^\d+$/.test(normalized) || normalized.length > length) throw new Error(`${label} no es válido para el CUF.`);
  return normalized.padStart(length, "0");
};

export function formatSiatDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("Fecha de emisión inválida.");
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/La_Paz", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}${String(date.getUTCMilliseconds()).padStart(3, "0")}`;
}

export function modulo11(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error("Módulo 11 requiere una cadena numérica.");
  let sum = 0;
  let weight = 2;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    sum += Number(value[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const check = 11 - (sum % 11);
  if (check === 10) return 1;
  if (check === 11) return 0;
  return check;
}

export function decimalToHex(value: string): string {
  if (!/^\d+$/.test(value)) throw new Error("Base 16 requiere una cadena decimal.");
  return BigInt(value).toString(16).toUpperCase();
}

export function cufNumericBase(input: Omit<CufInput, "codigoControl">): string {
  return [
    digits(input.nit, 13, "NIT"), formatSiatDate(input.fechaEmision), digits(input.codigoSucursal, 4, "Sucursal"),
    digits(input.modalidad, 1, "Modalidad"), digits(input.tipoEmision, 1, "Tipo de emisión"),
    digits(input.tipoFactura, 1, "Tipo de factura"), digits(input.documentoSector, 2, "Documento sector"),
    digits(input.numeroFactura, 10, "Número de factura"), digits(input.codigoPuntoVenta ?? 0, 4, "Punto de venta"),
  ].join("");
}

export function generateCuf(input: CufInput): string {
  const base = cufNumericBase(input);
  if (base.length !== 53) throw new Error("La composición numérica oficial del CUF debe tener 53 dígitos.");
  const withCheckDigit = `${base}${modulo11(base)}`;
  return `${decimalToHex(withCheckDigit)}${input.codigoControl}`.toUpperCase();
}

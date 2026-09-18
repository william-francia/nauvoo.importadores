import { Decimal } from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -30, toExpPos: 40 });

export const money = (value: Decimal.Value) => new Decimal(value);
export const roundMoney = (value: Decimal.Value) => money(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
export const roundQuantity = (value: Decimal.Value) => money(value).toDecimalPlaces(3, Decimal.ROUND_HALF_UP);
export const formatMoney = (value: Decimal.Value) => roundMoney(value).toFixed(2);
export const formatQuantity = (value: Decimal.Value) => roundQuantity(value).toFixed(3).replace(/\.?(0+)$/, "");

export function lineSubtotal(quantity: Decimal.Value, price: Decimal.Value, discount: Decimal.Value = 0): Decimal {
  const result = money(quantity).times(price).minus(discount);
  if (result.isNegative()) throw new Error("El descuento no puede superar el importe de la línea.");
  return roundMoney(result);
}

export function invoiceTotal(lines: Array<{ quantity: Decimal.Value; price: Decimal.Value; discount?: Decimal.Value }>, extraDiscount: Decimal.Value = 0): Decimal {
  const total = lines.reduce((sum, line) => sum.plus(lineSubtotal(line.quantity, line.price, line.discount ?? 0)), money(0)).minus(extraDiscount);
  if (total.lte(0)) throw new Error("El total fiscal debe ser mayor que cero.");
  return roundMoney(total);
}

export function maskCard(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 4) return null;
  return `${digits.slice(0, 4)}00000000${digits.slice(-4)}`;
}

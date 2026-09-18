const moneyFormatter = new Intl.NumberFormat("es-BO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const axisFormatter = new Intl.NumberFormat("es-BO", {
  maximumFractionDigits: 0,
});

export const quantityFormatter = new Intl.NumberFormat("es-BO", {
  maximumFractionDigits: 3,
});

export function formatMoney(value: number) {
  return `Bs ${moneyFormatter.format(value)}`;
}

export function formatAxisMoney(value: number) {
  return `Bs ${axisFormatter.format(value)}`;
}

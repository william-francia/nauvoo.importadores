const pendingKey = "siat-venta-offline-pendiente";

export function offlineSaleKey(storage: Pick<Storage, "getItem" | "setItem">, randomId = () => crypto.randomUUID()): string {
  const key = storage.getItem(pendingKey) ?? `caja:${randomId()}`;
  if (!/^caja:[0-9a-f-]{36}$/i.test(key)) throw new Error("La operación pendiente requiere revisión antes de continuar.");
  storage.setItem(pendingKey, key);
  return key;
}

export function finishOfflineSale(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem(pendingKey);
}

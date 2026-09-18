import type { CurrentAccount } from "./types/account.types";

export function accountDisplayName(account: CurrentAccount) {
  return [account.firstName, account.lastName].filter(Boolean).join(" ") || "Perfil sin configurar";
}

export function accountInitial(account: CurrentAccount) {
  return (account.firstName?.trim().charAt(0) || account.email?.trim().charAt(0) || "?").toUpperCase();
}

export function roleLabel(role: string | null) {
  if (!role) return "Sin rol asignado";
  if (role === "administrador") return "Administrador";
  if (role === "almacen") return "Almacén";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

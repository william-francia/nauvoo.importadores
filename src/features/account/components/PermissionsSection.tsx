import { ShieldCheck } from "lucide-react";
import type { CurrentAccount } from "../types/account.types";

const MODULES = [
  ["Productos", "products"], ["Stock", "inventory"], ["Clientes", "clients"], ["Ventas", "sales"], ["Detalle ventas", "sales_detail"],
  ["Movimientos", "movements"], ["Factura SIAT", "invoices"], ["Historial", "history"], ["Usuarios", "users"],
] as const;
const ROLE_ORDER = ["administrador", "vendedor", "almacen", "caja"];

type AccessLevel = "total" | "manage" | "read" | "none";

function accessLevel(account: CurrentAccount, role: string, module: string): AccessLevel {
  const actions = account.permissionMatrix
    .filter((row) => row.roleCode === role && row.permission?.startsWith(`${module}.`))
    .map((row) => row.permission?.split(".")[1]);
  if (!actions.length) return "none";
  if (role === "administrador") return "total";
  if (actions.includes("delete") || actions.includes("disable")) return "total";
  if (actions.some((action) => action && action !== "read")) return "manage";
  return "read";
}

function Indicator({ level }: { level: AccessLevel }) {
  const labels = { total: "Acceso total", manage: "Gestionar", read: "Solo lectura", none: "Sin acceso" };
  return <span className={`permission-indicator permission-indicator--${level}`} title={labels[level]} aria-label={labels[level]}>{level === "total" ? "✓" : level === "manage" ? "●" : level === "read" ? "◉" : "×"}</span>;
}

export default function PermissionsSection({ account }: { account: CurrentAccount }) {
  const roles = ROLE_ORDER.map((roleCode) => ({
    code: roleCode,
    label: account.permissionMatrix.find((row) => row.roleCode === roleCode)?.roleLabel ?? roleCode,
  }));
  return <div className="account-permissions">
    <div className="account-section-heading"><ShieldCheck /><div><h3>Permisos por rol</h3><p>Vista de permisos asignados desde el backend.</p></div></div>
    {account.permissionMatrix.length === 0 ? <p className="account-empty">No hay permisos disponibles para mostrar.</p> : <>
      <div className="permission-table-wrap"><table><thead><tr><th>Módulo</th>{roles.map((role) => <th key={role.code}>{role.label}</th>)}</tr></thead><tbody>{MODULES.map(([label, module]) => <tr key={module}><td>{label}</td>{roles.map((role) => <td key={role.code}><Indicator level={accessLevel(account, role.code, module)} /></td>)}</tr>)}</tbody></table></div>
      <div className="permission-legend"><Indicator level="total" /> Acceso total <Indicator level="manage" /> Gestionar <Indicator level="read" /> Solo lectura <Indicator level="none" /> Sin acceso</div>
    </>}
  </div>;
}

import { useState, type FormEvent } from "react";
import { Eye, EyeOff, KeyRound, Laptop, LockKeyhole } from "lucide-react";
import { useChangeMyPassword, useCloseOtherSessions } from "../hooks/useCurrentAccount";
import type { ChangePasswordInput, CurrentAccount } from "../types/account.types";

type PasswordField = keyof ChangePasswordInput;

export default function SecuritySection({ account }: { account: CurrentAccount }) {
  const [form, setForm] = useState<ChangePasswordInput>({ currentPassword: "", newPassword: "", confirmation: "" });
  const [visible, setVisible] = useState<Record<PasswordField, boolean>>({ currentPassword: false, newPassword: false, confirmation: false });
  const passwordMutation = useChangeMyPassword(account.email);
  const sessionsMutation = useCloseOtherSessions();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    passwordMutation.reset();
    passwordMutation.mutate(form, { onSuccess: () => setForm({ currentPassword: "", newPassword: "", confirmation: "" }) });
  };
  const fields: Array<{ name: PasswordField; label: string; autoComplete: string }> = [
    { name: "currentPassword", label: "Contraseña actual", autoComplete: "current-password" },
    { name: "newPassword", label: "Nueva contraseña", autoComplete: "new-password" },
    { name: "confirmation", label: "Confirmar nueva contraseña", autoComplete: "new-password" },
  ];

  return <div className="account-security-layout">
    <form className="account-security-form" onSubmit={submit}>
      <div className="account-section-heading"><LockKeyhole /><div><h3>Cambiar contraseña</h3><p>Verificaremos tu contraseña actual antes de actualizarla.</p></div></div>
      {fields.map((field) => <label key={field.name}>{field.label}<span className="account-password-field"><input type={visible[field.name] ? "text" : "password"} value={form[field.name]} autoComplete={field.autoComplete} onChange={(event) => setForm({ ...form, [field.name]: event.target.value })} required /><button type="button" onClick={() => setVisible({ ...visible, [field.name]: !visible[field.name] })} aria-label={visible[field.name] ? "Ocultar contraseña" : "Mostrar contraseña"}>{visible[field.name] ? <EyeOff /> : <Eye />}</button></span></label>)}
      <p className="account-password-help">Mínimo 8 caracteres, incluyendo al menos una letra y un número.</p>
      {passwordMutation.error && <p className="account-message account-message--error">{passwordMutation.error.message}</p>}
      {passwordMutation.isSuccess && <p className="account-message account-message--success">Contraseña actualizada correctamente.</p>}
      <button className="account-button account-button--primary" type="submit" disabled={passwordMutation.isPending}><KeyRound />{passwordMutation.isPending ? "Actualizando…" : "Actualizar contraseña"}</button>
    </form>
    <aside className="account-sessions-card">
      <div className="account-section-heading"><Laptop /><div><h3>Cerrar sesiones activas</h3><p>Cierra la sesión en todos tus demás dispositivos. La sesión actual continuará activa.</p></div></div>
      {sessionsMutation.error && <p className="account-message account-message--error">{sessionsMutation.error.message}</p>}
      {sessionsMutation.isSuccess && <p className="account-message account-message--success">Las otras sesiones se cerraron correctamente.</p>}
      <button className="account-button account-button--secondary" type="button" onClick={() => sessionsMutation.mutate()} disabled={sessionsMutation.isPending}>{sessionsMutation.isPending ? "Cerrando…" : "Cerrar otras sesiones"}</button>
    </aside>
  </div>;
}

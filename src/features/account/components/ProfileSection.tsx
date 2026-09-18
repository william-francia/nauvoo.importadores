import { useState, type FormEvent } from "react";
import { Mail, Pencil, Phone, ShieldCheck, UserRound } from "lucide-react";
import { accountDisplayName, accountInitial, roleLabel } from "../account.utils";
import { useUpdateMyProfile } from "../hooks/useCurrentAccount";
import type { CurrentAccount, UpdateProfileInput } from "../types/account.types";

export default function ProfileSection({ account }: { account: CurrentAccount }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<UpdateProfileInput>({ firstName: account.firstName ?? "", lastName: account.lastName ?? "", phone: account.phone ?? "" });
  const mutation = useUpdateMyProfile();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    mutation.reset();
    mutation.mutate(form, { onSuccess: () => setEditing(false) });
  };

  return <div className="account-profile-layout">
    <aside className="account-profile-summary">
      <span className="account-profile-summary__avatar">{accountInitial(account)}</span>
      <h3>{accountDisplayName(account)}</h3>
      <p>{roleLabel(account.role)}</p>
      <span className={`account-status ${account.active ? "" : "account-status--inactive"}`}>{account.active ? "Usuario activo" : "Usuario inactivo"}</span>
      <dl><div><dt><Mail />Correo electrónico</dt><dd>{account.email ?? "No disponible"}</dd></div><div><dt><Phone />Teléfono</dt><dd>{account.phone || "No registrado"}</dd></div><div><dt><ShieldCheck />Rol</dt><dd>{roleLabel(account.role)}</dd></div></dl>
    </aside>
    <form className="account-profile-form" onSubmit={submit}>
      <div className="account-section-heading"><UserRound /><div><h3>Datos personales</h3><p>Puedes actualizar únicamente tus datos seguros.</p></div></div>
      {!account.profileId && <p className="account-message account-message--error">La cuenta no tiene un perfil asociado. Aplica la migración de cuentas para crearlo.</p>}
      <label>Nombre<input value={form.firstName} disabled={!editing} onChange={(event) => setForm({ ...form, firstName: event.target.value })} /></label>
      <label>Apellidos<input value={form.lastName} disabled={!editing} onChange={(event) => setForm({ ...form, lastName: event.target.value })} /></label>
      <label>Correo electrónico<input value={account.email ?? "No disponible"} disabled /></label>
      <label>Teléfono<input value={form.phone} disabled={!editing} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="No registrado" /></label>
      {mutation.error && <p className="account-message account-message--error">{mutation.error.message}</p>}
      {mutation.isSuccess && <p className="account-message account-message--success">Datos actualizados correctamente.</p>}
      <div className="account-form-actions">
        {editing ? <><button className="account-button account-button--secondary" type="button" onClick={() => setEditing(false)}>Cancelar</button><button className="account-button account-button--primary" type="submit" disabled={mutation.isPending || !account.profileId}>{mutation.isPending ? "Guardando…" : "Guardar cambios"}</button></> : <button className="account-button account-button--primary" type="button" onClick={() => setEditing(true)} disabled={!account.profileId}><Pencil />Editar datos</button>}
      </div>
    </form>
  </div>;
}

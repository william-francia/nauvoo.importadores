import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronRight, KeyRound, LogOut, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import { accountDisplayName, accountInitial, roleLabel } from "../account.utils";
import { signOutCurrentSession } from "../services/account.service";
import type { AccountSection, CurrentAccount } from "../types/account.types";
import "../account.css";

interface UserAccountControlProps {
  account?: CurrentAccount;
  isLoading: boolean;
  errorMessage?: string;
  onOpenSection: (section: AccountSection) => void;
}

export default function UserAccountControl({ account, isLoading, errorMessage, onOpenSection }: UserAccountControlProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const signOut = useMutation({ mutationFn: signOutCurrentSession });

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const selectSection = (section: AccountSection) => {
    setOpen(false);
    onOpenSection(section);
  };
  const displayName = account ? accountDisplayName(account) : isLoading ? "Cargando…" : "Cuenta";

  return <div className="user-account-control" ref={containerRef}>
    <button className="user-account-trigger" type="button" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open} disabled={!account && isLoading}>
      <span className="user-text"><span>Bienvenido</span><strong>{displayName}</strong></span>
      <span className="user-avatar">{account ? accountInitial(account) : "…"}</span>
    </button>
    {open && <div className="user-account-menu" role="menu">
      {account ? <>
        <div className="user-account-menu__identity"><span className="user-account-menu__avatar">{accountInitial(account)}</span><div><strong>{accountDisplayName(account)}</strong><small>{account.email ?? "Correo no disponible"}</small></div></div>
        <div className="user-account-menu__role"><ShieldCheck /><div><span>Nivel de rol</span><strong>{roleLabel(account.role)}</strong><small>{account.active ? "Cuenta activa" : "Cuenta inactiva"}</small></div></div>
        <nav>
          <MenuButton icon={<UserRound />} label="Mi perfil" onClick={() => selectSection("profile")} />
          <MenuButton icon={<ShieldCheck />} label="Seguridad" onClick={() => selectSection("security")} />
          <MenuButton icon={<KeyRound />} label="Cambiar contraseña" onClick={() => selectSection("security")} />
          <MenuButton icon={<UsersRound />} label="Permisos y accesos" onClick={() => selectSection("permissions")} />
        </nav>
        {signOut.error && <p className="user-account-menu__error">{signOut.error.message}</p>}
        <button className="user-account-menu__logout" type="button" onClick={() => signOut.mutate()} disabled={signOut.isPending}><LogOut />{signOut.isPending ? "Cerrando…" : "Cerrar sesión"}</button>
      </> : <p className="user-account-menu__error">{errorMessage ?? "No se pudo cargar la cuenta."}</p>}
    </div>}
  </div>;
}

function MenuButton({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return <button type="button" role="menuitem" onClick={onClick}>{icon}<span>{label}</span><ChevronRight /></button>;
}

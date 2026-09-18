import { useEffect, useState } from "react";
import { LockKeyhole, ShieldCheck, UserRound, X } from "lucide-react";
import type { AccountSection, CurrentAccount } from "../types/account.types";
import PermissionsSection from "./PermissionsSection";
import ProfileSection from "./ProfileSection";
import SecuritySection from "./SecuritySection";
import "../account.css";

interface AccountModalProps {
  account: CurrentAccount;
  initialSection: AccountSection;
  onClose: () => void;
}

export default function AccountModal({ account, initialSection, onClose }: AccountModalProps) {
  const [section, setSection] = useState<AccountSection>(initialSection);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  const tabs = [
    { id: "profile" as const, label: "Perfil", icon: <UserRound /> },
    { id: "security" as const, label: "Seguridad", icon: <LockKeyhole /> },
    { id: "permissions" as const, label: "Permisos", icon: <ShieldCheck /> },
  ];

  return <div className="account-modal-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="account-modal" role="dialog" aria-modal="true" aria-labelledby="account-modal-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="account-modal__header"><h2 id="account-modal-title">Mi perfil</h2><button type="button" onClick={onClose} aria-label="Cerrar"><X /></button></header>
      <div className="account-modal__tabs" role="tablist">{tabs.map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={section === tab.id} className={section === tab.id ? "active" : ""} onClick={() => setSection(tab.id)}>{tab.icon}{tab.label}</button>)}</div>
      <div className="account-modal__content">
        {section === "profile" && <ProfileSection account={account} />}
        {section === "security" && <SecuritySection account={account} />}
        {section === "permissions" && <PermissionsSection account={account} />}
      </div>
    </section>
  </div>;
}

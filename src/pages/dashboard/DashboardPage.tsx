import { lazy, Suspense, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import "./DashboardPage.css";
import ClientesPage from "../clientes/ClientesPage";
import NuevaVentaPage from "../../features/ventas/NuevaVentaPage";
import GestionVentasPage from "../../features/ventas/GestionVentasPage";
import GestionProductosPage from "../productos/GestionProductosPage";
import ProductoFormPage from "../productos/ProductoFormPage";
import InventarioProductosPage from "../productos/InventarioProductosPage";
import ReportesPage from "../productos/ReportesPage";
import { supabase } from "../../lib/supabase";
import logo from "../../assets/logo sin linea .png";
import { usePermissions } from "../../features/account/hooks/useCurrentAccount";
import type { AccountSection } from "../../features/account/types/account.types";

const DashboardHome = lazy(() => import("../../features/dashboard/DashboardHome"));
const UserAccountControl = lazy(() => import("../../features/account/components/UserAccountControl"));
const AccountModal = lazy(() => import("../../features/account/components/AccountModal"));
const FacturasPage = lazy(() => import("../facturas/FacturasPage"));
const ContingenciasPage = lazy(() => import("../facturas/ContingenciasPage"));
const RegistrarVentaOfflinePage = lazy(() => import("../facturas/RegistrarVentaOfflinePage"));
const VentasOfflinePage = lazy(() => import("../facturas/VentasOfflinePage"));
const EventosPage = lazy(() => import("../facturas/EventosPage"));

type MenuItem = "dashboard" | "ventas" | "productos" | "clientes";

export default function DashboardPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const rutaActual = location.pathname.replace(/\/+$/, "") || "/";
  const ventasActiva = rutaActual.startsWith("/ventas/");
  const productosActiva = rutaActual.startsWith("/productos/");
  const clientesActiva = rutaActual === "/clientes";
  const facturasActiva = rutaActual === "/facturas" || rutaActual.startsWith("/facturas/");
  const offlineActiva = rutaActual.startsWith("/facturas/offline/");
  const gestionProductosActiva =
    rutaActual === "/productos/gestion" ||
    rutaActual === "/productos/nuevo" ||
    rutaActual.endsWith("/editar");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeItem, setActiveItem] = useState<MenuItem>("dashboard");
  const [ventasOpen, setVentasOpen] = useState(ventasActiva);
  const [productosOpen, setProductosOpen] = useState(productosActiva);
  const [clientesOpen, setClientesOpen] = useState(clientesActiva);
  const [facturasOpen, setFacturasOpen] = useState(facturasActiva);
  const [offlineOpen, setOfflineOpen] = useState(offlineActiva);
  const [accountSection, setAccountSection] = useState<AccountSection | null>(null);
  const account = usePermissions();
  const canUseSales = account.canAny("sales.read", "sales.create");
  const canUseProducts = account.canAny("products.read", "inventory.read", "history.read");
  const canUseInvoices = account.can("invoices.read");
  const requiredPermission = getRequiredPermission(rutaActual, activeItem);
  const routeAllowed = !requiredPermission || account.can(requiredPermission);

  return (
    <div className="dashboard">
      {/* =========================
          SIDEBAR
      ========================== */}
      <aside className={`sidebar ${sidebarOpen ? "open" : "closed"}`}>
        <div className="sidebar-header">
          <div className="brand-icon" aria-label="Logo Nauvoo Importadores">
            <div className="logo-frame">
              <img src={logo} alt="Nauvoo Importadores" />
              <span className="logo-shine" aria-hidden="true" />
            </div>
          </div>

          {sidebarOpen && (
            <div className="brand-text">
              <strong>FERRETERÍA</strong>
              <span>FRANCIA</span>
            </div>
          )}
        </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-item ${
              activeItem === "dashboard" ? "active" : ""
            }`}
            onClick={() => {
              setActiveItem("dashboard");
              navigate("/dashboard");
            }}
          >
            <span className="nav-icon">
              <HomeIcon />
            </span>

            {sidebarOpen && <span>Página Principal</span>}
          </button>

          {sidebarOpen && <p className="nav-section">TRANSACCIONES</p>}

          {canUseSales && <>
          <button
            className={`nav-item ${ventasActiva ? "active" : ""}`}
            onClick={() => {
              if (!sidebarOpen) {
                setSidebarOpen(true);
                setVentasOpen(true);
                return;
              }
              setVentasOpen((actual) => !actual);
            }}
          >
            <span className="nav-icon">
              <CartIcon />
            </span>

            {sidebarOpen && <span>Ventas</span>}

            {sidebarOpen && (
              <span className={`nav-chevron ${ventasOpen ? "open" : ""}`}>
                ›
              </span>
            )}
          </button>

          {sidebarOpen && ventasOpen && (
            <div className="nav-submenu">
              {account.can("sales.create") && (
              <button
                className={`nav-subitem ${location.pathname === "/ventas/nueva" ? "active" : ""}`}
                onClick={() => navigate("/ventas/nueva")}
              >
                Registrar venta
              </button>
              )}
              {account.can("sales.read") && (
              <button
                className={`nav-subitem ${location.pathname === "/ventas/gestion" ? "active" : ""}`}
                onClick={() => navigate("/ventas/gestion")}
              >
                Gestión de ventas
              </button>
              )}
            </div>
          )}
          </>}

          {canUseProducts && <>
          <button
            className={`nav-item ${productosActiva ? "active" : ""}`}
            onClick={() => {
              if (!sidebarOpen) {
                setSidebarOpen(true);
                setProductosOpen(true);
                return;
              }
              setProductosOpen((actual) => !actual);
            }}
          >
            <span className="nav-icon">
              <BoxIcon />
            </span>

            {sidebarOpen && <span>Productos</span>}

            {sidebarOpen && (
              <span className={`nav-chevron ${productosOpen ? "open" : ""}`}>
                ›
              </span>
            )}
          </button>

          {sidebarOpen && productosOpen && (
            <div className="nav-submenu">
              {account.can("products.read") && (
              <button
                className={`nav-subitem ${gestionProductosActiva ? "active" : ""}`}
                onClick={() => navigate("/productos/gestion")}
              >
                Gestión de productos
              </button>
              )}
              {account.can("inventory.read") && (
              <button
                className={`nav-subitem ${rutaActual === "/productos/inventario" ? "active" : ""}`}
                onClick={() => navigate("/productos/inventario")}
              >
                Inventario de productos
              </button>
              )}
              {account.can("history.read") && (
              <button
                className={`nav-subitem ${rutaActual === "/productos/reportes" ? "active" : ""}`}
                onClick={() => navigate("/productos/reportes")}
              >
                Reportes
              </button>
              )}
            </div>
          )}
          </>}

          {account.can("clients.read") && <>
          <button
            className={`nav-item ${clientesActiva ? "active" : ""}`}
            onClick={() => {
              if (!sidebarOpen) {
                setSidebarOpen(true);
                setClientesOpen(true);
                return;
              }
              setClientesOpen((actual) => !actual);
            }}
          >
            <span className="nav-icon">
              <UsersIcon />
            </span>

            {sidebarOpen && <span>Clientes</span>}

            {sidebarOpen && (
              <span className={`nav-chevron ${clientesOpen ? "open" : ""}`}>
                {"\u203a"}
                {/*
                â€º
                */}
              </span>
            )}
          </button>

          {sidebarOpen && clientesOpen && (
            <div className="nav-submenu">
              <button
                className={`nav-subitem nav-subitem--clients ${clientesActiva ? "active" : ""}`}
                aria-label={"Gesti\u00f3n de clientes"}
                onClick={() => {
                  setActiveItem("clientes");
                  navigate("/clientes");
                }}
              >
                {"Gestión de clientes"}
                {/*
                GestiÃ³n de clientes
                */}
              </button>
            </div>
          )}
          </>}

          {canUseInvoices && <>
          <button
            className={`nav-item ${facturasActiva ? "active" : ""}`}
            onClick={() => {
              if (!sidebarOpen) {
                setSidebarOpen(true);
                setFacturasOpen(true);
                return;
              }
              setFacturasOpen((actual) => !actual);
            }}
          >
            <span className="nav-icon"><ReceiptIcon /></span>
            {sidebarOpen && <span>Facturas</span>}
            {sidebarOpen && <span className={`nav-chevron ${facturasOpen ? "open" : ""}`}>›</span>}
          </button>

          {sidebarOpen && facturasOpen && (
            <div className="nav-submenu">
              <button className={`nav-subitem ${rutaActual === "/facturas" ? "active" : ""}`} onClick={() => navigate("/facturas")}>Gestión de facturas</button>
              {account.can("invoices.issue") && <>
              <button className={`nav-subitem ${rutaActual === "/facturas/contingencias" ? "active" : ""}`} onClick={() => navigate("/facturas/contingencias")}>Contingencias</button>
              <button className={`nav-subgroup-trigger ${offlineActiva ? "active" : ""}`} onClick={() => setOfflineOpen((actual) => !actual)}>
                <span>Fuera de línea</span><span className={`nav-chevron ${offlineOpen ? "open" : ""}`}>›</span>
              </button>
              {offlineOpen && <div className="nav-submenu nav-submenu--nested">
                <button className={`nav-subitem ${rutaActual === "/facturas/offline/nueva" ? "active" : ""}`} onClick={() => navigate("/facturas/offline/nueva")}>Registrar venta offline</button>
                <button className={`nav-subitem ${rutaActual === "/facturas/offline/ventas" ? "active" : ""}`} onClick={() => navigate("/facturas/offline/ventas")}>Gestión de ventas offline</button>
                <button className={`nav-subitem ${rutaActual === "/facturas/offline/eventos" ? "active" : ""}`} onClick={() => navigate("/facturas/offline/eventos")}>Gestión de eventos</button>
              </div>}
              </>}
            </div>
          )}
          </>}
        </nav>

        {sidebarOpen && (
          <div className="sidebar-footer">
            <button
              className="logout-button"
              type="button"
              onClick={() => void supabase.auth.signOut()}
              title="Cerrar sesión"
            >
              <LogoutIcon />
              <span>Cerrar sesión</span>
            </button>

            <span className="status-dot"></span>
            Sistema conectado
          </div>
        )}
      </aside>

      {/* =========================
          CONTENIDO
      ========================== */}
      <div className="dashboard-content">
        {/* TOPBAR */}
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="menu-button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label="Abrir o cerrar menú"
            >
              <MenuIcon />
            </button>

            <div className="business-info">
              <strong>Ferretería Francia</strong>
              <span>Sistema de administración</span>
            </div>
          </div>

          <div className="topbar-right">
            <button className="notification-button">
              <BellIcon />
              <span className="notification-dot"></span>
            </button>

            <Suspense fallback={<div className="user-avatar">…</div>}>
              <UserAccountControl
                key={location.key}
                account={account.data}
                isLoading={account.isLoading}
                errorMessage={account.error?.message}
                onOpenSection={setAccountSection}
              />
            </Suspense>
          </div>
        </header>

        {/* =========================
            MAIN
        ========================== */}
        <main className="main-content">
          {requiredPermission && account.isLoading && <AccountAccessState title="Cargando acceso…" description="Estamos validando los permisos de tu cuenta." />}
          {requiredPermission && account.isError && <AccountAccessState title="No se pudo validar el acceso" description={account.error.message} />}
          {requiredPermission && !account.isLoading && !account.isError && !routeAllowed && <AccountAccessState title="Acceso restringido" description="Tu rol no tiene permiso para abrir este módulo o ejecutar esta acción." />}

          {routeAllowed && rutaActual === "/ventas/nueva" && <NuevaVentaPage />}

          {routeAllowed && rutaActual === "/ventas/gestion" && <GestionVentasPage />}

          {routeAllowed && rutaActual === "/productos/gestion" && <GestionProductosPage />}

          {routeAllowed && (rutaActual === "/productos/nuevo" || rutaActual.endsWith("/editar")) && <ProductoFormPage />}

          {routeAllowed && rutaActual === "/productos/inventario" && <InventarioProductosPage />}

          {routeAllowed && rutaActual === "/productos/reportes" && <ReportesPage />}

          {routeAllowed && clientesActiva && <ClientesPage />}

          {routeAllowed && facturasActiva && <Suspense fallback={<div className="siat-state">Cargando módulo fiscal…</div>}>
            {rutaActual === "/facturas" && <FacturasPage />}
            {rutaActual === "/facturas/contingencias" && <ContingenciasPage />}
            {rutaActual === "/facturas/offline/nueva" && <RegistrarVentaOfflinePage />}
            {rutaActual === "/facturas/offline/ventas" && <VentasOfflinePage />}
            {rutaActual === "/facturas/offline/eventos" && <EventosPage />}
          </Suspense>}

          {!ventasActiva && !productosActiva && !clientesActiva && !facturasActiva && activeItem === "dashboard" && (
            <Suspense fallback={<div className="business-dashboard-state">Cargando Dashboard…</div>}>
              <DashboardHome />
            </Suspense>
          )}

          {!ventasActiva && !productosActiva && !clientesActiva && !facturasActiva && activeItem === "ventas" && (
            <PlaceholderPage
              title="Ventas"
              description="Desde aquí administraremos las ventas y facturación."
              icon={<CartIcon />}
            />
          )}

          {!ventasActiva && !productosActiva && !clientesActiva && !facturasActiva && activeItem === "productos" && (
            <PlaceholderPage
              title="Productos"
              description="Desde aquí administraremos el inventario y los productos."
              icon={<BoxIcon />}
            />
          )}

        </main>
      </div>
      {accountSection && account.data && (
        <Suspense fallback={null}>
          <AccountModal account={account.data} initialSection={accountSection} onClose={() => setAccountSection(null)} />
        </Suspense>
      )}
    </div>
  );
}

function getRequiredPermission(path: string, activeItem: MenuItem): string | null {
  if (path === "/ventas/nueva") return "sales.create";
  if (path === "/ventas/gestion") return "sales.read";
  if (path === "/productos/nuevo") return "products.create";
  if (path.startsWith("/productos/") && path.endsWith("/editar")) return "products.update";
  if (path === "/productos/gestion") return "products.read";
  if (path === "/productos/inventario") return "inventory.read";
  if (path === "/productos/reportes") return "history.read";
  if (path === "/clientes") return "clients.read";
  if (path.startsWith("/facturas/offline/") || path === "/facturas/contingencias") return "invoices.issue";
  if (path === "/facturas" || path.startsWith("/facturas/")) return "invoices.read";
  if (activeItem === "clientes") return "clients.read";
  return null;
}

function AccountAccessState({ title, description }: { title: string; description: string }) {
  return <section className="account-access-state"><div><h2>{title}</h2><p>{description}</p></div></section>;
}

/* =========================================================
   PLACEHOLDER
========================================================= */

interface PlaceholderProps {
  title: string;
  description: string;
  icon: React.ReactNode;
}

function PlaceholderPage({
  title,
  description,
  icon,
}: PlaceholderProps) {
  return (
    <section className="placeholder-page">
      <div className="placeholder-icon">{icon}</div>

      <h1>{title}</h1>

      <p>{description}</p>

      <span>Esta sección la construiremos a continuación.</span>
    </section>
  );
}

/* =========================================================
   ICONOS SVG
========================================================= */

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="M4 6h16M4 12h16M4 18h16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CartIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 1.9-1.4L21 7H6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <circle cx="10" cy="20" r="1.2" fill="currentColor" />
      <circle cx="18" cy="20" r="1.2" fill="currentColor" />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="m4 7 8-4 8 4-8 4zM4 7v10l8 4 8-4V7M12 11v10"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <circle
        cx="9"
        cy="8"
        r="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />

      <path
        d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M16 5.5a3 3 0 0 1 0 5.8M17 14c2.3.7 4 2.8 4 5.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ReceiptIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5M14 8l4 4-4 4M9 12h9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

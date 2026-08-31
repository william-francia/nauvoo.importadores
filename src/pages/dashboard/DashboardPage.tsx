import { useState } from "react";
import "./DashboardPage.css";

type MenuItem = "dashboard" | "ventas" | "productos" | "clientes";

export default function DashboardPage() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeItem, setActiveItem] = useState<MenuItem>("dashboard");

  return (
    <div className="dashboard">
      {/* =========================
          SIDEBAR
      ========================== */}
      <aside className={`sidebar ${sidebarOpen ? "open" : "closed"}`}>
        <div className="sidebar-header">
          <div className="brand-icon">F</div>

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
            onClick={() => setActiveItem("dashboard")}
          >
            <span className="nav-icon">
              <HomeIcon />
            </span>

            {sidebarOpen && <span>Página Principal</span>}
          </button>

          {sidebarOpen && <p className="nav-section">TRANSACCIONES</p>}

          <button
            className={`nav-item ${activeItem === "ventas" ? "active" : ""}`}
            onClick={() => setActiveItem("ventas")}
          >
            <span className="nav-icon">
              <CartIcon />
            </span>

            {sidebarOpen && <span>Ventas</span>}
          </button>

          <button
            className={`nav-item ${
              activeItem === "productos" ? "active" : ""
            }`}
            onClick={() => setActiveItem("productos")}
          >
            <span className="nav-icon">
              <BoxIcon />
            </span>

            {sidebarOpen && <span>Productos</span>}
          </button>

          <button
            className={`nav-item ${
              activeItem === "clientes" ? "active" : ""
            }`}
            onClick={() => setActiveItem("clientes")}
          >
            <span className="nav-icon">
              <UsersIcon />
            </span>

            {sidebarOpen && <span>Clientes</span>}
          </button>
        </nav>

        {sidebarOpen && (
          <div className="sidebar-footer">
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

            <div className="user-info">
              <div className="user-text">
                <span>Bienvenido</span>
                <strong>Administrador</strong>
              </div>

              <div className="user-avatar">A</div>
            </div>
          </div>
        </header>

        {/* =========================
            MAIN
        ========================== */}
        <main className="main-content">
          {activeItem === "dashboard" && <DashboardHome />}

          {activeItem === "ventas" && (
            <PlaceholderPage
              title="Ventas"
              description="Desde aquí administraremos las ventas y facturación."
              icon={<CartIcon />}
            />
          )}

          {activeItem === "productos" && (
            <PlaceholderPage
              title="Productos"
              description="Desde aquí administraremos el inventario y los productos."
              icon={<BoxIcon />}
            />
          )}

          {activeItem === "clientes" && (
            <PlaceholderPage
              title="Clientes"
              description="Desde aquí administraremos los clientes registrados."
              icon={<UsersIcon />}
            />
          )}
        </main>
      </div>
    </div>
  );
}

/* =========================================================
   DASHBOARD PRINCIPAL
========================================================= */

function DashboardHome() {
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="breadcrumb">Inicio / Dashboard</p>
          <h1>Página Principal</h1>
          <p className="page-description">
            Resumen general de Ferretería Francia.
          </p>
        </div>

        <div className="heading-status">
          <span className="status-dot"></span>
          Sistema activo
        </div>
      </section>

      {/* CARDS */}
      <section className="stats-grid">
        <article className="stat-card">
          <div className="stat-card-top">
            <div className="stat-icon">
              <CartIcon />
            </div>

            <span className="stat-badge">Hoy</span>
          </div>

          <div className="stat-content">
            <p>Ventas del día</p>
            <h2>Bs 0.00</h2>
            <span>0 ventas realizadas</span>
          </div>
        </article>

        <article className="stat-card">
          <div className="stat-card-top">
            <div className="stat-icon">
              <BoxIcon />
            </div>

            <span className="stat-badge">Inventario</span>
          </div>

          <div className="stat-content">
            <p>Productos</p>
            <h2>0</h2>
            <span>Productos registrados</span>
          </div>
        </article>

        <article className="stat-card">
          <div className="stat-card-top">
            <div className="stat-icon">
              <UsersIcon />
            </div>

            <span className="stat-badge">Total</span>
          </div>

          <div className="stat-content">
            <p>Clientes</p>
            <h2>0</h2>
            <span>Clientes registrados</span>
          </div>
        </article>
      </section>

      {/* CONTENIDO INFERIOR */}
      <section className="dashboard-bottom">
        <div className="recent-panel">
          <div className="panel-header">
            <div>
              <h3>Ventas recientes</h3>
              <p>Últimos movimientos realizados</p>
            </div>

            <button className="secondary-button">Ver todas</button>
          </div>

          <div className="empty-state">
            <div className="empty-icon">
              <ReceiptIcon />
            </div>

            <h4>Todavía no hay ventas</h4>

            <p>
              Cuando registres una venta aparecerá automáticamente en esta
              sección.
            </p>

            <button className="primary-button">
              <PlusIcon />
              Nueva venta
            </button>
          </div>
        </div>

        <div className="quick-panel">
          <div className="panel-header">
            <div>
              <h3>Acciones rápidas</h3>
              <p>Accesos principales</p>
            </div>
          </div>

          <div className="quick-actions">
            <button className="quick-action">
              <span>
                <CartIcon />
              </span>

              <div>
                <strong>Nueva venta</strong>
                <small>Registrar una nueva venta</small>
              </div>

              <ArrowIcon />
            </button>

            <button className="quick-action">
              <span>
                <BoxIcon />
              </span>

              <div>
                <strong>Nuevo producto</strong>
                <small>Agregar producto al inventario</small>
              </div>

              <ArrowIcon />
            </button>

            <button className="quick-action">
              <span>
                <UsersIcon />
              </span>

              <div>
                <strong>Nuevo cliente</strong>
                <small>Registrar un nuevo cliente</small>
              </div>

              <ArrowIcon />
            </button>
          </div>
        </div>
      </section>
    </>
  );
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

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="M12 5v14M5 12h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path
        d="m9 18 6-6-6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
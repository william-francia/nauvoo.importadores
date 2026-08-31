import { supabase } from '../../lib/supabase'

type DashboardPageProps = {
  email: string
}

export function DashboardPage({ email }: DashboardPageProps) {
  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <main className="shell">
      <section className="panel panel--wide">
        <div className="dashboard-header">
          <div>
            <span className="eyebrow">Panel privado</span>
            <h1>Bienvenido a Nuvoo Importadores</h1>
            <p className="muted">
              Sesion iniciada como <strong>{email}</strong>.
            </p>
          </div>
          <button type="button" className="ghost-button" onClick={handleSignOut}>
            Cerrar sesion
          </button>
        </div>

        <div className="dashboard-grid">
          <article className="card">
            <span className="card-label">Ventas</span>
            <h2>Registro rapido</h2>
            <p>Desde aqui ya podemos proteger rutas y traer datos reales desde Supabase.</p>
          </article>
          <article className="card">
            <span className="card-label">Inventario</span>
            <h2>Control de stock</h2>
            <p>El login ya quedo conectado; el siguiente paso seria enlazar tablas y permisos.</p>
          </article>
          <article className="card">
            <span className="card-label">Estado</span>
            <h2>Sesion persistente</h2>
            <p>Si recargas la pagina, Supabase vuelve a hidratar la sesion automaticamente.</p>
          </article>
        </div>
      </section>
    </main>
  )
}

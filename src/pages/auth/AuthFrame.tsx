import type { ReactNode } from 'react'
import { LogoImpact } from '../../components/LogoImpact'

type AuthFrameProps = {
  children: ReactNode
}

export function AuthFrame({ children }: AuthFrameProps) {
  return (
    <main className="shell">
      <section className="auth-card">
        <aside className="auth-showcase">
          <div className="brand-line">
            <span className="brand-status-dot" />
            <span>Sistema de gestion</span>
          </div>
          <LogoImpact />
          <div className="showcase-copy">
            <span className="eyebrow">Panel empresarial</span>
            <h1>Tecnologia aplicada xd.</h1>
            <p>Ventas, inventario y facturacion desde un solo lugar.</p>
          </div>
        </aside>

        <div className="auth-content">{children}</div>
      </section>
    </main>
  )
}

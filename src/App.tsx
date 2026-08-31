import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Navigate, Route, Routes } from 'react-router'
import './App.css'
import { supabase, supabaseConfigError } from './lib/supabase'
import { LoginPage } from './pages/auth/LoginPage'
import { RegisterPage } from './pages/auth/RegisterPage'
import DashboardPage from './pages/dashboard/DashboardPage'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let isMounted = true

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (isMounted) {
          setSession(data.session)
          setIsLoading(false)
        }
      })
      .catch(() => {
        if (isMounted) {
          setIsLoading(false)
        }
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setIsLoading(false)
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
    }
  }, [])

  if (supabaseConfigError) {
    return (
      <main className="shell">
        <section className="panel panel--narrow">
          <span className="eyebrow">Configuracion pendiente</span>
          <h1>Faltan las credenciales de Supabase</h1>
          <p>
            Agrega <code>VITE_SUPABASE_URL</code> y{' '}
            <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> en tu archivo <code>.env</code>{' '}
            local.
          </p>
        </section>
      </main>
    )
  }

  if (isLoading) {
    return (
      <main className="shell">
        <section className="panel panel--narrow">
          <span className="eyebrow">Nauvoo Importadores</span>
          <h1>Verificando sesion...</h1>
        </section>
      </main>
    )
  }

  if (session) {
    return (
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    )
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  )
}

export default App

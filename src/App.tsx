<<<<<<< HEAD
import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Navigate, Route, Routes } from 'react-router'
import './App.css'
import { LoginPage } from './pages/auth/LoginPage'
import { RegisterPage } from './pages/auth/RegisterPage'
import { DashboardPage } from './pages/dashboard/DashboardPage'
import { supabase, supabaseConfigError } from './lib/supabase'

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
          <span className="eyebrow">Nuvoo Importadores</span>
          <h1>Verificando sesion...</h1>
        </section>
      </main>
    )
  }

  if (session) {
    return (
      <Routes>
        <Route
          path="*"
          element={<DashboardPage email={session.user.email ?? 'usuario@empresa.com'} />}
        />
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
=======
import DashboardPage from "./pages/dashboard/DashboardPage";

function App() {
  // Acceso directo temporal al dashboard mientras se implementa el login.
  return <DashboardPage />;
>>>>>>> 9200f9aaa36e727c45d4fea581893a5e3a5b789c
}

export default App

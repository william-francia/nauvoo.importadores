import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react'
import { Link } from 'react-router'
import { AuthFrame } from './AuthFrame'
import { supabase } from '../../lib/supabase'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError) {
      setError(signInError.message)
    }

    setIsSubmitting(false)
  }

  return (
    <AuthFrame>
      <div className="auth-heading">
        <span className="eyebrow">Acceso seguro</span>
        <h2>Bienvenido de vuelta</h2>
        <p className="muted">Ingresa tus datos para continuar al panel.</p>
      </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <label className="auth-field">
              Correo
              <span className="input-wrap">
                <Mail className="field-icon" size={19} aria-hidden="true" />
                <input
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="nombre@empresa.com"
                  autoComplete="email"
                  required
                />
              </span>
            </label>

            <label className="auth-field">
              Contrasena
              <span className="input-wrap">
                <LockKeyhole className="field-icon" size={19} aria-hidden="true" />
                <input
                  type={isPasswordVisible ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Tu contrasena"
                  autoComplete="current-password"
                  minLength={6}
                  required
                />
                <button
                  className="password-toggle"
                  type="button"
                  onClick={() => setIsPasswordVisible((visible) => !visible)}
                  aria-label={isPasswordVisible ? 'Ocultar contrasena' : 'Mostrar contrasena'}
                >
                  {isPasswordVisible ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </span>
            </label>

            {error ? <p className="error-banner">{error}</p> : null}

            <button type="submit" className="primary-button" disabled={isSubmitting}>
              <span>{isSubmitting ? 'Ingresando...' : 'Entrar al panel'}</span>
              <ArrowRight size={19} aria-hidden="true" />
            </button>
          </form>

      <p className="auth-switch">
        Aun no tienes una cuenta? <Link to="/register">Crea una ahora</Link>
      </p>
    </AuthFrame>
  )
}

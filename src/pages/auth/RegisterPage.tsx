import { useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail } from 'lucide-react'
import { Link } from 'react-router'
import { supabase } from '../../lib/supabase'
import { AuthFrame } from './AuthFrame'

export function RegisterPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [isPasswordVisible, setIsPasswordVisible] = useState(false)
  const [isConfirmationVisible, setIsConfirmationVisible] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setNotice(null)

    if (password !== confirmPassword) {
      setError('Las contrasenas no coinciden.')
      return
    }

    setIsSubmitting(true)

    const { data, error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
      },
    })

    if (signUpError) {
      setError(signUpError.message)
    } else if (!data.session) {
      setNotice('Revisa tu correo y confirma tu cuenta para poder entrar.')
    }

    setIsSubmitting(false)
  }

  return (
    <AuthFrame>
      <div className="auth-heading">
        <span className="eyebrow">Nueva cuenta</span>
        <h2>Empieza con Nuvoo</h2>
        <p className="muted">Crea tus credenciales para acceder al panel empresarial.</p>
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
              placeholder="Minimo 6 caracteres"
              autoComplete="new-password"
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

        <label className="auth-field">
          Repite tu contrasena
          <span className="input-wrap">
            <LockKeyhole className="field-icon" size={19} aria-hidden="true" />
            <input
              type={isConfirmationVisible ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              placeholder="Repite tu contrasena"
              autoComplete="new-password"
              minLength={6}
              required
            />
            <button
              className="password-toggle"
              type="button"
              onClick={() => setIsConfirmationVisible((visible) => !visible)}
              aria-label={isConfirmationVisible ? 'Ocultar contrasena' : 'Mostrar contrasena'}
            >
              {isConfirmationVisible ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
        </label>

        {error ? <p className="error-banner">{error}</p> : null}
        {notice ? <p className="notice-banner">{notice}</p> : null}

        <button type="submit" className="primary-button" disabled={isSubmitting}>
          <span>{isSubmitting ? 'Creando cuenta...' : 'Crear mi cuenta'}</span>
          <ArrowRight size={19} aria-hidden="true" />
        </button>
      </form>

      <p className="auth-switch">
        Ya tienes una cuenta? <Link to="/login">Inicia sesion</Link>
      </p>
    </AuthFrame>
  )
}

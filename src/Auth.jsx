import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { sb, call, useAuth } from './lib.jsx'

export function Login() {
  const { session } = useAuth()
  const [mode, setMode] = useState('login') // login | signup | magic
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  if (session) return <Navigate to="/" replace />

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    try {
      const redirect = { emailRedirectTo: location.origin }
      if (mode === 'login') await call(sb.auth.signInWithPassword({ email, password }))
      if (mode === 'signup') {
        const data = await call(sb.auth.signUp({ email, password, options: { ...redirect, data: { name } } }))
        if (!data.session) setMsg('Listo. Revisa tu correo para confirmar la cuenta.')
      }
      if (mode === 'magic') {
        await call(sb.auth.signInWithOtp({ email, options: redirect }))
        setMsg('Te enviamos un enlace a tu correo. Ábrelo en este dispositivo.')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth card">
      <h1>Intercambia libros con gente cerca de ti</h1>
      <div className="tabs">
        <button className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Entrar</button>
        <button className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>Crear cuenta</button>
        <button className={mode === 'magic' ? 'on' : ''} onClick={() => setMode('magic')}>Enlace mágico</button>
      </div>
      <form onSubmit={submit} className="stack">
        {mode === 'signup' && (
          <label>Tu nombre<input value={name} onChange={e => setName(e.target.value)} required maxLength={80} /></label>
        )}
        <label>Correo<input type="email" value={email} onChange={e => setEmail(e.target.value)} required autoComplete="email" /></label>
        {mode !== 'magic' && (
          <label>Contraseña
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={6}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
          </label>
        )}
        <button className="btn primary" disabled={busy}>
          {mode === 'login' ? 'Entrar' : mode === 'signup' ? 'Crear cuenta' : 'Enviarme el enlace'}
        </button>
        {mode === 'login' && <p className="small muted">¿Olvidaste la contraseña? Usa el enlace mágico y cámbiala en tu perfil.</p>}
        {msg && <p className="ok">{msg}</p>}
      </form>
    </div>
  )
}

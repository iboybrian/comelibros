import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { sb, useAuth } from './lib.jsx'

// Mismos ids que el check de books.category en supabase/003_categorias.sql
export const CATEGORIES = [
  { id: 'novela', emoji: '📖', label: 'Novela y narrativa', hue: 18 },
  { id: 'misterio', emoji: '🕵️', label: 'Misterio y thriller', hue: 262 },
  { id: 'juvenil', emoji: '🧙', label: 'Juvenil y fantasía', hue: 292 },
  { id: 'clasicos', emoji: '🏛️', label: 'Clásicos', hue: 38 },
  { id: 'psicologia', emoji: '🧠', label: 'Psicología y autoayuda', hue: 335 },
  { id: 'negocios', emoji: '💼', label: 'Negocios', hue: 205 },
  { id: 'historia', emoji: '🗺️', label: 'Historia y sociedad', hue: 140 },
  { id: 'religion', emoji: '🙏', label: 'Religión y espiritualidad', hue: 52 },
  { id: 'arte', emoji: '🎨', label: 'Arte y ciencia', hue: 175 },
  { id: 'infantil', emoji: '🧸', label: 'Infantil', hue: 350 },
]

// ---------- Gustos: localStorage (visitante) + profiles.interests (con sesión) ----------
const KEY = 'comelibros:gustos'
const EMPTY = { cats: [], done: false }
function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? EMPTY } catch { return EMPTY }
}

const TasteCtx = createContext(null)
export const useTastes = () => useContext(TasteCtx)

export function TasteProvider({ children }) {
  const { uid, profile } = useAuth()
  const [t, setT] = useState(load)
  const [picking, setPicking] = useState(false)

  const commit = useCallback(cats => {
    const next = { cats, done: true }
    setT(next)
    try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* modo privado */ }
    if (uid) sb.from('profiles').update({ interests: cats }).eq('id', uid).then(() => {})
  }, [uid])

  // Al iniciar sesión mandan los gustos de su cuenta; si no tenía, se suben los de este navegador.
  useEffect(() => {
    if (!profile) return
    if (profile.interests?.length) {
      const next = { cats: profile.interests, done: true }
      setT(next)
      try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* modo privado */ }
    } else if (t.done && t.cats.length) commit(t.cats)
  }, [profile?.id])

  const toggle = id => commit(t.cats.includes(id) ? t.cats.filter(c => c !== id) : [...t.cats, id])
  return <TasteCtx.Provider value={{ t, picking, setPicking, commit, toggle, clear: () => commit([]) }}>{children}</TasteCtx.Provider>
}

// ---------- Menú de bienvenida: burbujas flotantes ----------
function Confetti() {
  const bits = useMemo(() => Array.from({ length: 40 }, () => ({
    '--x': `${(Math.random() - 0.5) * 120}vw`, '--y': `${-30 - Math.random() * 70}vh`,
    '--r': `${Math.random() * 720 - 360}deg`, '--h': Math.floor(Math.random() * 360), '--w': `${6 + Math.random() * 8}px`,
  })), [])
  return <div className="confetti" aria-hidden="true">{bits.map((s, i) => <i key={i} style={s} />)}</div>
}

export function TastePicker() {
  const { session, profile } = useAuth()
  const { t, picking, setPicking, commit } = useTastes()
  const { pathname } = useLocation()
  const nav = useNavigate()
  const [sel, setSel] = useState(() => new Set(t.cats))
  const [boom, setBoom] = useState(false)

  // esperamos a conocer la cuenta para no mostrar el menú a quien ya eligió en otro dispositivo
  const ready = session !== undefined && (!session || !!profile)
  const first = !t.done
  const open = picking || (first && ready && pathname === '/')
  useEffect(() => { if (open) setSel(new Set(t.cats)) }, [open])
  if (!open) return null

  const toggle = id => setSel(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  function go() {
    setBoom(true)
    setTimeout(() => {
      commit([...sel])
      setPicking(false)
      setBoom(false)
      if (first) nav('/descubrir')
    }, 800)
  }
  const close = () => { if (first) commit([]); setPicking(false) }

  return (
    <div className="taste" role="dialog" aria-modal="true" aria-label="Elige tus gustos">
      <div className="taste-blob a" /><div className="taste-blob b" />
      {!first && <button className="taste-x" onClick={close} aria-label="Cerrar">✕</button>}
      <h1 className="taste-title">¿Qué te gusta leer?</h1>
      <p className="taste-sub">Toca los que quieras. Te mostramos esos libros primero.</p>
      <div className="bubbles">
        {CATEGORIES.map((c, i) => (
          <button key={c.id} type="button" className={`bubble${sel.has(c.id) ? ' on' : ''}`} aria-pressed={sel.has(c.id)}
            style={{ '--h': c.hue, '--i': i, '--s': `${104 + (i % 3) * 16}px`, '--f': `${3.2 + (i % 4) * 0.7}s` }}
            onClick={() => toggle(c.id)}>
            <span className="bubble-in">
              <span className="b-emoji">{c.emoji}</span>
              <span className="b-label">{c.label}</span>
              <span className="b-check">✓</span>
            </span>
          </button>
        ))}
      </div>
      <button className="btn primary taste-go" disabled={!sel.size || boom} onClick={go}>
        {sel.size ? `¡Vamos! (${sel.size})` : 'Elige al menos una'}
      </button>
      <button className="link taste-skip" onClick={close}>{first ? 'Ver todo sin filtrar' : 'Cancelar'}</button>
      {boom && <Confetti />}
    </div>
  )
}

// ---------- Barra de filtro (Explorar y Descubrir): un toque quita o cambia el tipo ----------
export function FilterBar() {
  const { t, toggle, clear, setPicking } = useTastes()
  return (
    <div className="filterbar" role="group" aria-label="Filtrar por tipo de libro">
      <button className={`fchip${t.cats.length ? '' : ' on'}`} onClick={clear}>Todas</button>
      {CATEGORIES.map(c => {
        const on = t.cats.includes(c.id)
        return (
          <button key={c.id} className={`fchip${on ? ' on' : ''}`} style={{ '--h': c.hue }} aria-pressed={on} onClick={() => toggle(c.id)}>
            {c.emoji} {c.label}{on && <b> ✕</b>}
          </button>
        )
      })}
      <button className="fchip edit" onClick={() => setPicking(true)} aria-label="Editar mis gustos">✨ Mis gustos</button>
    </div>
  )
}

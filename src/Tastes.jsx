import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { sb, useAuth } from './lib.jsx'

// Mismos ids que el check de books.category en supabase/003_categorias.sql
export const CATEGORIES = [
  { id: 'novela', short: 'Novela', emoji: '📖', label: 'Novela y narrativa', hue: 18 },
  { id: 'misterio', short: 'Misterio', emoji: '🕵️', label: 'Misterio y thriller', hue: 262 },
  { id: 'juvenil', short: 'Juvenil', emoji: '🧙', label: 'Juvenil y fantasía', hue: 292 },
  { id: 'clasicos', short: 'Clásicos', emoji: '🏛️', label: 'Clásicos', hue: 38 },
  { id: 'psicologia', short: 'Psicología', emoji: '🧠', label: 'Psicología y autoayuda', hue: 335 },
  { id: 'negocios', short: 'Negocios', emoji: '💼', label: 'Negocios', hue: 205 },
  { id: 'historia', short: 'Historia', emoji: '🗺️', label: 'Historia y sociedad', hue: 140 },
  { id: 'religion', short: 'Religión', emoji: '🙏', label: 'Religión y espiritualidad', hue: 52 },
  { id: 'arte', short: 'Arte y ciencia', emoji: '🎨', label: 'Arte y ciencia', hue: 175 },
  { id: 'infantil', short: 'Infantil', emoji: '🧸', label: 'Infantil', hue: 350 },
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
  const [step, setStep] = useState('welcome') // welcome | genres (editar gustos salta directo a genres)

  // esperamos a conocer la cuenta para no mostrar el menú a quien ya eligió en otro dispositivo
  const ready = session !== undefined && (!session || !!profile)
  const first = !t.done
  const open = picking || (first && ready && pathname === '/')
  useEffect(() => { if (open) { setSel(new Set(t.cats)); setStep(first ? 'welcome' : 'genres') } }, [open])
  useEffect(() => {
    if (!open) return
    document.documentElement.style.overflow = 'hidden'
    return () => { document.documentElement.style.overflow = '' }
  }, [open])
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

  return (
    <div className="taste" role="dialog" aria-modal="true" aria-label="Bienvenida">
      <div className="taste-blob a" /><div className="taste-blob b" />
      {!first && <button className="taste-x" onClick={() => setPicking(false)} aria-label="Cerrar">✕</button>}
      {step === 'welcome' ? (
        <div className="taste-step welcome" key="w">
          <div className="welcome-logo">📚</div>
          <h1 className="taste-title">Bienvenido a Comelibros</h1>
          <p className="taste-sub">El marketplace para encontrar a otros amantes de la lectura, intercambiar libros y dar con tu libro ideal.</p>
          <ul className="welcome-list">
            <li><span>📖</span> Publica los libros que ya leíste</li>
            <li><span>🔄</span> Ofrece un cambio, dinero o ambos</li>
            <li><span>📍</span> Acuerda un punto de encuentro seguro y cercano</li>
          </ul>
          <button className="btn primary taste-go" onClick={() => setStep('genres')}>Empezar</button>
        </div>
      ) : (
        <div className="taste-step genres" key="g">
          <h1 className="taste-title">¿Qué te gusta leer?</h1>
          <p className="taste-sub">Toca uno o varios. Te mostramos esos libros primero.</p>
          <div className="bubbles">
            {CATEGORIES.map((c, i) => (
              <button key={c.id} type="button" className={`gb${sel.has(c.id) ? ' on' : ''}`} aria-pressed={sel.has(c.id)}
                style={{ '--h': c.hue, '--i': i, '--f': `${3.2 + (i % 4) * 0.7}s` }} onClick={() => toggle(c.id)}>
                <span className="gb-in">
                  <span className="b-emoji">{c.emoji}</span>
                  <span className="b-label">{c.short}</span>
                  <span className="b-check">✓</span>
                </span>
              </button>
            ))}
          </div>
          <button className="btn primary taste-go" disabled={!sel.size || boom} onClick={go}>
            {sel.size ? `¡Vamos! (${sel.size})` : 'Elige al menos una'}
          </button>
        </div>
      )}
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

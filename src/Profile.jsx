import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { sb, call, useAuth, uploadPhoto, Avatar, BookCard, Stars, DEPARTAMENTOS } from './lib.jsx'

function Wishes({ userId, mine }) {
  const [wishes, setWishes] = useState([])
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')

  useEffect(() => {
    sb.from('wishes').select().eq('user_id', userId).order('id').then(({ data }) => setWishes(data ?? []))
  }, [userId])

  async function add(e) {
    e.preventDefault()
    const w = await call(sb.from('wishes').insert({ title: title.trim(), author: author.trim() }).select().single())
    setWishes([...wishes, w])
    setTitle('')
    setAuthor('')
  }

  async function remove(id) {
    await call(sb.from('wishes').delete().eq('id', id))
    setWishes(wishes.filter(w => w.id !== id))
  }

  if (!mine && !wishes.length) return null
  return (
    <section className="stack">
      <h2>{mine ? '📌 Libros que busco' : '📌 Busca'}</h2>
      {mine && <p className="small muted">Te mostramos en Explorar quién los tiene, y si alguien busca algo tuyo, te avisamos del match.</p>}
      <div className="chips">
        {wishes.map(w => (
          <span key={w.id} className="chip">
            {w.title}{w.author && <span className="muted"> · {w.author}</span>}
            {mine && <button onClick={() => remove(w.id)} aria-label={`Quitar ${w.title}`}>✕</button>}
          </span>
        ))}
      </div>
      {mine && (
        <form className="row" onSubmit={add}>
          <input className="grow" value={title} onChange={e => setTitle(e.target.value)} placeholder="Título" required minLength={3} maxLength={200} />
          <input className="grow" value={author} onChange={e => setAuthor(e.target.value)} placeholder="Autor (opcional)" maxLength={200} />
          <button className="btn">Agregar</button>
        </form>
      )}
    </section>
  )
}

function Reviews({ userId, trades }) {
  const [reviews, setReviews] = useState([])

  useEffect(() => {
    sb.from('reviews').select('stars, comment, created_at, reviewer:profiles!reviews_reviewer_id_fkey(id, name)')
      .eq('reviewee_id', userId).order('created_at', { ascending: false }).then(({ data }) => setReviews(data ?? []))
  }, [userId])

  const avg = reviews.reduce((s, r) => s + r.stars, 0) / (reviews.length || 1)
  return (
    <>
      <span className="small">
        {reviews.length > 0 ? <><Stars n={avg} /> {avg.toFixed(1)} ({reviews.length})</> : <span className="muted">Sin reseñas</span>}
        <span className="muted"> · {trades} {trades === 1 ? 'intercambio' : 'intercambios'}</span>
      </span>
      {reviews.length > 0 && (
        <details>
          <summary className="small">Ver reseñas</summary>
          <ul className="list reviews">
            {reviews.map(r => (
              <li key={r.created_at + r.reviewer?.id}>
                <Stars n={r.stars} /> {r.comment && <span className="pre">{r.comment}</span>}
                <br /><span className="small muted">{r.reviewer ? <Link to={`/u/${r.reviewer.id}`}>{r.reviewer.name}</Link> : 'Alguien'} · {new Date(r.created_at).toLocaleDateString('es-GT')}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  )
}

export function PublicProfile() {
  const { id } = useParams()
  const { uid } = useAuth()
  const [p, setP] = useState(null)
  const [books, setBooks] = useState([])
  const [blocked, setBlocked] = useState(false)
  const mine = uid === id

  useEffect(() => {
    sb.from('profiles').select().eq('id', id).maybeSingle().then(({ data }) => setP(data ?? false))
    let q = sb.from('books').select().eq('owner_id', id).order('created_at', { ascending: false })
    if (!mine) q = q.eq('available', true)
    q.then(({ data }) => setBooks(data ?? []))
  }, [id, mine])

  useEffect(() => {
    if (uid && !mine) sb.from('blocks').select().eq('blocked_id', id).maybeSingle().then(({ data }) => setBlocked(!!data))
  }, [id, uid, mine])

  if (p === null) return <p className="muted">Cargando…</p>
  if (p === false) return <p>Usuario no encontrado.</p>

  async function toggleBlock() {
    if (blocked) await call(sb.from('blocks').delete().eq('blocked_id', id))
    else {
      if (!confirm(`¿Bloquear a ${p.name}? No podrán ofertarse ni chatear.`)) return
      await call(sb.from('blocks').insert({ blocked_id: id }))
    }
    setBlocked(!blocked)
  }

  async function report() {
    const reason = prompt(`¿Por qué reportas a ${p.name}?`)
    if (!reason?.trim()) return
    await call(sb.from('reports').insert({ user_id: id, reason: reason.trim() }))
    alert('Gracias, un admin lo revisará.')
  }

  return (
    <>
      <section className="profile card">
        <Avatar profile={p} size={84} />
        <div className="stack">
          <h1>{p.name}</h1>
          {p.city && <span className="muted">📍 {p.city}</span>}
          <Reviews userId={id} trades={p.trades} />
          {p.banned && <span className="tag">Cuenta suspendida</span>}
          {p.bio && <p className="pre">{p.bio}</p>}
          <div className="row">
            {mine && <Link className="btn" to="/perfil/editar">Editar perfil</Link>}
            {mine && <Link className="btn primary" to="/publicar">Publicar libro</Link>}
            {uid && !mine && <button className="btn" onClick={toggleBlock}>{blocked ? 'Desbloquear' : 'Bloquear'}</button>}
            {uid && !mine && <button className="btn" onClick={report}>Reportar</button>}
          </div>
        </div>
      </section>
      <Wishes userId={id} mine={mine} />
      <h2>{mine ? 'Mis libros' : 'Libros disponibles'} ({books.length})</h2>
      {books.length === 0 ? <p className="muted">Sin libros publicados.</p>
        : <div className="grid">{books.map(b => <BookCard key={b.id} book={b} />)}</div>}
    </>
  )
}

export function EditProfile() {
  const { uid, profile, reloadProfile } = useAuth()
  const [f, setF] = useState(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (profile && !f) setF(profile) }, [profile, f])
  if (!f) return <p className="muted">Cargando…</p>

  const set = key => e => setF({ ...f, [key]: e.target.value })

  async function avatar(e) {
    if (!e.target.files[0]) return
    setBusy(true)
    try { setF({ ...f, avatar: await uploadPhoto(e.target.files[0], uid) }) } finally { setBusy(false) }
  }

  async function save(e) {
    e.preventDefault()
    await call(sb.from('profiles').update({ name: f.name.trim(), city: f.city.trim(), bio: f.bio.trim(), avatar: f.avatar }).eq('id', uid))
    if (password) await call(sb.auth.updateUser({ password }))
    setPassword('')
    await reloadProfile()
    alert('Perfil guardado')
  }

  return (
    <form className="card stack narrow" onSubmit={save}>
      <h1>Mi perfil</h1>
      <label className="row avatar-edit">
        <Avatar profile={f} size={72} />
        <span className="btn small">{busy ? 'Subiendo…' : 'Cambiar foto'}</span>
        <input type="file" accept="image/*" hidden onChange={avatar} disabled={busy} />
      </label>
      <label>Nombre<input value={f.name} onChange={set('name')} required maxLength={80} /></label>
      <label>Departamento / ciudad
        <input value={f.city} onChange={set('city')} list="deptos" maxLength={80} />
        <datalist id="deptos">{DEPARTAMENTOS.map(d => <option key={d} value={d} />)}</datalist>
      </label>
      <label>Sobre mí<textarea rows={4} value={f.bio} onChange={set('bio')} maxLength={1000} placeholder="Qué te gusta leer, qué buscas…" /></label>
      <label>Nueva contraseña (opcional)
        <input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={6} autoComplete="new-password" />
      </label>
      <button className="btn primary" disabled={busy}>Guardar</button>
    </form>
  )
}

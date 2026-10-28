import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { sb, call, useAuth, photoUrl, uploadPhoto, BookCard, Avatar } from './lib.jsx'
import { OfferForm } from './Offers.jsx'
import { CATEGORIES, FilterBar, useTastes } from './Tastes.jsx'

export function Explore() {
  const { uid } = useAuth()
  const { t: { cats }, clear } = useTastes()
  const [q, setQ] = useState('')
  const [books, setBooks] = useState(null)
  const catKey = cats.join()

  useEffect(() => {
    const t = setTimeout(async () => {
      let query = sb.from('books').select('*, owner:profiles(name, city)')
        .eq('available', true).order('created_at', { ascending: false }).limit(60)
      if (cats.length) query = query.in('category', cats)
      const term = q.replace(/[,()%*\\]/g, ' ').trim() // caracteres especiales del filtro de PostgREST
      if (term) query = query.or(`title.ilike.%${term}%,author.ilike.%${term}%`)
      setBooks(await call(query))
    }, 250)
    return () => clearTimeout(t)
  }, [q, catKey])

  return (
    <>
      <div className="row search-row">
        <input className="search grow" placeholder="Buscar por título o autor…" value={q} onChange={e => setQ(e.target.value)} />
        <Link className="btn" to="/descubrir">✨ Descubrir</Link>
      </div>
      <FilterBar />
      {uid && !q && !cats.length && <ForYou />}
      {books === null ? <p className="muted">Cargando…</p>
        : books.length === 0 ? (
          <p className="muted">
            No hay libros{q && ' con esa búsqueda'}{cats.length > 0 && ' de ese tipo'}.{' '}
            {cats.length > 0 ? <button className="link" onClick={clear}>Quitar filtro</button> : <Link to="/publicar">Publica el primero</Link>}
          </p>
        )
        : <div className="grid">{books.map(b => <BookCard key={b.id} book={b} />)}</div>}
    </>
  )
}

// Coincidencias con mi lista de deseos, y "match doble" (tiene lo que busco y busca lo que tengo).
function ForYou() {
  const nav = useNavigate()
  const [doubles, setDoubles] = useState([])
  const [wished, setWished] = useState([])

  useEffect(() => {
    sb.rpc('double_matches').then(({ data }) => setDoubles(data ?? []))
    sb.rpc('wish_matches').select('*, owner:profiles(name, city)').then(({ data }) => setWished(data ?? []))
  }, [])

  async function swap(m) {
    const offerId = await call(sb.rpc('make_offer', {
      p_book: m.their_book, p_money: 0, p_books: [m.my_book],
      p_note: `¡Match! Busco tu "${m.their_title}" y tú buscas mi "${m.my_title}".`,
    }))
    nav(`/oferta/${offerId}`)
  }

  if (!doubles.length && !wished.length) return null
  return (
    <section className="stack foryou">
      {doubles.map(m => (
        <div key={m.their_book + m.my_book} className="card match">
          <span>✨ <Link to={`/u/${m.user_id}`}>{m.user_name}</Link> tiene <Link to={`/libro/${m.their_book}`}>{m.their_title}</Link>, que buscas, y busca tu <strong>{m.my_title}</strong>.</span>
          <button className="btn primary small" onClick={() => swap(m)}>Proponer cambio</button>
        </div>
      ))}
      {wished.length > 0 && (
        <>
          <h2>De tu lista de deseos</h2>
          <div className="grid">{wished.map(b => <BookCard key={b.id} book={b} />)}</div>
          <h2>Todos los libros</h2>
        </>
      )}
    </section>
  )
}

const Reader = ({ p }) => p
  ? <><Link to={`/u/${p.id}`}>{p.name}</Link>{p.city && <span className="muted"> ({p.city})</span>}</>
  : <span className="muted">Alguien</span>

function Journey({ book }) {
  const [trips, setTrips] = useState([])

  useEffect(() => {
    sb.from('journeys')
      .select('id, created_at, from:profiles!journeys_from_id_fkey(id, name, city), to:profiles!journeys_to_id_fkey(id, name, city)')
      .eq('book_id', book.id).order('id').then(({ data }) => setTrips(data ?? []))
  }, [book.id])

  if (!trips.length) return null
  const day = d => new Date(d).toLocaleDateString('es-GT')
  const cities = [...new Set([trips[0].from, ...trips.map(t => t.to)].map(p => p?.city).filter(Boolean))]
  return (
    <section className="card stack">
      <h2>🧭 El viaje de este libro</h2>
      <p className="small muted">
        Ha pasado por {trips.length + 1} lectores{cities.length > 0 && ` en ${new Intl.ListFormat('es').format(cities)}`}.
      </p>
      <ol className="journey">
        <li><Reader p={trips[0].from} /> <span className="small muted">· lo publicó el {day(book.created_at)}</span></li>
        {trips.map(t => <li key={t.id}><Reader p={t.to} /> <span className="small muted">· {day(t.created_at)}</span></li>)}
      </ol>
    </section>
  )
}

export function BookPage() {
  const { id } = useParams()
  const { uid } = useAuth()
  const nav = useNavigate()
  const [book, setBook] = useState(null)
  const [photo, setPhoto] = useState(0)
  const [myOffer, setMyOffer] = useState(null)

  useEffect(() => {
    sb.from('books').select('*, owner:profiles(id, name, city, avatar)').eq('id', id).maybeSingle().then(({ data }) => setBook(data ?? false))
  }, [id])

  useEffect(() => {
    if (!uid) return
    sb.from('offers').select('id').eq('book_id', id).eq('bidder_id', uid).eq('status', 'open').maybeSingle()
      .then(({ data }) => setMyOffer(data))
  }, [id, uid])

  if (book === null) return <p className="muted">Cargando…</p>
  if (book === false) return <p>Este libro no existe o fue retirado.</p>

  const mine = uid === book.owner_id
  async function offer({ money, books, note }) {
    const offerId = await call(sb.rpc('make_offer', { p_book: id, p_money: money, p_books: books, p_note: note }))
    nav(`/oferta/${offerId}`)
  }

  return (
    <div className="book-page">
      <div className="gallery">
        <div className="cover big">{book.photos[photo] ? <img src={photoUrl(book.photos[photo])} alt="" /> : <span>📖</span>}</div>
        {book.photos.length > 1 && (
          <div className="thumbs">
            {book.photos.map((p, i) => (
              <button key={p} className={i === photo ? 'on' : ''} onClick={() => setPhoto(i)}><img src={photoUrl(p)} alt="" /></button>
            ))}
          </div>
        )}
      </div>
      <div className="stack">
        <h1>{book.title}</h1>
        <p className="muted">{book.author}</p>
        {!book.available && <span className="tag">No disponible</span>}
        {book.description && <p className="pre">{book.description}</p>}
        <Link to={`/u/${book.owner.id}`} className="owner">
          <Avatar profile={book.owner} /> <span><strong>{book.owner.name}</strong><br /><span className="small muted">{book.owner.city}</span></span>
        </Link>

        {mine && !book.available && <p className="tip">Para que siga su viaje, edítalo y márcalo como disponible.</p>}
        {mine ? <Link className="btn" to={`/libro/${id}/editar`}>Editar libro</Link>
          : !uid ? <Link className="btn primary" to={`/login?next=${encodeURIComponent(`/libro/${id}`)}`}>Entra para hacer una oferta</Link>
          : myOffer ? <Link className="btn primary" to={`/oferta/${myOffer.id}`}>Ver mi oferta</Link>
          : book.available && (
            <div className="card">
              <h2>Hacer una oferta</h2>
              <OfferForm bidderId={uid} onSubmit={offer} label="Enviar oferta" />
            </div>
          )}
        <Journey book={book} />
      </div>
    </div>
  )
}

// Modo descubrir: un libro a la vez, desliza → me interesa, ← paso. Los vistos se guardan en este navegador.
const SEEN_KEY = 'comelibros:vistos'
function loadSeen() {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY)) ?? []) } catch { return new Set() }
}

export function Discover() {
  const { uid, profile } = useAuth()
  const nav = useNavigate()
  const [deck, setDeck] = useState(null)
  const [round, setRound] = useState(0)
  const [drag, setDrag] = useState(0)
  const startX = useRef(null)
  const city = profile?.city
  const { t: { cats }, clear } = useTastes()
  const catKey = cats.join()

  useEffect(() => {
    let q = sb.from('books').select('*, owner:profiles(name, city)').eq('available', true)
      .order('created_at', { ascending: false }).limit(100)
    if (cats.length) q = q.in('category', cats)
    if (uid) q = q.neq('owner_id', uid)
    q.then(({ data }) => {
      const seen = loadSeen()
      // primero los de mi departamento
      setDeck((data ?? []).filter(b => !seen.has(b.id)).sort((a, b) => (b.owner.city === city) - (a.owner.city === city)))
    })
  }, [uid, city, round, catKey])

  const book = deck?.[0]

  function next(liked) {
    const seen = loadSeen()
    seen.add(book.id)
    try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-500))) } catch { /* modo privado */ }
    setDrag(0)
    if (liked) nav(`/libro/${book.id}`)
    else setDeck(deck.slice(1))
  }

  useEffect(() => {
    const onKey = e => {
      if (!book) return
      if (e.key === 'ArrowRight') next(true)
      if (e.key === 'ArrowLeft') next(false)
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  })

  const top = (
    <>
      <div className="row between">
        <Link className="btn small" to="/">✕ Salir al listado</Link>
      </div>
      <FilterBar />
    </>
  )

  if (deck === null) return <>{top}<p className="muted">Cargando…</p></>
  if (!book) return (
    <div className="stack discover">
      {top}
      <h1>¡Viste todo! 📚</h1>
      <p className="muted">No hay más libros{cats.length > 0 && ' de este tipo'} por ahora.</p>
      <div className="row center">
        {cats.length > 0 && <button className="btn primary" onClick={clear}>Quitar filtro</button>}
        <button className="btn" onClick={() => { try { localStorage.removeItem(SEEN_KEY) } catch { /* nada */ } setDeck(null); setRound(round + 1) }}>
          Volver a empezar
        </button>
      </div>
    </div>
  )

  const cover = photoUrl(book.photos[0])
  return (
    <div className="stack discover">
      {top}
      <div
        className="card swipe"
        style={{ transform: `translateX(${drag}px) rotate(${drag / 20}deg)`, transition: startX.current === null ? 'transform .2s' : 'none' }}
        onPointerDown={e => { startX.current = e.clientX; e.currentTarget.setPointerCapture(e.pointerId) }}
        onPointerMove={e => { if (startX.current !== null) setDrag(e.clientX - startX.current) }}
        onPointerUp={() => { startX.current = null; Math.abs(drag) > 100 ? next(drag > 0) : setDrag(0) }}
      >
        <div className="cover">{cover ? <img src={cover} alt="" draggable={false} /> : <span>📖</span>}</div>
        <div className="stack swipe-body">
          <h2>{book.title}</h2>
          <span className="muted">{book.author}</span>
          <span className="small muted">{book.owner.name}{book.owner.city && ` · ${book.owner.city}`}</span>
          {book.description && <p className="small clamp">{book.description}</p>}
        </div>
        {drag > 40 && <span className="stamp like">ME INTERESA</span>}
        {drag < -40 && <span className="stamp nope">PASO</span>}
      </div>
      <div className="row center">
        <button className="btn round" onClick={() => next(false)} aria-label="Paso">✕</button>
        <button className="btn round primary" onClick={() => next(true)} aria-label="Me interesa">♥</button>
      </div>
      <p className="small muted center">Desliza o usa las flechas ← →</p>
    </div>
  )
}

const EMPTY = { title: '', author: '', description: '', photos: [], available: true, category: '' }

export function BookForm() {
  const { id } = useParams()
  const { uid } = useAuth()
  const nav = useNavigate()
  const [b, setB] = useState(EMPTY)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (id) sb.from('books').select().eq('id', id).single().then(({ data }) => data && setB(data))
    else setB(EMPTY)
  }, [id])

  const set = key => e => setB({ ...b, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })

  async function addPhotos(e) {
    const input = e.target
    const files = [...input.files].slice(0, 5 - b.photos.length)
    setBusy(true)
    try {
      const paths = await Promise.all(files.map(f => uploadPhoto(f, uid)))
      setB(prev => ({ ...prev, photos: [...prev.photos, ...paths] }))
    } finally {
      setBusy(false)
      input.value = ''
    }
  }

  // ponytail: fotos quitadas quedan huérfanas en storage; limpiar con un cron si el espacio importa
  const removePhoto = p => setB({ ...b, photos: b.photos.filter(x => x !== p) })

  async function save(e) {
    e.preventDefault()
    const row = { title: b.title.trim(), author: b.author.trim(), description: b.description.trim(), photos: b.photos, available: b.available }
    if (b.category) row.category = b.category // vacío = el servidor la adivina al publicar
    const saved = await call(id
      ? sb.from('books').update(row).eq('id', id).select().single()
      : sb.from('books').insert(row).select().single())
    nav(`/libro/${saved.id}`)
  }

  async function remove() {
    if (!confirm('¿Borrar este libro? Las ofertas quedan en el historial.')) return
    await call(sb.from('books').delete().eq('id', id))
    nav(`/u/${uid}`)
  }

  return (
    <form className="card stack narrow" onSubmit={save}>
      <h1>{id ? 'Editar libro' : 'Publicar un libro'}</h1>
      <label>Título<input value={b.title} onChange={set('title')} required maxLength={200} /></label>
      <label>Autor<input value={b.author} onChange={set('author')} required maxLength={200} /></label>
      <label>Tipo de libro
        <select value={b.category} onChange={set('category')}>
          {!id && <option value="">Automático (según título y autor)</option>}
          {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.emoji} {c.label}</option>)}
        </select>
      </label>
      <label>Breve descripción
        <textarea rows={4} value={b.description} onChange={set('description')} maxLength={2000}
          placeholder="Estado, edición, qué te pareció…" />
      </label>
      <div>
        <span className="label">Fotos ({b.photos.length}/5)</span>
        <div className="photo-row">
          {b.photos.map(p => (
            <div key={p} className="photo-edit">
              <img src={photoUrl(p)} alt="" />
              <button type="button" onClick={() => removePhoto(p)} aria-label="Quitar foto">✕</button>
            </div>
          ))}
          {b.photos.length < 5 && (
            <label className="photo-add">{busy ? '…' : '+ Foto'}
              <input type="file" accept="image/*" multiple hidden onChange={addPhotos} disabled={busy} />
            </label>
          )}
        </div>
      </div>
      {id && <label className="row"><input type="checkbox" checked={b.available} onChange={set('available')} /> Disponible para intercambio</label>}
      <button className="btn primary" disabled={busy}>{id ? 'Guardar' : 'Publicar'}</button>
      {id && <button type="button" className="btn danger" onClick={remove}>Borrar libro</button>}
    </form>
  )
}

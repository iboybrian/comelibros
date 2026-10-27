import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { sb, call, useAuth, quetzales, MapPin, Stars } from './lib.jsx'

const WITH_NAMES = '*, owner:profiles!offers_owner_id_fkey(id, name), bidder:profiles!offers_bidder_id_fkey(id, name)'

// Formulario de términos: plata + libros del ofertante + nota. Sirve para ofertar y contraofertar.
export function OfferForm({ bidderId, initial = {}, onSubmit, label }) {
  const [money, setMoney] = useState(initial.money ? String(initial.money) : '')
  const [picked, setPicked] = useState(initial.books ?? [])
  const [note, setNote] = useState(initial.note ?? '')
  const [books, setBooks] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    sb.from('books').select('id, title, author').eq('owner_id', bidderId).eq('available', true)
      .then(({ data }) => setBooks(data ?? []))
  }, [bidderId])

  const toggle = id => setPicked(picked.includes(id) ? picked.filter(x => x !== id) : [...picked, id])

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    try { await onSubmit({ money: Number(money) || 0, books: picked, note: note.trim() }) } finally { setBusy(false) }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label>Plata (Q), opcional
        <input type="number" inputMode="decimal" min="0" step="0.01" value={money} onChange={e => setMoney(e.target.value)} placeholder="0.00" />
      </label>
      <div>
        <span className="label">Libros a cambio, opcional</span>
        {books.length === 0 ? <p className="small muted">No hay libros disponibles para ofrecer.</p>
          : books.map(b => (
            <label key={b.id} className="row check">
              <input type="checkbox" checked={picked.includes(b.id)} onChange={() => toggle(b.id)} />
              <span>{b.title} <span className="muted">· {b.author}</span></span>
            </label>
          ))}
      </div>
      <label>Mensaje<textarea rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={1000} /></label>
      <button className="btn primary" disabled={busy}>{label}</button>
    </form>
  )
}

function statusLabel(o, uid) {
  if (o.status === 'rejected') return 'Cerrada'
  if (o.completed_at) return '🎉 Completado'
  if (o.status === 'accepted') return o.place_confirmed_at ? '✅ Lugar registrado' : 'Aceptada · definan el lugar'
  const myOk = uid === o.owner_id ? o.owner_ok : o.bidder_ok
  return myOk ? 'Esperando respuesta' : '🔔 Te toca responder'
}

export function OffersList() {
  const { uid } = useAuth()
  const [offers, setOffers] = useState(null)

  useEffect(() => {
    sb.from('offers').select(WITH_NAMES).or(`owner_id.eq.${uid},bidder_id.eq.${uid}`).order('updated_at', { ascending: false })
      .then(({ data }) => setOffers(data ?? []))
  }, [uid])

  if (!offers) return <p className="muted">Cargando…</p>
  const received = offers.filter(o => o.owner_id === uid)
  const sent = offers.filter(o => o.bidder_id === uid)

  const list = items => items.length === 0 ? <p className="muted">Nada por aquí.</p> : (
    <ul className="list">
      {items.map(o => {
        const other = o.owner_id === uid ? o.bidder : o.owner
        return (
          <li key={o.id}>
            <Link to={`/oferta/${o.id}`} className={o.status === 'rejected' ? 'dim' : ''}>
              <strong>{o.book_title}</strong>
              <span className="small muted">con {other.name} · {statusLabel(o, uid)}</span>
            </Link>
          </li>
        )
      })}
    </ul>
  )

  return (
    <>
      <h1>Ofertas</h1>
      <h2>Recibidas</h2>{list(received)}
      <h2>Enviadas</h2>{list(sent)}
    </>
  )
}

export function OfferPage() {
  const { id } = useParams()
  const { uid } = useAuth()
  const [o, setO] = useState(null)
  const [offered, setOffered] = useState([])
  const [countering, setCountering] = useState(false)

  const load = useCallback(async () => {
    const data = await call(sb.from('offers').select(WITH_NAMES).eq('id', id).maybeSingle())
    setO(data ?? false)
    if (data?.books.length) setOffered(await call(sb.from('books').select('id, title, author').in('id', data.books)))
    else setOffered([])
  }, [id])

  useEffect(() => {
    load()
    const ch = sb.channel(`offer-${id}-${Math.random()}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'offers', filter: `id=eq.${id}` }, load)
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [id, load])

  if (o === null) return <p className="muted">Cargando…</p>
  if (o === false) return <p>Oferta no encontrada.</p>

  const isOwner = uid === o.owner_id
  const isParty = isOwner || uid === o.bidder_id
  const other = isOwner ? o.bidder : o.owner
  const myOk = isOwner ? o.owner_ok : o.bidder_ok
  const rpc = async (fn, args = {}) => { await call(sb.rpc(fn, { p_offer: id, ...args })); setCountering(false); load() }

  async function reject() {
    if (confirm(o.status === 'accepted' ? '¿Cancelar el trato? El chat se cerrará.' : '¿Rechazar / retirar esta oferta?')) await rpc('reject_offer')
  }

  return (
    <div className="stack">
      <p className="small"><Link to="/ofertas">← Ofertas</Link></p>
      <h1>{o.book_id ? <Link to={`/libro/${o.book_id}`}>{o.book_title}</Link> : o.book_title}</h1>
      <p className="muted">
        {isOwner ? 'Oferta de ' : 'Tu oferta a '}<Link to={`/u/${other.id}`}>{other.name}</Link> · {statusLabel(o, uid)}
      </p>

      <section className="card stack">
        <h2>Términos</h2>
        <p><strong>{isOwner ? `${o.bidder.name} ofrece` : 'Ofreces'}:</strong></p>
        <ul className="terms">
          {o.money > 0 && <li>💵 {quetzales(o.money)}</li>}
          {offered.map(b => <li key={b.id}>📘 <Link to={`/libro/${b.id}`}>{b.title}</Link> <span className="muted">· {b.author}</span></li>)}
          {o.money <= 0 && offered.length === 0 && <li className="muted">Nada a cambio (lo pide regalado)</li>}
        </ul>
        {o.note && <p className="pre quote">{o.note}</p>}

        {o.status === 'open' && isParty && (
          <>
            <p className="small muted">
              {o.owner.name}: {o.owner_ok ? '✅ de acuerdo' : '⏳ pendiente'} · {o.bidder.name}: {o.bidder_ok ? '✅ de acuerdo' : '⏳ pendiente'}
            </p>
            <div className="row">
              {!myOk && <button className="btn primary" onClick={() => rpc('accept_offer')}>Aceptar</button>}
              <button className="btn" onClick={() => setCountering(!countering)}>{myOk ? 'Modificar' : 'Contraofertar'}</button>
              <button className="btn danger" onClick={reject}>{isOwner ? 'Rechazar' : 'Retirar'}</button>
            </div>
            {countering && (
              <div className="card inset">
                <OfferForm bidderId={o.bidder_id} initial={o} label="Enviar contraoferta"
                  onSubmit={t => rpc('counter_offer', { p_money: t.money, p_books: t.books, p_note: t.note })} />
              </div>
            )}
          </>
        )}
        {o.status === 'rejected' && <p className="muted">Esta oferta fue cerrada.</p>}
      </section>

      {o.status === 'accepted' && <Place o={o} uid={uid} isParty={isParty} rpc={rpc} onCancel={reject} />}
      {o.status === 'accepted' && o.place_confirmed_at && <Done o={o} uid={uid} isParty={isParty} rpc={rpc} onCancel={reject} />}
      {o.status !== 'open' && <Chat offerId={id} canWrite={isParty && o.status === 'accepted'} />}
    </div>
  )
}

function Place({ o, uid, isParty, rpc, onCancel }) {
  const isOwner = uid === o.owner_id
  const proposed = o.lat != null ? { lat: o.lat, lng: o.lng } : null
  const myOk = isOwner ? o.place_owner_ok : o.place_bidder_ok
  const [editing, setEditing] = useState(!proposed)
  const [pin, setPin] = useState(proposed)
  const [text, setText] = useState(o.place ?? '')
  const gmaps = proposed && `https://www.google.com/maps/search/?api=1&query=${o.lat},${o.lng}`

  useEffect(() => { if (proposed) setEditing(false) }, [o.lat, o.lng, o.place])

  if (o.place_confirmed_at) return (
    <section className="card stack">
      <h2>📍 Lugar registrado</h2>
      <MapPin value={proposed} />
      {o.place && <p className="pre">{o.place}</p>}
      <p className="small muted">Confirmado por ambos el {new Date(o.place_confirmed_at).toLocaleString('es-GT')}. <a href={gmaps} target="_blank" rel="noreferrer">Abrir en Google Maps</a></p>
    </section>
  )

  async function propose(e) {
    e.preventDefault()
    if (!pin) return alert('Toca el mapa para marcar el lugar')
    await rpc('propose_place', { p_lat: pin.lat, p_lng: pin.lng, p_place: text })
  }

  return (
    <section className="card stack">
      <h2>📍 Lugar de encuentro</h2>
      {editing ? (
        <form className="stack" onSubmit={propose}>
          <p className="tip">🛡️ Elige un lugar público y concurrido, de día. Toca <strong>Lugares públicos</strong> para ver bibliotecas, cafés y centros comerciales cerca.</p>
          <MapPin value={pin} onChange={p => { setPin(p); if (p.label) setText(p.label) }} />
          <label>Descripción del lugar
            <textarea rows={2} value={text} onChange={e => setText(e.target.value)} maxLength={500}
              placeholder="Ej: Entrada principal del Centro Comercial, junto a la fuente. Sábado 10am." />
          </label>
          <div className="row">
            <button className="btn primary" disabled={!isParty}>Proponer lugar</button>
            {proposed && <button type="button" className="btn" onClick={() => setEditing(false)}>Cancelar</button>}
          </div>
        </form>
      ) : (
        <>
          <MapPin value={proposed} />
          {o.place && <p className="pre">{o.place}</p>}
          <p className="small muted">
            {o.owner.name}: {o.place_owner_ok ? '✅' : '⏳'} · {o.bidder.name}: {o.place_bidder_ok ? '✅' : '⏳'} · <a href={gmaps} target="_blank" rel="noreferrer">Google Maps</a>
          </p>
          {isParty && (
            <div className="row">
              {!myOk && <button className="btn primary" onClick={() => rpc('confirm_place')}>Confirmar lugar</button>}
              <button className="btn" onClick={() => { setPin(proposed); setEditing(true) }}>Proponer otro</button>
            </div>
          )}
        </>
      )}
      {isParty && <button className="link danger small" onClick={onCancel}>Cancelar trato</button>}
    </section>
  )
}

function Done({ o, uid, isParty, rpc, onCancel }) {
  const isOwner = uid === o.owner_id
  const myDone = isOwner ? o.done_owner : o.done_bidder
  const other = isOwner ? o.bidder : o.owner
  const [mine, setMine] = useState(undefined) // mi reseña: undefined = cargando, null = no hay
  const [stars, setStars] = useState(5)
  const [comment, setComment] = useState('')

  useEffect(() => {
    if (o.completed_at && isParty) {
      sb.from('reviews').select().eq('offer_id', o.id).eq('reviewer_id', uid).maybeSingle().then(({ data }) => setMine(data))
    }
  }, [o.completed_at, o.id, uid, isParty])

  async function review(e) {
    e.preventDefault()
    await call(sb.from('reviews').insert({ offer_id: o.id, reviewee_id: other.id, stars, comment: comment.trim() }))
    setMine({ stars, comment: comment.trim() })
  }

  if (!o.completed_at) return (
    <section className="card stack">
      <h2>🤝 ¿Ya se encontraron?</h2>
      <p className="small muted">Cuando ambos lo marquen como hecho, los libros cambian de dueño y podrán calificarse.</p>
      <p className="small muted">{o.owner.name}: {o.done_owner ? '✅ hecho' : '⏳'} · {o.bidder.name}: {o.done_bidder ? '✅ hecho' : '⏳'}</p>
      {isParty && !myDone && <button className="btn primary" onClick={() => rpc('mark_done')}>Marcar intercambio como hecho</button>}
      {isParty && <button className="link danger small" onClick={onCancel}>No se concretó: cancelar trato</button>}
    </section>
  )

  return (
    <section className="card stack">
      <h2>🎉 Intercambio completado</h2>
      <p className="small muted">
        El {new Date(o.completed_at).toLocaleDateString('es-GT')}. Los libros ya están en el perfil de su nuevo dueño, que puede volver a publicarlos para que sigan su viaje.
      </p>
      {mine === null && (
        <form className="stack" onSubmit={review}>
          <span className="label">¿Cómo te fue con {other.name}?</span>
          <div className="star-pick">
            {[1, 2, 3, 4, 5].map(n => (
              <button type="button" key={n} className={n <= stars ? 'on' : ''} onClick={() => setStars(n)} aria-label={`${n} estrellas`}>★</button>
            ))}
          </div>
          <textarea rows={2} value={comment} onChange={e => setComment(e.target.value)} maxLength={500} placeholder="Puntual, el libro estaba como se describió…" />
          <button className="btn primary">Enviar reseña</button>
        </form>
      )}
      {mine && <p className="small">Tu reseña: <Stars n={mine.stars} /> {mine.comment}</p>}
    </section>
  )
}

function Chat({ offerId, canWrite }) {
  const { uid } = useAuth()
  const [msgs, setMsgs] = useState([])
  const [text, setText] = useState('')
  const box = useRef(null)
  const add = m => setMsgs(list => (list.some(x => x.id === m.id) ? list : [...list, m]))

  useEffect(() => {
    sb.from('messages').select().eq('offer_id', offerId).order('id').then(({ data }) => setMsgs(data ?? []))
    const ch = sb.channel(`chat-${offerId}-${Math.random()}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `offer_id=eq.${offerId}` }, p => add(p.new))
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [offerId])

  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight }, [msgs.length])

  async function send(e) {
    e.preventDefault()
    if (!text.trim()) return
    // sacar la conversación a WhatsApp es la estafa más común en apps de compraventa
    if (/whats|wa\.me|telegram|\b\d{4}[\s-]?\d{4}\b/i.test(text)
      && !confirm('Por seguridad, coordina todo en este chat: así queda registro si algo sale mal. ¿Enviar de todos modos?')) return
    add(await call(sb.from('messages').insert({ offer_id: offerId, body: text.trim() }).select().single()))
    setText('')
  }

  return (
    <section className="card stack">
      <h2>💬 Chat</h2>
      <p className="tip">🛡️ No compartas datos bancarios ni salgas de este chat. Revisa el libro antes de pagar.</p>
      <div className="chat" ref={box}>
        {msgs.length === 0 && <p className="small muted">Pónganse de acuerdo en el lugar y la hora.</p>}
        {msgs.map(m => (
          <div key={m.id} className={`bubble ${m.sender_id === uid ? 'me' : ''}`}>
            <span className="pre">{m.body}</span>
            <time>{new Date(m.created_at).toLocaleTimeString('es-GT', { hour: '2-digit', minute: '2-digit' })}</time>
          </div>
        ))}
      </div>
      {canWrite && (
        <form className="row" onSubmit={send}>
          <input className="grow" value={text} onChange={e => setText(e.target.value)} placeholder="Escribe un mensaje…" maxLength={2000} />
          <button className="btn primary">Enviar</button>
        </form>
      )}
    </section>
  )
}

import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { sb, call, useAuth } from './lib.jsx'

export function Admin() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('reports')
  if (!profile) return <p className="muted">Cargando…</p>
  if (!profile.is_admin) return <p>Solo administradores.</p>

  return (
    <>
      <h1>Panel admin</h1>
      <div className="tabs">
        {[['reports', 'Reportes'], ['users', 'Usuarios'], ['books', 'Libros']].map(([k, label]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'reports' && <Reports />}
      {tab === 'users' && <Users />}
      {tab === 'books' && <Books />}
    </>
  )
}

const ban = async (id, value) => {
  if (confirm(value ? '¿Suspender esta cuenta?' : '¿Reactivar esta cuenta?')) await call(sb.rpc('set_banned', { p_user: id, p_banned: value }))
}

function Reports() {
  const [rows, setRows] = useState(null)
  const load = () => sb.from('reports')
    .select('*, reporter:profiles!reports_reporter_id_fkey(id, name), user:profiles!reports_user_id_fkey(id, name, banned)')
    .eq('resolved', false).order('created_at', { ascending: false }).then(({ data }) => setRows(data ?? []))
  useEffect(() => { load() }, [])

  if (!rows) return <p className="muted">Cargando…</p>
  if (rows.length === 0) return <p className="muted">Sin reportes pendientes. 🎉</p>
  return (
    <ul className="list">
      {rows.map(r => (
        <li key={r.id} className="admin-row">
          <div>
            <strong><Link to={`/u/${r.user.id}`}>{r.user.name}</Link></strong>{r.user.banned && <span className="tag">Suspendido</span>}
            <p className="pre">{r.reason}</p>
            <span className="small muted">por {r.reporter.name} · {new Date(r.created_at).toLocaleDateString('es-GT')}</span>
          </div>
          <div className="row">
            {!r.user.banned && <button className="btn small danger" onClick={() => ban(r.user.id, true).then(load)}>Suspender</button>}
            <button className="btn small" onClick={() => call(sb.from('reports').update({ resolved: true }).eq('id', r.id)).then(load)}>Resuelto</button>
          </div>
        </li>
      ))}
    </ul>
  )
}

function Users() {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const load = () => call(sb.rpc('admin_users')).then(setRows)
  useEffect(() => { load() }, [])

  if (!rows) return <p className="muted">Cargando…</p>
  const term = q.toLowerCase()
  const shown = rows.filter(u => `${u.name} ${u.email} ${u.city}`.toLowerCase().includes(term))
  return (
    <>
      <input className="search" placeholder="Buscar por nombre, correo o ciudad…" value={q} onChange={e => setQ(e.target.value)} />
      <p className="small muted">{rows.length} usuarios</p>
      <ul className="list">
        {shown.map(u => (
          <li key={u.id} className="admin-row">
            <div>
              <strong><Link to={`/u/${u.id}`}>{u.name}</Link></strong> {u.is_admin && <span className="tag">Admin</span>}{u.banned && <span className="tag">Suspendido</span>}
              <br /><span className="small muted">{u.email} · {u.city || 'sin ciudad'} · desde {new Date(u.created_at).toLocaleDateString('es-GT')}</span>
            </div>
            {!u.is_admin && (
              <button className={`btn small ${u.banned ? '' : 'danger'}`} onClick={() => ban(u.id, !u.banned).then(load)}>
                {u.banned ? 'Reactivar' : 'Suspender'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}

function Books() {
  const [rows, setRows] = useState(null)
  const load = () => sb.from('books').select('id, title, author, available, created_at, owner:profiles(id, name)')
    .order('created_at', { ascending: false }).limit(200).then(({ data }) => setRows(data ?? []))
  useEffect(() => { load() }, [])

  async function remove(b) {
    if (confirm(`¿Borrar "${b.title}"?`)) { await call(sb.from('books').delete().eq('id', b.id)); load() }
  }

  if (!rows) return <p className="muted">Cargando…</p>
  return (
    <ul className="list">
      {rows.map(b => (
        <li key={b.id} className="admin-row">
          <div>
            <strong><Link to={`/libro/${b.id}`}>{b.title}</Link></strong> <span className="muted">· {b.author}</span>
            <br /><span className="small muted">de <Link to={`/u/${b.owner.id}`}>{b.owner.name}</Link> · {new Date(b.created_at).toLocaleDateString('es-GT')}{!b.available && ' · no disponible'}</span>
          </div>
          <button className="btn small danger" onClick={() => remove(b)}>Borrar</button>
        </li>
      ))}
    </ul>
  )
}

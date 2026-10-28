import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { createClient } from '@supabase/supabase-js'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

const { VITE_SUPABASE_URL: url, VITE_SUPABASE_ANON_KEY: key } = import.meta.env
export const configured = Boolean(url && key)
export const sb = configured ? createClient(url, key) : null

// Ejecuta una query de supabase; si falla avisa y corta el flujo.
export async function call(query) {
  const { data, error } = await query
  if (error) {
    alert(error.message)
    throw error
  }
  return data
}

export const photoUrl = path => (!path ? null : /^https?:\/\//.test(path) ? path : sb.storage.from('photos').getPublicUrl(path).data.publicUrl)
export const quetzales = n => new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(n)

export const DEPARTAMENTOS = ['Alta Verapaz', 'Baja Verapaz', 'Chimaltenango', 'Chiquimula', 'El Progreso', 'Escuintla',
  'Guatemala', 'Huehuetenango', 'Izabal', 'Jalapa', 'Jutiapa', 'Petén', 'Quetzaltenango', 'Quiché', 'Retalhuleu',
  'Sacatepéquez', 'San Marcos', 'Santa Rosa', 'Sololá', 'Suchitepéquez', 'Totonicapán', 'Zacapa']

// Achica la foto a 1280px JPEG antes de subir (fotos de celular pesan 4MB+).
async function shrink(file, max = 1280) {
  const img = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * scale)
  canvas.height = Math.round(img.height * scale)
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
  return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.82))
}

export async function uploadPhoto(file, uid) {
  const path = `${uid}/${crypto.randomUUID()}.jpg`
  await call(sb.storage.from('photos').upload(path, await shrink(file), { contentType: 'image/jpeg' }))
  return path
}

// ---------- Sesión ----------
const AuthCtx = createContext(null)
export const useAuth = () => useContext(AuthCtx)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined) // undefined = cargando
  const [profile, setProfile] = useState(null)
  const uid = session?.user.id

  useEffect(() => {
    sb.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = sb.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const reloadProfile = useCallback(async () => {
    if (!uid) return setProfile(null)
    const { data } = await sb.from('profiles').select().eq('id', uid).single()
    setProfile(data)
  }, [uid])

  useEffect(() => { reloadProfile() }, [reloadProfile])

  return <AuthCtx.Provider value={{ session, uid, profile, reloadProfile }}>{children}</AuthCtx.Provider>
}

// ---------- Componentes compartidos ----------
export function Avatar({ profile, size = 40 }) {
  const url = photoUrl(profile?.avatar)
  return url
    ? <img className="avatar" src={url} alt="" style={{ width: size, height: size }} />
    : <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.45 }}>{profile?.name?.[0]?.toUpperCase() || '?'}</span>
}

export function BookCard({ book }) {
  const cover = photoUrl(book.photos?.[0])
  return (
    <Link to={`/libro/${book.id}`} className="book-card">
      <div className="cover">{cover ? <img src={cover} alt="" loading="lazy" /> : <span>📖</span>}</div>
      <div className="book-card-body">
        <strong>{book.title}</strong>
        <span className="muted">{book.author}</span>
        {book.owner && <span className="small muted">{book.owner.name}{book.owner.city && ` · ${book.owner.city}`}</span>}
        {!book.available && <span className="tag">No disponible</span>}
      </div>
    </Link>
  )
}

export function Stars({ n }) {
  const full = Math.round(n)
  return <span className="stars" aria-label={`${n.toFixed(1)} de 5`}>{'★'.repeat(full)}{'☆'.repeat(5 - full)}</span>
}

// Lugares públicos reales cerca (bibliotecas, policía, cafés, centros comerciales) desde OpenStreetMap.
const SPOT_ICON = { library: '📚', police: '👮', cafe: '☕', mall: '🛍️' }
async function safeSpots(lat, lng) {
  const near = `(around:1500,${lat},${lng})`
  const query = `[out:json][timeout:25];(nwr["amenity"~"^(library|police|cafe)$"]["name"]${near};nwr["shop"="mall"]["name"]${near};);out center 40;`
  // ponytail: Overpass público tarda 10-40s; con más tráfico, cachear por zona en una tabla o usar un mirror propio
  const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: new URLSearchParams({ data: query }) })
  const { elements } = await res.json()
  const byName = new Map(elements.map(e => [e.tags.name, {
    lat: e.lat ?? e.center.lat, lng: e.lon ?? e.center.lon, label: e.tags.name, kind: e.tags.amenity ?? 'mall',
  }]))
  return [...byName.values()]
}

L.Marker.prototype.options.icon = L.icon({
  iconUrl: markerIcon, iconRetinaUrl: markerIcon2x, shadowUrl: markerShadow, iconSize: [25, 41], iconAnchor: [12, 41],
})
const GUATE = [14.6349, -90.5069]

// Mapa con pin. Con onChange, tocar el mapa (o un lugar público sugerido) mueve el pin.
export function MapPin({ value, onChange }) {
  const el = useRef(null)
  const map = useRef(null)
  const marker = useRef(null)
  const spots = useRef(null)
  const [loadingSpots, setLoadingSpots] = useState(false)

  useEffect(() => {
    map.current = L.map(el.current).setView(value ? [value.lat, value.lng] : GUATE, value ? 16 : 13)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }).addTo(map.current)
    return () => { map.current.remove(); marker.current = null; spots.current = null }
  }, [])

  useEffect(() => {
    if (!onChange) return
    const onClick = e => onChange({ lat: e.latlng.lat, lng: e.latlng.lng })
    map.current.on('click', onClick)
    return () => map.current.off('click', onClick)
  }, [onChange])

  useEffect(() => {
    if (!value) return
    if (marker.current) marker.current.setLatLng([value.lat, value.lng])
    else marker.current = L.marker([value.lat, value.lng]).addTo(map.current)
  }, [value?.lat, value?.lng])

  function locate() {
    navigator.geolocation.getCurrentPosition(
      p => {
        onChange({ lat: p.coords.latitude, lng: p.coords.longitude })
        map.current.setView([p.coords.latitude, p.coords.longitude], 17)
      },
      () => alert('No se pudo obtener tu ubicación'),
    )
  }

  async function showSpots() {
    setLoadingSpots(true)
    try {
      const c = map.current.getCenter()
      const list = await safeSpots(c.lat, c.lng)
      spots.current?.remove()
      spots.current = L.layerGroup(list.map(s =>
        L.marker([s.lat, s.lng], { icon: L.divIcon({ html: SPOT_ICON[s.kind] ?? '📍', className: 'spot', iconSize: [30, 30] }) })
          .bindTooltip(s.label)
          .on('click', () => onChange(s)),
      )).addTo(map.current)
      if (!list.length) alert('No encontramos lugares públicos aquí. Mueve el mapa y prueba de nuevo.')
    } catch {
      alert('No se pudieron cargar los lugares. Intenta de nuevo.')
    } finally {
      setLoadingSpots(false)
    }
  }

  return (
    <div className="map-wrap">
      <div ref={el} className="map" />
      {onChange && (
        <div className="map-tools">
          <button type="button" className="btn small" onClick={showSpots} disabled={loadingSpots}>
            {loadingSpots ? 'Buscando…' : '🛡️ Lugares públicos'}
          </button>
          <button type="button" className="btn small" onClick={locate}>📍 Mi ubicación</button>
        </div>
      )}
    </div>
  )
}

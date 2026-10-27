import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, NavLink, Link, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth, sb, configured } from './lib.jsx'
import { Login } from './Auth.jsx'
import { Explore, BookPage, BookForm, Discover } from './Books.jsx'
import { PublicProfile, EditProfile } from './Profile.jsx'
import { OffersList, OfferPage } from './Offers.jsx'
import { Admin } from './Admin.jsx'
import './styles.css'

function Private({ children }) {
  const { session } = useAuth()
  if (session === undefined) return null
  return session ? children : <Navigate to="/login" replace />
}

function Layout() {
  const { session, uid, profile } = useAuth()
  return (
    <>
      <header className="topbar">
        <Link to="/" className="logo">📚 Comelibros</Link>
        {session
          ? <button className="link" onClick={() => sb.auth.signOut()}>Salir</button>
          : <Link to="/login" className="btn small">Entrar</Link>}
      </header>
      {profile?.banned && <div className="banner">Tu cuenta está suspendida. Puedes ver, pero no publicar ni ofertar.</div>}
      <main className="container">
        <Routes>
          <Route path="/" element={<Explore />} />
          <Route path="/login" element={<Login />} />
          <Route path="/descubrir" element={<Discover />} />
          <Route path="/libro/:id" element={<BookPage />} />
          <Route path="/u/:id" element={<PublicProfile />} />
          <Route path="/publicar" element={<Private><BookForm /></Private>} />
          <Route path="/libro/:id/editar" element={<Private><BookForm /></Private>} />
          <Route path="/perfil/editar" element={<Private><EditProfile /></Private>} />
          <Route path="/ofertas" element={<Private><OffersList /></Private>} />
          <Route path="/oferta/:id" element={<Private><OfferPage /></Private>} />
          <Route path="/admin" element={<Private><Admin /></Private>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {session && (
        <nav className="tabbar">
          <NavLink to="/" end>🔎<span>Explorar</span></NavLink>
          <NavLink to="/publicar">➕<span>Publicar</span></NavLink>
          <NavLink to="/ofertas">💬<span>Ofertas</span></NavLink>
          <NavLink to={`/u/${uid}`}>👤<span>Perfil</span></NavLink>
          {profile?.is_admin && <NavLink to="/admin">🛡️<span>Admin</span></NavLink>}
        </nav>
      )}
    </>
  )
}

createRoot(document.getElementById('root')).render(
  !configured ? (
    <main className="container card narrow">
      <h1>Falta configurar Supabase</h1>
      <p>Crea el archivo <code>.env</code> en la raíz (copia <code>.env.example</code>) con <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code>, y reinicia <code>npm run dev</code>.</p>
    </main>
  ) : <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Layout />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)

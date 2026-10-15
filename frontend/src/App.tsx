import { useEffect, useState } from 'react'
import Assistant from './Assistant'
import BankView from './BankView'
import Deals from './Deals'
import Home from './Home'
import Login from './Login'
import { get, post } from './api'
import type { User } from './api'
import MapView from './MapView'
import Prep from './Prep'
import Settings from './Settings'

/** Tiny hash router: #/, #/prep?bank=Citi&round=Superday, #/map, #/bank/Citi */
function useRoute() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onChange = () => {
      setHash(window.location.hash)
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const [path, query = ''] = hash.replace(/^#/, '').split('?')
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(query) }
}

export default function App() {
  const { parts, query } = useRoute()
  const [section, arg] = parts
  const [version, setVersion] = useState(0)
  // Who is signed in: undefined while checking, null when nobody is.
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [offline, setOffline] = useState(false)

  useEffect(() => {
    get<{ user: User | null }>('/api/session')
      .then((s) => setUser(s.user))
      .catch(() => setOffline(true))
    const lapsed = () => setUser(null)
    window.addEventListener('auth-required', lapsed)
    return () => window.removeEventListener('auth-required', lapsed)
  }, [])

  async function signOut() {
    await post('/api/logout', {}).catch(() => undefined)
    setUser(null)
  }

  if (offline)
    return <p className="notice error">Could not reach the app's server. If the site was asleep, wait a minute and refresh.</p>
  if (user === undefined) return <p className="notice">Loading…</p>
  if (user === null) return <Login onDone={setUser} />
  let page = <Home />
  if (section === 'prep') page = <Prep bank={query.get('bank') ?? ''} round={query.get('round') ?? ''} who={query.get('who') ?? ''} />
  if (section === 'map') page = <MapView />
  if (section === 'deals') page = <Deals />
  if (section === 'settings') page = <Settings user={user} />
  if (section === 'bank' && arg) page = <BankView bank={arg} />

  return (
    <>
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="brand-mark">R</span> Recruiting HQ
        </a>
        <nav>
          <a href="#/prep" className={section === 'prep' ? 'active' : ''}>
            Interview Prep
          </a>
          <a href="#/map" className={section === 'map' || section === 'bank' ? 'active' : ''}>
            Recruiting Map
          </a>
          <a href="#/deals" className={section === 'deals' ? 'active' : ''}>
            My Deals
          </a>
          <a href="#/settings" className={section === 'settings' ? 'active' : ''}>
            Settings
          </a>
          <button className="signout" onClick={signOut} title={`Signed in as ${user.email}`}>
            Sign out
          </button>
        </nav>
      </header>
      {/* Re-keying the page after the assistant changes something makes it reload its data. */}
      <main key={version}>{page}</main>
      <Assistant key={user.id} userId={user.id} onChanged={() => setVersion((v) => v + 1)} />
    </>
  )
}

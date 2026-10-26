import { useEffect, useState } from 'react'
import Assistant from './Assistant'
import BankView from './BankView'
import Deals from './Deals'
import Home from './Home'
import Letters from './Letters'
import Login, { VerifyEmail } from './Login'
import { get, post } from './api'
import type { School, Session, User } from './api'
import MapView from './MapView'
import Prep from './Prep'
import Settings from './Settings'
import Setup from './Setup'
import Tour from './Tour'
import { PreviewContext, SchoolContext, useSchool } from './ui'

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
  const [school, setSchool] = useState<School | undefined>(undefined)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [offline, setOffline] = useState(false)
  const fallback = useSchool()

  function loadSession() {
    return get<Session>('/api/session')
      .then((s) => {
        setUser(s.user)
        setSchool(s.context)
        setNeedsSetup(!!s.needs_setup)
      })
      .catch(() => setOffline(true))
  }

  useEffect(() => {
    loadSession()
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
  if (user === null) return <Login onDone={() => loadSession()} />
  if (!user.email_verified) return <VerifyEmail user={user} onDone={() => loadSession()} onSignOut={signOut} />
  if (needsSetup || section === 'setup')
    return (
      <SchoolContext.Provider value={school ?? fallback}>
        <header className="topbar">
          <span className="brand">
            <span className="brand-mark">R</span> Recruiting HQ
          </span>
          <nav>
            <button className="signout" onClick={signOut}>Sign out</button>
          </nav>
        </header>
        <main>
          <Setup
            onDone={() => {
              window.location.hash = '#/tour'
              loadSession()
            }}
          />
        </main>
      </SchoolContext.Provider>
    )
  const isHome = !section
  // Each section gets its own photo along the top, fading into the navy page.
  const backdrop = ({ prep: 'harkness', map: 'yale-night', bank: 'yale-night', deals: 'nyse', letters: 'sterling', settings: 'yale-night' } as Record<string, string>)[section ?? '']
  let page = <Home name={user.name} assistant={<Assistant key={`inline-${user.id}-${version}`} inline userId={user.id} onChanged={() => setVersion((v) => v + 1)} />} />
  if (section === 'prep') page = <Prep bank={query.get('bank') ?? ''} round={query.get('round') ?? ''} who={query.get('who') ?? ''} tab={query.get('tab') ?? ''} />
  if (section === 'map') page = <MapView />
  if (section === 'deals') page = <Deals />
  if (section === 'tour') page = <Tour />
  if (section === 'settings') page = <Settings user={user} />
  if (section === 'letters') page = <Letters bank={arg ?? ''} />
  if (section === 'bank' && arg) page = <BankView bank={arg} initial={query.get('sel') ?? ''} />

  return (
    <PreviewContext.Provider value={!!user.preview}>
    <SchoolContext.Provider value={school ?? fallback}>
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="brand-mark">R</span> Recruiting HQ
        </a>
        {user.preview && (
          <span className="preview-badge" title="Your account sees changes being tried out before they go to everyone">
            Preview
          </span>
        )}
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
          <a href="#/letters" className={section === 'letters' ? 'active' : ''}>
            Cover Letters
          </a>
          <a href="#/settings" className={section === 'settings' ? 'active' : ''}>
            Settings
          </a>
          <button className="signout" onClick={signOut} title={`Signed in as ${user.email}`}>
            Sign out
          </button>
        </nav>
      </header>
      {backdrop && <div className="page-backdrop" style={{ backgroundImage: `url(/bg-${backdrop}.jpg)` }} aria-hidden />}
      {/* Re-keying the page after the assistant changes something makes it reload its data. */}
      <main key={version}>{page}</main>
      {!isHome && section !== 'tour' && <Assistant key={user.id} userId={user.id} onChanged={() => setVersion((v) => v + 1)} />}
    </SchoolContext.Provider>
    </PreviewContext.Provider>
  )
}

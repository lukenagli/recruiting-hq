import { useEffect, useState } from 'react'
import Admin from './Admin'
import Assistant from './Assistant'
import BankView from './BankView'
import CatchUp from './CatchUp'
import Deals from './Deals'
import HomeNext from './HomeNext'
import Letters from './Letters'
import Login, { VerifyEmail } from './Login'
import { get, post } from './api'
import type { School, Session, User } from './api'
import MapView from './MapView'
import Prep from './Prep'
import Settings from './Settings'
import Setup from './Setup'
import Start from './Start'
import Tour, { TOUR_SEEN } from './Tour'
import { SchoolContext, useSchool } from './ui'

/** The logo in the top bar: the app icon. */
function BrandMark() {
  return <img className="brand-mark brand-icon" src="/app-192.png" alt="" width={26} height={26} />
}

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
  const [tourSeen, setTourSeen] = useState(() => {
    try {
      return localStorage.getItem(TOUR_SEEN) === '1'
    } catch {
      return false
    }
  })
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

  // The app icon (home screen, browser tab, installed app on Windows) once someone is signed in.
  useEffect(() => {
    if (!user) return
    const set = (rel: string, href: string) => {
      let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`)
      if (!el) {
        el = document.createElement('link')
        el.rel = rel
        document.head.appendChild(el)
      }
      el.href = href
    }
    set('icon', '/app-icon.ico')
    set('apple-touch-icon', '/app-apple-touch.png')
    set('manifest', '/app.webmanifest')
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#0a183a')
    document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', 'Recruiting HQ')
  }, [user])

  async function signOut() {
    await post('/api/logout', {}).catch(() => undefined)
    setUser(null)
  }

  if (offline)
    return <p className="notice error">Could not reach the app's server. If the site was asleep, wait a minute and refresh.</p>
  if (user === undefined) return <p className="notice">Loading…</p>
  if (user === null) return <Login onDone={() => loadSession()} />
  if (!user.email_verified) return <VerifyEmail user={user} onDone={() => loadSession()} onSignOut={signOut} />
  // Someone setting up for the first time sees the tour first (once per browser), then setup.
  const tourFirst = needsSetup && section !== 'setup' && !tourSeen
  if (needsSetup || section === 'setup')
    return (
      <SchoolContext.Provider value={school ?? fallback}>
        <header className="topbar">
          <span className="brand">
            <BrandMark /> Recruiting HQ
          </span>
          <nav>
            <button className="signout" onClick={signOut}>Sign out</button>
          </nav>
        </header>
        <main>
          {tourFirst ? (
            <Tour beforeSetup={() => { setTourSeen(true); window.scrollTo(0, 0) }} />
          ) : (
            <Setup
              onDone={() => {
                window.location.hash = '#/' // the tour came first
                loadSession()
              }}
            />
          )}
        </main>
      </SchoolContext.Provider>
    )
  // Each section gets its own photo along the top, fading into the navy page.
  const backdrop = ({ prep: 'harkness', map: 'yale-night', bank: 'yale-night', deals: 'nyse', letters: 'sterling', settings: 'yale-night' } as Record<string, string>)[section ?? '']
  let page = <HomeNext name={user.name} />
  if (section === 'prep') page = <Prep bank={query.get('bank') ?? ''} round={query.get('round') ?? ''} who={query.get('who') ?? ''} tab={query.get('tab') ?? ''} />
  if (section === 'map') page = <MapView />
  if (section === 'deals') page = <Deals />
  if (section === 'tour') page = <Tour />
  if (section === 'settings') page = <Settings user={user} onSignOut={signOut} section={arg ?? ''} />
  if (section === 'start') page = <Start />
  if (section === 'catch-up') page = <CatchUp />
  if (section === 'letters') page = <Letters bank={arg ?? ''} />
  if (section === 'bank' && arg) page = <BankView bank={arg} initial={query.get('sel') ?? ''} />
  if (section === 'admin' && user.is_admin) page = <Admin me={user.id} />

  return (
    <SchoolContext.Provider value={school ?? fallback}>
      <header className="topbar preview-bar">
        <a className="brand" href="#/">
          <BrandMark /> <span>Recruiting <span className="brand-hq">HQ</span></span>
        </a>
        <nav>
          {user.is_admin && (
            <a href="#/admin" className={section === 'admin' ? 'active' : ''}>
              Admin
            </a>
          )}
          <a href="#/prep" className={section === 'prep' ? 'active' : ''}>
            <span className="nav-long">Interview </span>Prep
          </a>
          <a href="#/map" className={section === 'map' || section === 'bank' ? 'active' : ''}>
            <span className="nav-long">Recruiting </span>Map
          </a>
          <a href="#/deals" className={section === 'deals' ? 'active' : ''}>
            <span className="nav-long">My </span>Deals
          </a>
          <a href="#/letters" className={section === 'letters' ? 'active' : ''}>
            <span className="nav-long">Cover </span>Letters
          </a>
          <a href="#/settings" className={`nav-gear ${section === 'settings' ? 'active' : ''}`} aria-label="Settings" title={`Settings · signed in as ${user.email}`}>
              <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>
            </a>
        </nav>
      </header>
      {backdrop && <div className="page-backdrop" style={{ backgroundImage: `url(/bg-${backdrop}.jpg)` }} aria-hidden />}
      {/* Re-keying the page after the assistant changes something makes it reload its data. */}
      <main key={version} className="preview-on">{page}</main>
      {/* the assistant opens only from the home page's update bar (no corner button, no panel on other pages) */}
      {section !== 'tour' && section !== 'catch-up' && <Assistant key={user.id} userId={user.id} onChanged={() => setVersion((v) => v + 1)} />}
    </SchoolContext.Provider>
  )
}

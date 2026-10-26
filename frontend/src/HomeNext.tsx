import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { AiSettings, CalendarItem, HomeData } from './api'
import { Loading, daysUntil, fmtDate, useApi, useSchool } from './ui'

/**
 * Preview home: one place that says what to do next. A new account is asked where it is in recruiting
 * (just starting, or already networking); everyone else sees the update box, a single to-do list and the season.
 */

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function inDays(n: number) {
  return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n < 0 ? `${-n} days ago` : `in ${n} days`
}

type Todo = { key: string; title: string; sub: string; href: string; when: string; urgent?: boolean; order: string }

function todos(d: HomeData): Todo[] {
  const out: Todo[] = []
  for (const t of d.thank_yous_due)
    out.push({
      key: `ty-${t.who}-${t.bank}`, title: `Send ${t.who} a thank-you`, sub: t.bank, href: `#/bank/${encodeURIComponent(t.bank)}`,
      when: !t.date ? '' : t.date === d.today ? 'spoke today' : `spoke ${fmtDate(t.date)}`, urgent: true, order: '0',
    })
  for (const u of d.upcoming) {
    const n = daysUntil(u.date, d.today)
    out.push({
      key: `up-${u.title}-${u.date}`, title: u.title, sub: `${u.bank} · get ready`, href: `#/prep?bank=${encodeURIComponent(u.bank)}`,
      when: `${fmtDate(u.date, true)} · ${inDays(n)}`, urgent: n <= 2, order: `1${u.date}`,
    })
  }
  for (const a of d.deadlines) {
    const n = daysUntil(a.date, d.today)
    out.push({
      key: `ap-${a.bank}`, title: `Apply to ${a.bank}`, sub: 'Application not marked as sent', href: `#/bank/${encodeURIComponent(a.bank)}`,
      when: `due ${fmtDate(a.date)} · ${inDays(n)}`, urgent: n <= 7, order: `1${a.date}`,
    })
  }
  return out.sort((a, b) => a.order.localeCompare(b.order))
}

/** The club's season as a strip: what's done, what's next, and how far away it is. */
function Season({ items, today }: { items: CalendarItem[]; today: string }) {
  const next = items.findIndex((i) => (i.end || i.date) >= today)
  const strip = useRef<HTMLOListElement>(null)
  // Start the strip at the last finished step, so what's next is in view.
  useEffect(() => {
    const el = strip.current?.children[Math.max(0, next - 1)] as HTMLElement | undefined
    if (strip.current && el) strip.current.scrollLeft = el.offsetLeft - strip.current.offsetLeft
  }, [next])
  return (
    <section className="season">
      <h2>The season</h2>
      <ol className="season-strip" ref={strip}>
        {items.map((i, n) => {
          const past = next === -1 || n < next
          const now = i.date <= today && (i.end || i.date) >= today
          return (
            <li key={i.title} className={past ? 'past' : n === next ? 'next' : ''}>
              <span className="season-dot" aria-hidden>{past ? '✓' : ''}</span>
              <strong>{i.title}</strong>
              <small>
                {fmtDate(i.date)}
                {i.end ? `–${fmtDate(i.end)}` : ''}
                {!past && ` · ${now ? 'now' : inDays(daysUntil(i.date, today))}`}
              </small>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function StartFork() {
  return (
    <section className="fork">
      <h2>Where are you in recruiting?</h2>
      <div className="fork-choices">
        <a className="fork-choice" href="#/start">
          <span className="fork-emoji" aria-hidden>🌱</span>
          <strong>I'm just getting started</strong>
          <span>How banking recruiting works, step by step, and your first outreach email.</span>
        </a>
        <a className="fork-choice" href="#/catch-up">
          <span className="fork-emoji" aria-hidden>📇</span>
          <strong>I've already been networking</strong>
          <span>Bring in everyone you've talked to, one bank at a time. A few minutes per bank.</span>
        </a>
      </div>
    </section>
  )
}

export default function HomeNext({ name, assistant }: { name: string; assistant: ReactNode }) {
  const { data, error } = useApi<HomeData>('/api/home')
  const ai = useApi<AiSettings>('/api/settings/ai')
  const cal = useApi<CalendarItem[]>('/api/calendar')
  const school = useSchool()
  const [all, setAll] = useState(false)
  const first = name.split(' ')[0]
  const list = data ? todos(data) : []
  const shown = all ? list : list.slice(0, 5)
  const newcomer = data?.totals.people === 0

  return (
    <div className="home next">
      <header className="home-hero">
        <div className="home-hero-text">
          <h1>
            {greeting()}
            {first ? `, ${first}` : ''}.
          </h1>
          {data && !newcomer && (
            <p>{list.length === 0 ? "You're all caught up." : `${list.length} ${list.length === 1 ? 'thing' : 'things'} to do.`}</p>
          )}
          {newcomer && <p>Let's get your recruiting in one place.</p>}
        </div>
        <a className="photo-credit" href="https://commons.wikimedia.org/wiki/File:Manhattan_Skyline_2016.jpg" target="_blank" rel="noreferrer">
          Photo: Mike Sinko, CC BY 2.0
        </a>
      </header>

      <div className="home-body">
        {ai.data && !ai.data.ready && (
          <a className="notice key-callout" href="#/settings">
            <strong>One thing first:</strong> paste your Yale class (Portkey) key in Settings to turn on the assistant.
          </a>
        )}
        {newcomer && <StartFork />}
        {assistant}

        {!data ? (
          <Loading error={error} />
        ) : (
          !newcomer && (
            <section className="todo card">
              <div className="todo-head">
                <h2>Up next</h2>
                <a href="#/catch-up" className="todo-catchup">
                  Haven't logged everyone yet? Catch up →
                </a>
              </div>
              {list.length === 0 && <p className="muted">Nothing due. Log a chat above when you have one.</p>}
              <ul>
                {shown.map((t) => (
                  <li key={t.key}>
                    <a href={t.href} className={t.urgent ? 'urgent' : ''}>
                      <span>
                        <strong>{t.title}</strong>
                        <small>{t.sub}</small>
                      </span>
                      <em>{t.when}</em>
                    </a>
                  </li>
                ))}
              </ul>
              {list.length > 5 && (
                <button className="link" onClick={() => setAll(!all)}>
                  {all ? 'Show less' : `Show all ${list.length}`}
                </button>
              )}
            </section>
          )
        )}

        {data && cal.data && cal.data.length > 0 && school.club && <Season items={cal.data} today={data.today} />}

        <nav className="places">
          <a href="#/map">
            <strong>Recruiting Map</strong>
            <span>{data ? `${data.totals.people} people · ${data.totals.banks} banks` : 'Everyone you’ve met, by bank'}</span>
          </a>
          <a href="#/prep">
            <strong>Interview Prep</strong>
            <span>Real questions, graded answers</span>
          </a>
          <a href="#/deals">
            <strong>My Deals</strong>
            <span>Your 90-second deal pitch</span>
          </a>
          <a href="#/letters">
            <strong>Cover Letters</strong>
            <span>Written from your chats</span>
          </a>
          <a href="#/start">
            <strong>How recruiting works</strong>
            <span>The whole process, step by step</span>
          </a>
        </nav>
      </div>
    </div>
  )
}

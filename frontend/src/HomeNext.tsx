import { useEffect, useRef, useState } from 'react'
import { ASK_EVENT } from './Assistant'
import type { AiSettings, BankSummary, CalendarItem, HomeData } from './api'
import { useDictation } from './dictation'
import { Loading, Logo, StagePips, daysUntil, fmtDate, useApi, useSchool } from './ui'

/**
 * Preview home: a dashboard. The header holds a one-line update bar that hands what you type to the assistant
 * panel; below it, the week ahead by day, one to-do list, every bank as a pipeline, and the club's season.
 * A new account is first asked where it is in recruiting (just starting, or already networking).
 */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function inDays(n: number) {
  return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n < 0 ? `${-n} days ago` : `in ${n} days`
}

function dayLabel(iso: string, today: string) {
  const n = daysUntil(iso, today)
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  const [y, m, d] = iso.split('-').map(Number)
  return `${DAYS[new Date(y, m - 1, d).getDay()]}, ${MONTHS[m - 1].slice(0, 3)} ${d}`
}

function ask(detail: { text?: string; record?: 'recap' | 'conversation' }) {
  window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail }))
}

/** One line in the header: tell the assistant what happened. It opens in the side panel. */
function UpdateBar() {
  const [text, setText] = useState('')
  const dictation = useDictation((phrase) => setText((t) => `${t}${t && !/\s$/.test(t) ? ' ' : ''}${phrase}`))
  function go(e?: React.FormEvent) {
    e?.preventDefault()
    dictation.stop()
    if (!text.trim()) return ask({})
    ask({ text })
    setText('')
  }
  return (
    <>
      <form className="update-bar" onSubmit={go}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={dictation.listening ? 'Listening…' : 'What happened? A chat, an email, an invite…'}
          aria-label="Tell the assistant what happened"
        />
        {dictation.supported && (
          <button type="button" className={`bar-icon ${dictation.listening ? 'listening' : ''}`} onClick={dictation.toggle}
            aria-label={dictation.listening ? 'Stop dictating' : 'Dictate'} title={dictation.listening ? 'Stop dictating' : 'Dictate'}>
            <svg viewBox="0 0 24 24" aria-hidden><path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          </button>
        )}
        <button type="submit" className="bar-send" aria-label="Send to the assistant" title="Send">
          <svg viewBox="0 0 24 24" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </button>
      </form>
      <div className="update-links">
        <button type="button" onClick={() => ask({ record: 'conversation' })}><span aria-hidden>●</span> Record a coffee chat</button>
        <button type="button" onClick={() => ask({})}>Open the assistant</button>
      </div>
    </>
  )
}

function Agenda({ d, out }: { d: HomeData; out: Set<string> }) {
  const items = [
    ...d.upcoming.map((u) => ({ date: u.date, time: (u.date_note ?? '').split(',')[0], title: u.title, bank: u.bank, kind: u.kind })),
    ...d.deadlines.filter((a) => !out.has(a.bank)).map((a) => ({ date: a.date, time: '', title: 'Application due', bank: a.bank, kind: 'deadline' })),
  ].filter((i) => daysUntil(i.date, d.today) <= 7).sort((a, b) => a.date.localeCompare(b.date))
  const days = [...new Set(items.map((i) => i.date))]
  return (
    <section className="dash-card agenda">
      <h2>This week</h2>
      {days.length === 0 && <p className="muted">Nothing scheduled in the next seven days.</p>}
      {days.map((day) => (
        <div className="agenda-day" key={day}>
          <h3>{dayLabel(day, d.today)}</h3>
          <ul>
            {items.filter((i) => i.date === day).map((i) => (
              <li key={`${i.bank}-${i.title}`} className={`k-${i.kind}`}>
                <a href={i.kind === 'deadline' ? `#/bank/${encodeURIComponent(i.bank)}` : `#/prep?bank=${encodeURIComponent(i.bank)}`}>
                  <span className="agenda-time">{i.time || (i.kind === 'deadline' ? 'Due' : '')}</span>
                  <span className="agenda-what">
                    <strong>{i.title}</strong>
                    <small>{i.bank}</small>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

function Todos({ d, out }: { d: HomeData; out: Set<string> }) {
  const [all, setAll] = useState(false)
  const items = [
    ...d.thank_yous_due.map((t) => ({ key: `ty${t.who}`, title: `Thank-you to ${t.who}`, bank: t.bank, when: t.date ? `spoke ${fmtDate(t.date)}` : '', urgent: true })),
    ...(d.todos ?? []).map((t) => ({ key: `td${t.bank}${t.title}`, title: t.title, bank: t.bank, when: t.date ? fmtDate(t.date) : '', urgent: !!t.date && daysUntil(t.date, d.today) <= 1 })),
    ...d.deadlines.filter((a) => !out.has(a.bank) && daysUntil(a.date, d.today) > 7).map((a) => ({ key: `ap${a.bank}`, title: `Apply to ${a.bank}`, bank: a.bank, when: `due ${fmtDate(a.date)}`, urgent: false })),
  ]
  const shown = all ? items : items.slice(0, 7)
  return (
    <section className="dash-card todos">
      <h2>
        To do <span className="count">{items.length}</span>
      </h2>
      {items.length === 0 && <p className="muted">All caught up.</p>}
      <ul>
        {shown.map((t) => (
          <li key={t.key}>
            <a href={`#/bank/${encodeURIComponent(t.bank)}`} className={t.urgent ? 'urgent' : ''}>
              <span className="todo-dot" aria-hidden />
              <span className="todo-what">
                <strong>{t.title}</strong>
                <small>{[t.bank, t.when].filter(Boolean).join(' · ')}</small>
              </span>
            </a>
          </li>
        ))}
      </ul>
      {items.length > 7 && (
        <button className="link" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all ${items.length}`}</button>
      )}
    </section>
  )
}

function Pipeline({ banks, today }: { banks: BankSummary[]; today: string }) {
  const live = banks.filter((b) => b.application.status !== 'out')
  const out = banks.filter((b) => b.application.status === 'out')
  return (
    <section className="pipeline">
      <div className="section-head">
        <h2>Your banks</h2>
        <a href="#/map">Recruiting Map →</a>
      </div>
      <div className="pipe-grid">
        {live.map((b) => {
          const stage = [...b.stage].reverse().find((s) => s.done)?.label ?? 'Not started'
          return (
            <a key={b.bank} className="pipe-tile" href={`#/bank/${encodeURIComponent(b.bank)}`}>
              <span className="pipe-top">
                <Logo bank={b.bank} domain={b.domain} size={30} />
                <strong>{b.bank}</strong>
              </span>
              <StagePips stage={b.stage} />
              <span className="pipe-stage">{stage}</span>
              <small>
                {b.next_up ? `Next: ${b.next_up.title}, ${inDays(daysUntil(b.next_up.date, today))}` : b.last_touch ? `Last contact ${fmtDate(b.last_touch)}` : `${b.people} people`}
              </small>
            </a>
          )
        })}
      </div>
      {out.length > 0 && <p className="pipe-out">No longer in process: {out.map((b) => b.bank).join(', ')}</p>}
    </section>
  )
}

/** The club's fixed milestones (weekly club meetings move around, so they are left out). */
function Season({ items, today }: { items: CalendarItem[]; today: string }) {
  const marks = items.filter((i) => !/^club meeting/i.test(i.title))
  const next = marks.findIndex((i) => (i.end || i.date) >= today)
  const strip = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const el = strip.current?.children[Math.max(0, next - 1)] as HTMLElement | undefined
    if (strip.current && el) strip.current.scrollLeft = el.offsetLeft - strip.current.offsetLeft
  }, [next])
  if (!marks.length) return null
  return (
    <section className="season">
      <h2>The season</h2>
      <ol className="season-strip" ref={strip}>
        {marks.map((i, n) => {
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

function summary(d: HomeData) {
  const today = d.upcoming.filter((u) => u.date === d.today).length
  const tomorrow = d.upcoming.filter((u) => daysUntil(u.date, d.today) === 1).length
  const todo = d.thank_yous_due.length + (d.todos?.length ?? 0)
  return [
    today ? `${today} on today` : tomorrow ? `${tomorrow} on tomorrow` : 'Nothing on tomorrow',
    todo ? `${todo} to do` : 'all caught up',
  ].join(' · ')
}

export default function HomeNext({ name }: { name: string }) {
  const { data, error } = useApi<HomeData>('/api/home')
  const banks = useApi<BankSummary[]>('/api/banks')
  const ai = useApi<AiSettings>('/api/settings/ai')
  const cal = useApi<CalendarItem[]>('/api/calendar')
  const school = useSchool()
  const first = name.split(' ')[0]
  const newcomer = data?.totals.people === 0
  // banks the student is no longer in the process with: their deadlines no longer matter
  const out = new Set((banks.data ?? []).filter((b) => b.application.status === 'out').map((b) => b.bank))
  const now = new Date()

  return (
    <div className="home next">
      <header className="home-hero compact">
        <div className="home-hero-text">
          <p className="hero-date">
            {DAYS[now.getDay()]}, {MONTHS[now.getMonth()]} {now.getDate()}
          </p>
          <h1>
            {greeting()}
            {first ? `, ${first}` : ''}.
          </h1>
          <p className="hero-summary">{data ? (newcomer ? "Let's get your recruiting in one place." : summary(data)) : ' '}</p>
          <UpdateBar />
        </div>
        <a className="photo-credit" href="https://commons.wikimedia.org/wiki/File:Manhattan_Skyline_2016.jpg" target="_blank" rel="noreferrer">
          Photo: Mike Sinko, CC BY 2.0
        </a>
      </header>

      <div className="dash">
        {ai.data && !ai.data.ready && (
          <a className="notice key-callout" href="#/settings">
            <strong>One thing first:</strong> paste your Yale class (Portkey) key in Settings to turn on the assistant.
          </a>
        )}
        {newcomer && <StartFork />}
        {!data ? (
          <Loading error={error} />
        ) : (
          !newcomer && (
            <div className="dash-grid">
              <Agenda d={data} out={out} />
              <Todos d={data} out={out} />
            </div>
          )
        )}
        {data && banks.data && banks.data.length > 0 && <Pipeline banks={banks.data} today={data.today} />}
        {data && cal.data && school.club && <Season items={cal.data} today={data.today} />}
      </div>
    </div>
  )
}

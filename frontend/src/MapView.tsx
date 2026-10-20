import type { CalendarItem } from './api'
import { Loading, Logo, daysUntil, fmtDate, useApi } from './ui'

/**
 * The recruiting map: every bank as a row on one shared calendar. One-on-one chats are circles with the
 * person's initials (dark for bankers, light for Yale 2Ys), events where you met several people at once are
 * squares with how many you met, interviews are diamonds, and people you have reached out to but not met yet
 * are dashed circles. Upcoming items are hollow. A line joins two items only when one really led to the other
 * (a referral, an invitation, a suggestion); otherwise the calendar position says when it happened.
 */

type Mark = {
  id: string
  kind: 'chat' | 'event' | 'interview' | 'step' | 'outreach'
  who: 'banker' | 'yale' | ''
  date: string
  status: string
  title: string
  people: string[]
  label: string
  detail: string
  invite_only?: boolean
}
type Row = {
  bank: string
  domain: string
  out: boolean
  out_reason: string
  group: string
  applied: string
  deadline: string
  marks: Mark[]
  links: { from: string; to: string; label: string }[]
  next: { title: string; date: string } | null
  waiting: number
  chats: number
  events: number
}
type Timeline = { today: string; start: string; end: string; rows: Row[] }

const DAY = 86400000
const LANE = 30
const STACK_GAP = 3.4 // percent of the track two marks must be apart to share a lane

const time = (iso: string) => new Date(iso + 'T12:00:00').getTime()

function axis(t: Timeline) {
  const start = time(t.start) - 4 * DAY
  const end = Math.max(time(t.end), time(t.today) + 10 * DAY) + 6 * DAY
  // Dated items use the first 92% of the track; items with no date sit in a separate area at the end.
  const scale = (ms: number) => ((ms - start) / (end - start)) * 92
  const at = (iso: string) => (iso ? scale(time(iso)) : 96.5)
  const months: { x: number; label: string }[] = []
  const d = new Date(start)
  d.setDate(1)
  d.setMonth(d.getMonth() + 1)
  while (d.getTime() < end) {
    months.push({ x: scale(d.getTime()), label: d.toLocaleString('en-US', { month: 'short' }) })
    d.setMonth(d.getMonth() + 1)
  }
  const weeks: number[] = []
  const w = new Date(start)
  w.setDate(w.getDate() + ((8 - w.getDay()) % 7)) // Mondays
  while (w.getTime() < end) {
    weeks.push(scale(w.getTime()))
    w.setDate(w.getDate() + 7)
  }
  return { at, months, weeks, today: at(t.today) }
}

function place(marks: Mark[], at: (iso: string) => number) {
  const lanes: number[] = []
  const placed = [...marks]
    .sort((a, b) => at(a.date) - at(b.date))
    .map((m) => {
      const x = at(m.date)
      let lane = lanes.findIndex((last) => x - last >= STACK_GAP)
      if (lane === -1) lane = lanes.length
      lanes[lane] = x
      return { m, x, lane }
    })
  return { placed, lanes: Math.max(lanes.length, 1) }
}

/** Logged as coming up, but the date has passed: it probably happened and was never updated. */
const stale = (m: Mark, today: string) => !!m.date && m.date < today && ['upcoming', 'scheduled'].includes(m.status)

function tip(m: Mark, today = '') {
  const when = m.date ? fmtDate(m.date, true) : 'date not set'
  if (today && stale(m, today)) return `${when} · ${m.title || m.people.join(' and ')}\nStill marked as coming up. Did it happen? Tell the assistant.`
  if (m.kind === 'event') return `${when} · ${m.title}${m.invite_only ? ' (invite only)' : ''}${m.people.length ? `\nMet: ${m.people.join(', ')}` : ''}`
  if (m.kind === 'outreach') return `${when} · Reached out to ${m.people[0]}${m.detail ? ` (${m.detail})` : ''}, no chat yet`
  if (m.kind === 'chat') return `${when} · ${m.status === 'done' ? 'Chat' : 'Scheduled chat'} with ${m.people.join(' and ')}${m.detail ? ` (${m.detail})` : ''}`
  return `${when} · ${m.title}${m.detail ? ` (${m.detail})` : ''}`
}

function BankRow({ r, ax, today }: { r: Row; ax: ReturnType<typeof axis>; today: string }) {
  const { placed, lanes } = place(r.marks, ax.at)
  const height = 14 + lanes * LANE
  const pos = new Map(placed.map((p) => [p.m.id, p]))
  const go = (id: string) => (window.location.hash = `#/bank/${encodeURIComponent(r.bank)}?sel=${encodeURIComponent(id)}`)

  return (
    <div className={`tl-row ${r.out ? 'out' : ''}`}>
      <a className="tl-bank" href={`#/bank/${encodeURIComponent(r.bank)}`}>
        <Logo bank={r.bank} domain={r.domain} size={30} />
        <span>
          <strong>{r.bank}</strong>
          <small>
            {r.out ? 'Out of process' : [r.group, r.chats ? `${r.chats} ${r.chats === 1 ? 'chat' : 'chats'}` : '', r.events ? `${r.events} ${r.events === 1 ? 'event' : 'events'}` : ''].filter(Boolean).join(' · ') || 'No contact yet'}
          </small>
        </span>
      </a>
      <div className="tl-track" style={{ height }}>
        {ax.weeks.map((x) => <i key={x} className="tl-week" style={{ left: `${x}%` }} />)}
        <i className="tl-today" style={{ left: `${ax.today}%` }} />
        <i className="tl-nodate-line" />
        <svg className="tl-links" viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none" aria-hidden>
          {r.links.map((l, i) => {
            const a = pos.get(l.from)
            const b = pos.get(l.to)
            if (!a || !b) return null
            const ya = 7 + a.lane * LANE + 13
            const yb = 7 + b.lane * LANE + 13
            const xa = a.x * 10
            const xb = b.x * 10
            return <path key={i} d={`M${xa},${ya} C${(xa + xb) / 2},${ya - 18} ${(xa + xb) / 2},${yb - 18} ${xb},${yb}`} vectorEffect="non-scaling-stroke" />
          })}
        </svg>
        {placed.map(({ m, x, lane }) => (
          <button
            key={m.id + m.title}
            className={`tl-mark k-${m.kind} w-${m.who || 'none'} s-${m.status} ${m.date ? '' : 'undated'} ${stale(m, today) ? 'stale' : ''}`}
            style={{ left: `${x}%`, top: 7 + lane * LANE }}
            title={tip(m, today)}
            onClick={() => go(m.id)}
          >
            <span>{m.kind === 'event' ? (m.people.length || '') : m.kind === 'interview' ? '' : m.label}</span>
          </button>
        ))}
        {r.links.length > 0 && (
          <span className="tl-link-note">
            {r.links.map((l) => {
              const from = r.marks.find((m) => m.id === l.from)
              const to = r.marks.find((m) => m.id === l.to)
              return `${from?.kind === 'event' ? from.title : from?.people[0]} ${l.label} ${to?.people[0] ?? to?.title}`
            }).join(' · ')}
          </span>
        )}
      </div>
      <div className="tl-next">
        {r.out ? (
          <em className="cut">Cut</em>
        ) : r.next ? (
          <>
            <strong>{fmtDate(r.next.date, true)}</strong>
            <small>{r.next.title}</small>
          </>
        ) : r.waiting ? (
          <small>Waiting on {r.waiting} {r.waiting === 1 ? 'reply' : 'replies'}</small>
        ) : r.deadline && r.applied !== 'Yes' ? (
          <>
            <strong>Apply by {fmtDate(r.deadline)}</strong>
            <small>not applied yet</small>
          </>
        ) : (
          <small>{r.applied === 'Yes' ? 'Applied' : 'Nothing scheduled'}</small>
        )}
      </div>
    </div>
  )
}

export default function MapView() {
  const { data, error } = useApi<Timeline>('/api/timeline')
  const calendar = useApi<CalendarItem[]>('/api/calendar')
  if (!data) return <Loading error={error} />
  const ax = axis(data)
  const active = data.rows.filter((r) => !r.out)
  const out = data.rows.filter((r) => r.out)
  const upcoming = (calendar.data ?? []).filter((c) => (c.end || c.date) >= data.today)

  return (
    <div>
      <h1>Recruiting Map</h1>
      <p className="lede">Who you talked to at each bank, when, and what it led to. Hover for details, click to open the bank.</p>

      <div className="tl-legend">
        <span><i className="tl-mark k-chat w-banker s-done" /> Chat with a banker</span>
        <span><i className="tl-mark k-chat w-yale s-done" /> Chat with a Yale 2Y</span>
        <span><i className="tl-mark k-event s-done"><span>3</span></i> Event (number of people met)</span>
        <span><i className="tl-mark k-interview s-upcoming" /> Interview</span>
        <span><i className="tl-mark k-outreach w-banker s-awaiting" /> Reached out, no chat yet</span>
        <span><i className="tl-mark k-chat w-banker s-upcoming" /> Hollow = coming up</span>
        <span><i className="tl-mark k-chat w-banker s-upcoming stale" /> Date passed, not updated</span>
        <span><i className="tl-legend-line" /> Referred or invited</span>
      </div>

      <div className="tl-scroll">
        <div className="tl-grid">
          <div className="tl-row tl-axis">
            <span />
            <div className="tl-track tl-axis-track">
              {ax.months.map((m) => (
                <span key={m.label + m.x} className="tl-month" style={{ left: `${m.x}%` }}>{m.label}</span>
              ))}
              <span className="tl-today-label" style={{ left: `${ax.today}%` }}>Today</span>
              <span className="tl-month tl-nodate" style={{ left: '96.5%' }}>No date</span>
            </div>
            <span className="tl-next-head">Next up</span>
          </div>
          {active.map((r) => <BankRow key={r.bank} r={r} ax={ax} today={data.today} />)}
          {out.length > 0 && <div className="tl-divider">Out of process</div>}
          {out.map((r) => <BankRow key={r.bank} r={r} ax={ax} today={data.today} />)}
        </div>
      </div>

      {upcoming.length > 0 && (
        <>
          <h2>Recruiting calendar</h2>
          <div className="calendar">
            {upcoming.map((c) => {
              const left = daysUntil(c.date, data.today)
              return (
                <div className="card" key={c.title}>
                  <small>{left <= 0 ? 'Now' : `In ${left} days`}</small>
                  <strong>
                    {fmtDate(c.date, true)}
                    {c.end && ` to ${fmtDate(c.end)}`}
                  </strong>
                  <span>{c.title}</span>
                  {c.detail && <small>{c.detail}</small>}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

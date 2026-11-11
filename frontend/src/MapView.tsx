import type { CalendarItem, Progress } from './api'
import SeasonBar from './SeasonBar'
import { Loading, Logo, daysUntil, fmtDate, useApi } from './ui'

/**
 * The recruiting map: one simple row per bank. The season bar shows where you are (Yale network, group-specific chats,
 * the dinner, Super Week), a tick or cross for whether you have applied, and what is next. Click a bank for the
 * detailed picture of who you spoke with and what led to what.
 */

type Row = {
  bank: string
  domain: string
  out: boolean
  out_reason: string
  group: string
  applied: string
  deadline: string
  next: { title: string; date: string } | null
  waiting: number
  chats: number
  events: number
  status: string
  interviews: { title: string; date: string; status: string }[]
  invites: string[]
  chat_dates: string[]
  last: string
  progress: Progress
}
type Timeline = { today: string; rows: Row[] }
const short = (iso: string) => (iso ? fmtDate(iso) : '')

function Applied({ r }: { r: Row }) {
  const yes = r.applied === 'Yes'
  return (
    <span className={`pm-applied ${yes ? 'yes' : 'no'}`} title={yes ? 'Application submitted' : 'Not applied yet'}>
      <b aria-hidden>{yes ? '✓' : '✗'}</b> Applied
      {!yes && r.deadline && <em>due {short(r.deadline)}</em>}
      {r.progress.screens.length ? <small>{r.progress.screens.length === 1 && /hire ?vue/i.test(r.progress.screens[0]) ? 'HireVue done' : 'Screens done'}</small> : null}
    </span>
  )
}

function NextLine({ r }: { r: Row }) {
  if (r.out) return <span className="pm-next cut">Out of process{r.out_reason ? `: ${r.out_reason}` : ''}</span>
  if (r.next)
    return (
      <span className="pm-next">
        <strong>Next:</strong> {fmtDate(r.next.date, true)} · {r.next.title}
      </span>
    )
  if (r.deadline && r.applied !== 'Yes' && r.deadline >= new Date().toISOString().slice(0, 10))
    return (
      <span className="pm-next due">
        <strong>Apply by {fmtDate(r.deadline, true)}</strong>
      </span>
    )
  if (r.waiting) return <span className="pm-next muted">Waiting on {r.waiting} {r.waiting === 1 ? 'reply' : 'replies'}</span>
  return <span className="pm-next muted">{r.applied === 'Yes' ? 'Applied, nothing scheduled' : 'Nothing scheduled'}</span>
}

function BankRow({ r }: { r: Row }) {
  const counts = [
    r.chats ? `${r.chats} ${r.chats === 1 ? 'chat' : 'chats'}` : '',
    r.events ? `${r.events} ${r.events === 1 ? 'event' : 'events'}` : '',
    r.invites.length ? `${r.invites.length} invite-only` : '',
  ].filter(Boolean)
  return (
    <a className={`pm-row card ${r.out ? 'out' : ''}`} href={`#/bank/${encodeURIComponent(r.bank)}`}>
      <div className="pm-bank">
        <Logo bank={r.bank} domain={r.domain} size={36} />
        <span>
          <strong>{r.bank}</strong>
          <small>{[r.group, counts.join(' · ')].filter(Boolean).join(' · ') || 'No contact yet'}</small>
        </span>
      </div>
      <div className="pm-middle">
        <SeasonBar p={r.progress} labels />
        <Applied r={r} />
      </div>
      <NextLine r={r} />
      <span className="pm-open" aria-hidden>›</span>
    </a>
  )
}

export default function MapView() {
  const { data, error } = useApi<Timeline>('/api/timeline')
  const calendar = useApi<CalendarItem[]>('/api/calendar')
  if (!data) return <Loading error={error} />
  // Furthest along first; within that, the backend's order (most recent activity first).
  const reach = (r: Row) => r.progress.score + (r.applied === 'Yes' ? 0.01 : 0)
  const active = data.rows.filter((r) => !r.out).sort((a, b) => reach(b) - reach(a))
  const out = data.rows.filter((r) => r.out)
  const upcoming = (calendar.data ?? []).filter((c) => (c.end || c.date) >= data.today)

  return (
    <div>
      <h1>Recruiting Map</h1>
      <p className="lede">Where you stand at each bank. Click a bank to see who you spoke with and what each conversation led to.</p>

      <div className="pm-list">
        {active.map((r) => (
          <BankRow key={r.bank} r={r} />
        ))}
      </div>
      {out.length > 0 && (
        <>
          <h2>Out of process</h2>
          <div className="pm-list">
            {out.map((r) => (
              <BankRow key={r.bank} r={r} />
            ))}
          </div>
        </>
      )}

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

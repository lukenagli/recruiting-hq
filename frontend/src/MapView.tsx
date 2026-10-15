import type { BankSummary, CalendarItem } from './api'
import { Loading, Logo, daysUntil, fmtDate, useApi } from './ui'

const STAGE_HELP = [
  'Unofficial chats with Yale alumni and 2Ys, who decide who to push',
  'Talking and interviewing with the bank and group itself',
  'Invited to a private dinner or event',
  'Final-round interviews in Super Week',
  'Offer in hand',
]

function detail(b: BankSummary) {
  if (b.application.status === 'out') return b.application.notes || 'Out of process'
  if (b.people === 0) return 'No contacts yet'
  const parts = [`${b.spoke} of ${b.people} spoken`]
  if (b.yale_contacts) parts.push(`${b.yale_spoken} of ${b.yale_contacts} Yale`)
  if (b.scheduled) parts.push(`${b.scheduled} scheduled`)
  if (b.awaiting) parts.push(`${b.awaiting} awaiting reply`)
  return parts.join(' · ')
}

function Track({ b }: { b: BankSummary }) {
  const out = b.application.status === 'out'
  const at = b.stage.filter((s) => s.done).length // stations reached, 0 to 5
  return (
    <a className={`track-row ${out ? 'out' : ''}`} href={`#/bank/${encodeURIComponent(b.bank)}`}>
      <span className="track-bank">
        <Logo bank={b.bank} domain={b.domain} size={34} />
        <span>
          <strong>{b.bank}</strong>
          <small>{detail(b)}</small>
          <small className="stage-now">{out ? 'Out of process' : at ? `Stage ${at}: ${b.stage[at - 1].label}` : 'Not started'}</small>
        </span>
      </span>
      <span className="track" aria-label={`Stage ${at} of ${b.stage.length}`}>
        <span className="track-line" />
        <span className="track-fill" style={{ width: `${Math.max(at - 1, 0) * 20}%` }} />
        {b.stage.map((s, i) => (
          <span key={s.key} className={`station ${s.done ? 'done' : ''} ${i === at - 1 ? 'here' : ''}`} title={s.label}>
            {i === at - 1 && <Logo bank={b.bank} domain={b.domain} size={22} />}
          </span>
        ))}
      </span>
      <span className="track-next">
        {out ? (
          <em className="cut">Cut</em>
        ) : b.next_up ? (
          <>
            <strong>{fmtDate(b.next_up.date, true)}</strong>
            <small>{b.next_up.title}</small>
          </>
        ) : b.application.deadline && b.application.applied !== 'Yes' ? (
          <>
            <strong>Apply by {fmtDate(b.application.deadline)}</strong>
            <small>not applied yet</small>
          </>
        ) : (
          <small>{b.application.applied === 'Yes' ? 'Applied' : 'Nothing scheduled'}</small>
        )}
      </span>
    </a>
  )
}

export default function MapView() {
  const { data, error } = useApi<BankSummary[]>('/api/banks')
  const calendar = useApi<CalendarItem[]>('/api/calendar')
  if (!data) return <Loading error={error} />
  const today = new Date().toLocaleDateString('en-CA')
  const active = data.filter((b) => b.application.status !== 'out')
  const out = data.filter((b) => b.application.status === 'out')
  const upcoming = (calendar.data ?? []).filter((c) => (c.end || c.date) >= today)

  return (
    <div>
      <h1>Recruiting Map</h1>
      <p className="lede">Where I stand with each bank. Click a bank for the people, conversations and fact sheet.</p>

      <div className="tracks">
        <div className="track-head">
          <span />
          <span className="track-labels">
            {(data[0]?.stage ?? []).map((s, i) => (
              <span key={s.key} title={STAGE_HELP[i]}>
                <b>{i + 1}</b> {s.label}
              </span>
            ))}
          </span>
          <span>Next up</span>
        </div>
        {active.map((b) => (
          <Track key={b.bank} b={b} />
        ))}
        {out.length > 0 && <div className="track-divider">Out of process</div>}
        {out.map((b) => (
          <Track key={b.bank} b={b} />
        ))}
      </div>

      <div className="stage-key">
        {(data[0]?.stage ?? []).map((s, i) => (
          <span key={s.key}>
            <b>{i + 1}. {s.label}:</b> {STAGE_HELP[i]}
          </span>
        ))}
      </div>

      {upcoming.length > 0 && (
        <>
          <h2>Recruiting calendar</h2>
          <div className="calendar">
            {upcoming.map((c) => {
              const left = daysUntil(c.date, today)
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

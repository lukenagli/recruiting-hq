import type { Progress } from './api'
import { fmtDate } from './ui'

/**
 * Preview: one bank's progress laid out over the recruiting season. Each step's width is its share of the season's
 * days (2Y and alumni chats in September, group chats through mid-November, the invite-only dinners, then Super
 * Week's interviews and superday in a few days in December), each fills by what has happened at that bank, and a
 * thin line marks today, so a bank behind the line is behind the season.
 */
export default function SeasonBar({ p, labels = false, dark = false }: { p: Progress; labels?: boolean; dark?: boolean }) {
  const pct = (x: number) => `${Math.round(x * 1000) / 10}%`
  const state = (f: number) => (f >= 1 ? 'sb-done' : f > 0 ? 'sb-current' : 'sb-todo') // own names: a global .todo style exists
  const title = p.steps.map((s) => `${s.label} (${fmtDate(s.start)} to ${fmtDate(s.end)}): ${s.fill >= 1 ? 'done' : s.fill > 0 ? 'under way' : 'not yet'}${s.note ? `, ${s.note}` : ''}`).join('\n')
  const week = p.steps.slice(3) // interviews and superday: a few days at the very end, labelled together
  const weekNote = week.map((s, i) => (s.note ? `${i ? 'SD ' : ''}${s.note}` : '')).filter(Boolean).join(' · ')
  return (
    <div className={`season-bar ${dark ? 'dark' : ''}`} title={title} aria-label={`${p.where}. ${title}`}>
      <div className="sb-track">
        <span className="sb-segs">
          {p.steps.map((s) => (
            <span key={s.key} className={`sb-seg ${state(s.fill)}`} style={{ flexGrow: s.share }}>
              <i style={{ width: pct(Math.max(s.fill, s.fill > 0 ? 0.12 : 0)) }} />
            </span>
          ))}
          <span className="sb-today" style={{ left: `calc(${pct(p.today)} - 1px)` }} title={`Today, ${fmtDate(new Date().toISOString().slice(0, 10))}`} />
        </span>
        <span className={`sb-offer ${p.offer ? 'done' : ''}`} title="Offer" />
      </div>
      {labels && (
        <div className="sb-labels">
          {p.steps.slice(0, 3).map((s) => (
            <span key={s.key} className={state(s.fill)} style={{ flexGrow: s.share }}>
              <b>{s.label}</b>
              {s.note && <small>{s.note}</small>}
            </span>
          ))}
          <span className={`sb-week ${state(Math.max(...week.map((s) => s.fill)))}`} style={{ flexGrow: week.reduce((n, s) => n + s.share, 0) }}>
            <b>Super Week</b>
            {weekNote && <small>{weekNote}</small>}
          </span>
        </div>
      )}
    </div>
  )
}

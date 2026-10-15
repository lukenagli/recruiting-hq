import type { AiSettings, HomeData } from './api'
import { Loading, daysUntil, fmtDate, useApi } from './ui'

export default function Home() {
  const { data, error } = useApi<HomeData>('/api/home')
  const ai = useApi<AiSettings>('/api/settings/ai')

  return (
    <div className="home">
      <h1 className="hero-title">What do we want to work on today?</h1>
      {ai.data && !ai.data.ready && (
        <a className="notice key-callout" href="#/settings">
          <strong>Turn on the AI assistant:</strong> add your own Claude or OpenAI API key in Settings. Your tracker, map and the question bank work without one.
        </a>
      )}
      <div className="choices">
        <a className="choice" href="#/prep">
          <span className="choice-icon" aria-hidden>
            <svg viewBox="0 0 24 24"><path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          </span>
          <strong>Interview Prep</strong>
          <span>Practice the questions real interviewers asked, by bank and by round.</span>
          {data && <em>{data.totals.questions.toLocaleString()} questions on file</em>}
        </a>
        <a className="choice" href="#/map">
          <span className="choice-icon" aria-hidden>
            <svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2.5" /><circle cx="18" cy="5.5" r="2.5" /><circle cx="18" cy="18.5" r="2.5" /><path d="M7.3 11 15.7 6.6M7.3 13l8.4 4.4" /></svg>
          </span>
          <strong>Recruiting Map</strong>
          <span>Every bank, everyone you've met, what was said, and what comes next.</span>
          {data && (
            <em>
              {data.totals.people} people across {data.totals.banks} banks
            </em>
          )}
        </a>
        <a className="choice" href="#/deals">
          <span className="choice-icon" aria-hidden>
            <svg viewBox="0 0 24 24"><path d="M4 19V9M10 19V5M16 19v-7M21 19H3" /></svg>
          </span>
          <strong>My Deals</strong>
          <span>The deals I pitch, laid out as the 90-second pitch with every number.</span>
        </a>
      </div>

      {!data ? (
        <Loading error={error} />
      ) : (
        <section className="radar">
          <h2>On your radar</h2>
          <div className="radar-grid">
            <div className="card">
              <h3>Thank-you notes owed</h3>
              {data.thank_yous_due.length === 0 && <p className="muted">All caught up.</p>}
              {data.thank_yous_due.map((t) => (
                <a className="row" key={t.who} href={`#/bank/${encodeURIComponent(t.bank)}`}>
                  <span>
                    <strong>{t.who}</strong>
                    <small>{t.bank}</small>
                  </span>
                  <span className="when">spoke {t.date === data.today ? 'today' : fmtDate(t.date)}</span>
                </a>
              ))}
            </div>
            <div className="card">
              <h3>Coming up</h3>
              {data.upcoming.length === 0 && <p className="muted">Nothing scheduled.</p>}
              {data.upcoming.map((u) => (
                <a className="row" key={u.title} href={`#/bank/${encodeURIComponent(u.bank)}`}>
                  <span>
                    <strong>{u.title}</strong>
                    <small>{u.bank}</small>
                  </span>
                  <span className="when">{fmtDate(u.date, true)}</span>
                </a>
              ))}
            </div>
            <div className="card">
              <h3>Application deadlines</h3>
              {data.deadlines.length === 0 && <p className="muted">No open deadlines.</p>}
              {data.deadlines.map((d) => {
                const left = daysUntil(d.date, data.today)
                return (
                  <a className="row" key={d.bank} href={`#/bank/${encodeURIComponent(d.bank)}`}>
                    <span>
                      <strong>{d.bank}</strong>
                      <small>not applied yet</small>
                    </span>
                    <span className={`when ${left <= 7 ? 'urgent' : ''}`}>
                      {fmtDate(d.date)} · {left} days
                    </span>
                  </a>
                )
              })}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

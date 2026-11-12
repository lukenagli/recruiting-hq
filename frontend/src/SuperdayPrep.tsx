import { useState } from 'react'
import { post } from './api'
import type { PrepOptions } from './api'
import { Loading, Logo, fmtDate, useApi } from './ui'

type Area = { topic: string; score: number | null; graded: number; level: string; note: string }
type Story = { why_bank: string; why_group: string; people: string[]; gaps: string[]; group: string; at: string }
type Brief = {
  bank: string
  total: number
  by_type: Record<string, number>
  questions: { id: number; question: string; qtype: string; grp: string; interviewer: string; source: string; answer_notes: string }[]
  weak: Area[]
  untried: string[]
  story: Story | null
  group: string
  spoken: number
}

const practiceLink = (params: Record<string, string>) => `#/prep?${new URLSearchParams({ tab: 'practice', round: 'Superday', ...params })}`

/** One bank's Superday: what it asks there, where you're weakest, and your "why this bank, why this group". */
export default function SuperdayPrep({ bank, options }: { bank: string; options: PrepOptions }) {
  const mine = Array.from(new Set(options.people.map((p) => p.bank)))
  const superdayCount = (b: string) => options.counts.filter((c) => c.bank === b && c.round === 'Superday').reduce((n, c) => n + c.n, 0)
  const banks = mine.sort((a, b) => superdayCount(b) - superdayCount(a) || a.localeCompare(b))
  return (
    <>
      <section className="step">
        <h2><span className="step-n">1</span> Which bank's Superday?</h2>
        <div className="chips banks">
          {banks.map((b) => (
            <a key={b} className={`chip ${bank === b ? 'on' : ''}`} href={`#/prep?tab=superday&bank=${encodeURIComponent(b)}`}>
              <Logo bank={b} domain={options.domains[b] ?? ''} size={18} /> {b} <em>{superdayCount(b)}</em>
            </a>
          ))}
        </div>
      </section>
      {bank && <Brief key={bank} bank={bank} />}
    </>
  )
}

function Brief({ bank }: { bank: string }) {
  const { data, error, reload } = useApi<Brief>('/api/prep/superday', { bank })
  const [type, setType] = useState('All')
  const [open, setOpen] = useState<number | null>(null)
  const [all, setAll] = useState(false)
  if (!data) return <Loading error={error} />
  const types = Object.keys(data.by_type)
  const shown = data.questions.filter((q) => type === 'All' || q.qtype === type)
  return (
    <div className="superday">
      <section className="card sd-card">
        <div className="sd-head">
          <h2>What {bank} asks at Superdays</h2>
          {data.total > 0 && (
            <a className="btn primary" href={practiceLink({ bank, categories: 'all' })}>Practice these</a>
          )}
        </div>
        {data.total === 0 ? (
          <p className="muted">
            Nobody has logged a {bank} Superday question yet.{' '}
            <a href={practiceLink({ bank: 'Any', categories: 'all' })}>Practice every bank's Superday questions</a> instead.
          </p>
        ) : (
          <>
            <p className="muted">
              {data.total} question{data.total === 1 ? '' : 's'} from {bank} Superdays, newest first.
              {data.total < 12 && <> Few on file, so also try <a href={practiceLink({ bank: 'Any', categories: 'all' })}>every bank's Superday questions</a>.</>}
            </p>
            {types.length > 1 && (
              <div className="chips">
                {['All', ...types].map((t) => (
                  <button key={t} className={`chip ${type === t ? 'on' : ''}`} onClick={() => setType(t)}>
                    {t} <em>{t === 'All' ? data.total : data.by_type[t]}</em>
                  </button>
                ))}
              </div>
            )}
            <ul className="questions">
              {(all ? shown : shown.slice(0, 12)).map((q) => (
                <li key={q.id}>
                  <button onClick={() => setOpen(open === q.id ? null : q.id)} disabled={!q.answer_notes}>
                    <span className={`qtype t-${q.qtype.replace(' ', '')}`}>{q.qtype}</span>
                    <span className="qtext">
                      {q.question}
                      <small>
                        {[q.grp, q.interviewer, q.source].filter(Boolean).join(' · ')}
                        {q.answer_notes && (open === q.id ? ' · hide notes' : ' · show notes')}
                      </small>
                      {open === q.id && <span className="answer">{q.answer_notes}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {shown.length > 12 && !all && <button className="link" onClick={() => setAll(true)}>Show all {shown.length}</button>}
          </>
        )}
      </section>

      <section className="card sd-card">
        <h2>Your weakest technical areas</h2>
        {data.weak.length === 0 && data.untried.length === 0 && <p className="muted">Nothing stands out: every area you've practiced is strong.</p>}
        {data.weak.length === 0 && data.untried.length > 0 && (
          <p className="muted">No weak spots in what you've practiced so far.</p>
        )}
        <ul className="sd-areas">
          {data.weak.map((a) => (
            <li key={a.topic}>
              <span>
                <strong>{a.topic}</strong>
                <small>{Math.round((a.score ?? 0) * 100)}% over your last {Math.min(a.graded, 12)} · {a.note || `at ${a.level} level`}</small>
              </span>
              <a className="btn" href={practiceLink({ bank: 'Any', topic: a.topic })}>Practice at Superday level</a>
            </li>
          ))}
        </ul>
        {data.untried.length > 0 && (
          <p className="muted sd-untried">
            Not practiced yet:{' '}
            {data.untried.map((t, i) => (
              <span key={t}>{i > 0 && ', '}<a href={practiceLink({ bank: 'Any', topic: t })}>{t}</a></span>
            ))}
          </p>
        )}
      </section>

      <StoryCard bank={bank} group={data.group} story={data.story} spoken={data.spoken} onChanged={reload} />
    </div>
  )
}

function StoryCard({ bank, group, story, spoken, onChanged }: { bank: string; group: string; story: Story | null; spoken: number; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function write() {
    setBusy(true)
    setError('')
    try {
      const r = await post<{ ok: boolean; reason?: string }>('/api/prep/superday/story', { bank })
      if (!r.ok) setError(r.reason || 'Could not write it.')
      else onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const whyGroup = group === 'generalist program' ? 'Why the generalist program' : `Why ${group || 'this group'}`
  return (
    <section className="card sd-card">
      <div className="sd-head">
        <h2>Your story for {bank}</h2>
        <button className={story ? 'btn' : 'btn primary'} disabled={busy} onClick={write}>
          {busy ? 'Writing… (about 20 seconds)' : story ? 'Rewrite' : 'Write my answers'}
        </button>
      </div>
      <p className="muted">
        Your answers to "Why {bank}?" and "{whyGroup}?", written from your resume, what you wrote about yourself, {bank}'s overview and your{' '}
        {spoken} chat{spoken === 1 ? '' : 's'} there. Nothing is made up; read them aloud and make them yours.
      </p>
      {error && <p className="notice error">{error}</p>}
      {story && (
        <div className="sd-story">
          <h3>Why {bank}?</h3>
          <p>{story.why_bank}</p>
          <h3>{whyGroup}?</h3>
          <p>{story.why_group}</p>
          {story.people.length > 0 && (
            <>
              <h3>People to mention</h3>
              <ul>{story.people.map((p) => <li key={p}>{p}</li>)}</ul>
            </>
          )}
          {story.gaps.length > 0 && (
            <>
              <h3>Worth finding out before the day</h3>
              <ul>{story.gaps.map((g) => <li key={g}>{g}</li>)}</ul>
            </>
          )}
          <small className="muted">Written {fmtDate(story.at.slice(0, 10))}.</small>
        </div>
      )}
    </section>
  )
}

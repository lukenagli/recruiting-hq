import { useState } from 'react'
import { del } from './api'
import type { Attempt, PracticeProgress } from './api'
import { Loading, fmtDate, useApi } from './ui'

const LEVEL_CLASS: Record<string, string> = {
  Strong: 'strong',
  'Getting there': 'mid',
  'Needs work': 'weak',
  'Too early to tell': 'early',
  'Not started': 'none',
}

/** How strong the user is in each technical area, from their graded practice answers. */
export default function Progress({ onPractice }: { onPractice: (topic: string) => void }) {
  const { data, error } = useApi<PracticeProgress>('/api/practice/progress')
  if (!data) return <Loading error={error} />
  const started = data.areas.filter((a) => a.attempts > 0)

  return (
    <section className="progress">
      <div className="progress-stats">
        <div className="card stat">
          <strong>{data.total}</strong>
          <span>questions answered</span>
        </div>
        <div className="card stat">
          <strong>{data.technical_score === null ? '–' : `${Math.round(data.technical_score * 100)}%`}</strong>
          <span>technical score (recent)</span>
        </div>
        <div className="card stat">
          <strong>{data.days}</strong>
          <span>{data.days === 1 ? 'day' : 'days'} practiced</span>
        </div>
        <div className="card stat">
          <strong>{Object.values(data.others).reduce((a, b) => a + b, 0)}</strong>
          <span>behavioral, deal and market answers</span>
        </div>
      </div>

      <h2>Technical areas</h2>
      {started.length === 0 && <p className="muted">Nothing yet. Answer a few technical questions and your strengths will show up here.</p>}
      <div className="areas">
        {data.areas.map((a) => {
          const pct = a.score === null ? 0 : Math.round(a.score * 100)
          return (
            <div key={a.topic} className={`area card lv-${LEVEL_CLASS[a.level]}`}>
              <div className="area-head">
                <strong>{a.topic}</strong>
                <span className="area-level">{a.level}</span>
              </div>
              <div className="area-bar" title={a.score === null ? 'No graded answers yet' : `${pct}% on your recent answers`}>
                <i style={{ width: `${pct}%` }} />
              </div>
              <div className="area-foot">
                <span>
                  {a.attempts === 0
                    ? 'Not practiced yet'
                    : `${a.correct} of ${a.graded} correct${a.score !== null ? ` · ${pct}%` : ''}${a.last ? ` · last ${fmtDate(a.last)}` : ''}`}
                </span>
                <button className="link" onClick={() => onPractice(a.topic)}>
                  Practice
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <p className="fine">
        The score uses your 12 most recent graded answers in each area, so it moves as you improve. To leave an answer out of these numbers,
        remove it under <a href="#/settings">Settings → Practice history</a>.
      </p>
    </section>
  )
}

const VERDICT: Record<string, string> = { correct: 'Correct', partial: 'Partly right', incorrect: 'Not quite' }

/** Settings section: every practice answer, with a way to remove ones that should not count. */
export function PracticeHistory() {
  const { data, error, reload } = useApi<Attempt[]>('/api/practice/history')
  const [filter, setFilter] = useState('All')
  const [confirmAll, setConfirmAll] = useState(false)
  if (!data) return <Loading error={error} />
  const kinds = ['All', ...Array.from(new Set(data.map((a) => (a.category === 'Technical' ? a.topic : a.category))))]
  const shown = data.filter((a) => filter === 'All' || (a.category === 'Technical' ? a.topic : a.category) === filter)

  async function remove(ids: number[]) {
    for (const id of ids) await del(`/api/practice/attempts/${id}`)
    setConfirmAll(false)
    reload()
  }

  return (
    <section className="card history">
      <h3>Practice history</h3>
      <p>
        Every answer you have given in Interview Prep. Remove any you typed by mistake or do not want counted; your progress view updates
        right away.
      </p>
      {data.length === 0 ? (
        <p className="muted">No practice answers yet.</p>
      ) : (
        <>
          <div className="history-tools">
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              {kinds.map((k) => (
                <option key={k}>{k}</option>
              ))}
            </select>
            <span className="muted">{shown.length} shown</span>
            {confirmAll ? (
              <span className="confirm">
                Remove all {shown.length}?{' '}
                <button className="danger" onClick={() => remove(shown.map((a) => a.id))}>Yes, remove</button>{' '}
                <button className="link" onClick={() => setConfirmAll(false)}>Cancel</button>
              </span>
            ) : (
              <button className="link" onClick={() => setConfirmAll(true)}>
                Remove all shown
              </button>
            )}
          </div>
          <ul className="history-list">
            {shown.map((a) => (
              <li key={a.id}>
                <div>
                  <small>
                    {fmtDate(a.at.slice(0, 10))} · {a.category === 'Technical' ? a.topic : a.category}
                    {a.bank && ` · ${a.bank}`}
                  </small>
                  <span className="h-q">{a.question}</span>
                  {a.answer && <span className="h-a">Your answer: {a.answer}</span>}
                </div>
                <span className={`h-v v-${a.verdict ?? 'none'}`}>{a.verdict ? VERDICT[a.verdict] : 'Not graded'}</span>
                <button className="link danger-link" onClick={() => remove([a.id])}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

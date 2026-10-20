import { useEffect, useRef, useState } from 'react'
import { post } from './api'
import type { Graded, PracticeQuestion, PrepOptions, Verdict } from './api'
import { useSchool } from './ui'

export const TOPICS = ['Accounting', 'Enterprise & Equity Value', 'Valuation', 'DCF', 'Merger Math', 'Diluted Share Count', 'LBO', 'Other']
const CATEGORY_LABEL: Record<string, string> = { Behavioral: 'Behavioral', Technical: 'Technical', Deal: 'Deal questions', Markets: 'Markets & trends' }
const STAGES = ['Coffee Chat', 'Round 1', 'Round 2', 'Superday']
const DIFFICULTIES = [
  ['easy', 'Easy'],
  ['medium', 'Medium'],
  ['hard', 'Hard'],
  ['adaptive', 'Adaptive (harder where you are strong, more practice where you are weak)'],
]
const VERDICT_LABEL: Record<Verdict, string> = { correct: 'Correct', partial: 'Partly right', incorrect: 'Not quite' }

export type Setup = { categories: string[]; topics: string[]; stage: string; difficulty: string; bank: string }
export const DEFAULT_SETUP: Setup = { categories: ['Technical'], topics: [], stage: '', difficulty: 'adaptive', bank: 'Any' }
const STORE = 'rhq-practice-setup'

function loadSetup(): Setup {
  try {
    return { ...DEFAULT_SETUP, ...JSON.parse(localStorage.getItem(STORE) ?? '{}') }
  } catch {
    return DEFAULT_SETUP
  }
}

/** A dropdown whose panel holds checkboxes. Closes on outside click. */
function Dropdown({ label, summary, children }: { label: string; summary: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  return (
    <div className="dd" ref={box}>
      <span className="dd-label">{label}</span>
      <button type="button" className={`dd-button ${open ? 'open' : ''}`} onClick={() => setOpen(!open)}>
        <span>{summary}</span>
        <i aria-hidden>▾</i>
      </button>
      {open && <div className="dd-panel">{children}</div>}
    </div>
  )
}

function Check({ on, onChange, children, indent }: { on: boolean; onChange: (v: boolean) => void; children: React.ReactNode; indent?: boolean }) {
  return (
    <label className={`dd-check ${indent ? 'indent' : ''}`}>
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  )
}

function SetupBar({ setup, setSetup, banks }: { setup: Setup; setSetup: (s: Setup) => void; banks: string[] }) {
  const toggle = (list: string[], item: string, on: boolean) => (on ? [...new Set([...list, item])] : list.filter((x) => x !== item))
  const technical = setup.categories.includes('Technical')
  const allTopics = setup.topics.length === 0
  const studySummary =
    setup.categories.length === 0
      ? 'Pick at least one'
      : setup.categories
          .map((c) => (c === 'Technical' && !allTopics ? `Technical (${setup.topics.length})` : CATEGORY_LABEL[c]))
          .join(', ')

  return (
    <div className="practice-setup">
      <Dropdown label="Study" summary={studySummary}>
        {Object.keys(CATEGORY_LABEL).map((c) => (
          <div key={c}>
            <Check on={setup.categories.includes(c)} onChange={(v) => setSetup({ ...setup, categories: toggle(setup.categories, c, v) })}>
              {CATEGORY_LABEL[c]}
            </Check>
            {c === 'Technical' && technical && (
              <>
                <Check indent on={allTopics} onChange={(v) => v && setSetup({ ...setup, topics: [] })}>
                  All technical areas
                </Check>
                {TOPICS.map((t) => (
                  <Check
                    key={t}
                    indent
                    on={!allTopics && setup.topics.includes(t)}
                    onChange={(v) => {
                      const next = toggle(allTopics ? [] : setup.topics, t, v)
                      setSetup({ ...setup, topics: next.length === TOPICS.length ? [] : next })
                    }}
                  >
                    {t}
                  </Check>
                ))}
              </>
            )}
          </div>
        ))}
      </Dropdown>

      <label className="dd">
        <span className="dd-label">Preparing for</span>
        <select value={setup.stage} onChange={(e) => setSetup({ ...setup, stage: e.target.value })}>
          <option value="">General practice</option>
          {STAGES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>

      {setup.stage === '' && (
        <label className="dd">
          <span className="dd-label">Difficulty</span>
          <select value={setup.difficulty} onChange={(e) => setSetup({ ...setup, difficulty: e.target.value })}>
            {DIFFICULTIES.map(([v, l]) => (
              <option key={v} value={v}>{v === 'adaptive' ? 'Adaptive' : l}</option>
            ))}
          </select>
        </label>
      )}

      {banks.length > 0 && (
      <label className="dd">
        <span className="dd-label">Bank</span>
        <select value={setup.bank} onChange={(e) => setSetup({ ...setup, bank: e.target.value })}>
          <option value="Any">Any bank</option>
          {banks.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
      </label>
      )}
    </div>
  )
}

function Meta({ q }: { q: PracticeQuestion }) {
  const bits = [
    q.category === 'Technical' ? q.topic : CATEGORY_LABEL[q.category],
    q.difficulty && q.difficulty[0].toUpperCase() + q.difficulty.slice(1),
    q.bank && [q.bank, q.group].filter(Boolean).join(' '),
    q.round,
    q.source,
  ].filter(Boolean)
  return (
    <div className="pq-meta">
      {bits.map((b, i) => (
        <span key={i} className={i === 0 ? 'pq-topic' : ''}>{b}</span>
      ))}
    </div>
  )
}

export default function Practice({ options, start }: { options: PrepOptions; start?: Partial<Setup> }) {
  const school = useSchool()
  const [setup, setSetupState] = useState<Setup>(() => ({ ...loadSetup(), ...start }))
  const [q, setQ] = useState<PracticeQuestion | null>(null)
  const [answer, setAnswer] = useState('')
  const [graded, setGraded] = useState<Graded | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [seen, setSeen] = useState<string[]>([])
  const [tally, setTally] = useState({ done: 0, correct: 0 })

  const myBanks = new Set(options.people.map((p) => p.bank))
  const banks = Array.from(new Set(options.counts.map((c) => c.bank)))
    .filter((b) => b !== 'Unknown')
    .sort((a, b) => Number(myBanks.has(b)) - Number(myBanks.has(a)) || a.localeCompare(b))

  function setSetup(s: Setup) {
    setSetupState(s)
    try {
      localStorage.setItem(STORE, JSON.stringify(s))
    } catch {
      /* private window: the choice just is not remembered */
    }
  }

  async function next(like = '') {
    setBusy('next')
    setError('')
    try {
      const r = await post<{ question: PracticeQuestion | null }>('/api/practice/next', { ...setup, seen, like })
      if (!r.question) {
        setError('No questions match these choices. Try another bank, stage or difficulty.')
      } else {
        setQ(r.question)
        setSeen((s) => [...s, r.question!.key])
        setAnswer('')
        setGraded(null)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  async function submit(text: string) {
    if (!q) return
    setBusy('grade')
    setError('')
    try {
      const g = await post<Graded>('/api/practice/answer', { key: q.key, answer: text })
      setGraded(g)
      if (g.verdict) setTally((t) => ({ done: t.done + 1, correct: t.correct + (g.verdict === 'correct' ? 1 : 0) }))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  async function mark(verdict: Verdict) {
    if (!graded) return
    await post(`/api/practice/attempts/${graded.attempt_id}/mark`, { verdict })
    setTally((t) => ({
      done: t.done + (graded.verdict ? 0 : 1),
      correct: t.correct + (verdict === 'correct' ? 1 : 0) - (graded.verdict === 'correct' ? 1 : 0),
    }))
    setGraded({ ...graded, verdict })
  }

  const ready = setup.categories.length > 0

  return (
    <section className="practice">
      <SetupBar setup={setup} setSetup={setSetup} banks={banks} />

      {!q && (
        <div className="practice-start">
          <button className="primary big" disabled={!ready || busy !== ''} onClick={() => next()}>
            {busy === 'next' ? 'Finding a question…' : 'Start practicing'}
          </button>
          <p className="muted">
            {school.club ? 'Questions come from your club question banks, plus' : 'Questions are common interview questions plus'} technical
            problems with new numbers each time (worked out so the math is doable by hand).
          </p>
        </div>
      )}
      {error && <p className="notice error">{error}</p>}

      {q && (
        <div className="pq card">
          <div className="pq-head">
            <Meta q={q} />
            {tally.done > 0 && (
              <span className="pq-tally">
                {tally.correct} of {tally.done} correct this session
              </span>
            )}
          </div>
          <p className="pq-question">{q.question}</p>

          {!graded ? (
            <>
              <textarea
                className="pq-answer"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder={q.category === 'Technical' ? 'Type your answer the way you would say it, including the numbers…' : 'Type what you would say…'}
                rows={5}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && answer.trim()) submit(answer)
                }}
              />
              <div className="pq-actions">
                <button className="primary" disabled={!answer.trim() || busy !== ''} onClick={() => submit(answer)}>
                  {busy === 'grade' ? 'Checking…' : 'Check my answer'}
                </button>
                <button className="ghost" disabled={busy !== ''} onClick={() => submit('')}>
                  Show me the answer
                </button>
                <button className="ghost" disabled={busy !== ''} onClick={() => next()}>
                  Skip
                </button>
              </div>
            </>
          ) : (
            <div className="pq-result">
              {graded.answer && answer && <p className="pq-yours"><strong>You said:</strong> {answer}</p>}
              {graded.verdict ? (
                <p className={`verdict v-${graded.verdict}`}>{VERDICT_LABEL[graded.verdict]}</p>
              ) : (
                <p className="verdict v-none">How did you do?</p>
              )}
              {graded.feedback && <p className="pq-feedback">{graded.feedback}</p>}
              {graded.answer && (
                <p className="pq-key">
                  <strong>Answer:</strong> {graded.answer}
                </p>
              )}
              {graded.explanation && (
                <div className="pq-explain">
                  <strong>Explanation</strong>
                  <p>{graded.explanation}</p>
                </div>
              )}
              <div className="pq-mark">
                <span>{graded.verdict ? 'Disagree with the grade?' : 'Mark yourself:'}</span>
                {(['correct', 'partial', 'incorrect'] as Verdict[]).map((v) => (
                  <button key={v} className={`chip ${graded.verdict === v ? 'on' : ''}`} onClick={() => mark(v)}>
                    {VERDICT_LABEL[v]}
                  </button>
                ))}
              </div>
              <div className="pq-actions">
                <button className="primary" disabled={busy !== ''} onClick={() => next(q.key)}>
                  Try a similar problem
                </button>
                <button className="ghost" disabled={busy !== ''} onClick={() => next()}>
                  Next question
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

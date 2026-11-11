import { useEffect, useRef, useState } from 'react'
import { post } from './api'
import type { Graded, PracticeQuestion, PrepOptions, Verdict } from './api'
import AnswerForm, { anyFilled, compose, formFor, taxNote } from './AnswerForm'
import { useBullets } from './bullets'
import { useDictation } from './dictation'
import { useApi, useSchool } from './ui'
import VoiceInterview, { voiceSupported } from './VoiceInterview'

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

// Where questions come from: bank "Any" (every bank), one bank, or "" (no banks); guides [] (all the student's own
// guides), some of them, or null (none). Every session starts from all of both; a change lasts for that session only.
export type Setup = { categories: string[]; topics: string[]; stage: string; difficulty: string; bank: string; guides: string[] | null }
export const DEFAULT_SETUP: Setup = { categories: ['Technical'], topics: [], stage: '', difficulty: 'adaptive', bank: 'Any', guides: [] }
const STORE = 'rhq-practice-setup'

function loadSetup(): Setup {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? '{}')
    delete saved.bank // the sources always start from everything
    delete saved.guides
    return { ...DEFAULT_SETUP, ...saved }
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

function SetupBar({ setup, setSetup, banks, guides }: { setup: Setup; setSetup: (s: Setup) => void; banks: string[]; guides: string[] }) {
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

      {(banks.length > 0 || guides.length > 0) && (
        <Dropdown label="Questions from" summary={sourceSummary(setup)}>
          {guides.length > 0 ? (
            <>
              <Check on={setup.guides !== null} onChange={(v) => setSetup({ ...setup, guides: v ? [] : null })}>
                Breaking Into Wall Street guides
              </Check>
              {setup.guides !== null && (
                <>
                  <Check indent on={setup.guides.length === 0} onChange={(v) => v && setSetup({ ...setup, guides: [] })}>
                    All guides
                  </Check>
                  {guides.map((g) => (
                    <Check
                      key={g}
                      indent
                      on={setup.guides!.length > 0 && setup.guides!.includes(g)}
                      onChange={(v) => {
                        const next = v ? [...new Set([...setup.guides!, g])] : setup.guides!.filter((x) => x !== g)
                        setSetup({ ...setup, guides: next.length === guides.length ? [] : next })
                      }}
                    >
                      {g}
                    </Check>
                  ))}
                </>
              )}
            </>
          ) : (
            <p className="dd-note">Upload your Breaking Into Wall Street guides in Settings to practice from them too.</p>
          )}
          {banks.length > 0 && (
            <>
              <Check on={setup.bank !== ''} onChange={(v) => setSetup({ ...setup, bank: v ? 'Any' : '' })}>
                Banks
              </Check>
              {setup.bank !== '' && (
                <>
                  <Check indent on={setup.bank === 'Any'} onChange={(v) => v && setSetup({ ...setup, bank: 'Any' })}>
                    All banks
                  </Check>
                  {banks.map((b) => (
                    <Check key={b} indent on={setup.bank === b} onChange={(v) => setSetup({ ...setup, bank: v ? b : 'Any' })}>
                      {b}
                    </Check>
                  ))}
                </>
              )}
            </>
          )}
        </Dropdown>
      )}
    </div>
  )
}

function sourceSummary(s: Setup) {
  const g = s.guides === null ? '' : s.guides.length === 0 ? 'All guides' : s.guides.length === 1 ? s.guides[0] : `${s.guides.length} guides`
  const b = s.bank === '' ? '' : s.bank === 'Any' ? 'All banks' : s.bank
  return [g, b].filter(Boolean).join(' + ') || 'Pick at least one'
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

type Turn = { role: 'user' | 'coach'; text: string; sources?: Graded['sources'] }

/** Ask follow-up questions about a practice question and its explanation. */
function FollowUp({ attemptId }: { attemptId: number }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function ask(e: React.FormEvent) {
    e.preventDefault()
    const question = text.trim()
    if (!question) return
    setBusy(true)
    setError('')
    setText('')
    setTurns((t) => [...t, { role: 'user', text: question }])
    try {
      const out = await post<{ reply: string; sources: Graded['sources'] }>(`/api/practice/attempts/${attemptId}/ask`, {
        question,
        history: turns.map((t) => ({ role: t.role === 'user' ? 'user' : 'assistant', text: t.text })),
      })
      setTurns((t) => [...t, { role: 'coach', text: out.reply, sources: out.sources }])
    } catch (err) {
      setError((err as Error).message)
      setText(question)
      setTurns((t) => t.slice(0, -1))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="followup">
      <strong>Ask about this question</strong>
      {turns.map((t, i) => (
        <div key={i} className={`fu-turn fu-${t.role}`}>
          <p>{t.text}</p>
          {t.sources && t.sources.length > 0 && (
            <small>
              From your library: {t.sources.map((s) => `${s.source}${s.location ? `, ${s.location}` : ''}`).join(' · ')}
            </small>
          )}
        </div>
      ))}
      {busy && <p className="muted fu-thinking">Thinking…</p>}
      {error && <p className="notice error">{error}</p>}
      <form className="fu-form" onSubmit={ask}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={turns.length ? 'Ask another follow-up…' : 'e.g. Why do we subtract cash? What if the options were out of the money?'}
          disabled={busy}
        />
        <button className="primary" disabled={busy || !text.trim()}>
          Ask
        </button>
      </form>
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
  const [voice, setVoice] = useState(false) // a spoken mock interview instead of typed practice
  const [parts, setParts] = useState<Record<string, string>>({}) // the labeled answer boxes (statements, EV, MOM)
  const [earlier, setEarlier] = useState<{ q: PracticeQuestion; answer: string; graded: Graded }[]>([]) // earlier parts of a question
  const [typeItOut, setTypeItOut] = useState(false) // the student would rather write the whole answer
  const bullets = useBullets(answer, setAnswer) // "- " makes a bullet, Tab and Shift+Tab indent
  const library = useApi<{ source: string; private: boolean; questions: number }[]>('/api/practice/library')
  const myGuides = (library.data ?? []).filter((g) => g.private && g.questions > 0).map((g) => g.source)
  const form = q && !typeItOut ? formFor(q) : null
  const written = form ? compose(form, parts, answer) : answer
  // dictating an answer: each finished phrase is added to the box
  const dictation = useDictation((phrase) => setAnswer((a) => `${a}${a && !/\s$/.test(a) ? ' ' : ''}${phrase}`))

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

  /** The next question; with `after`, the next part of the question just answered (its follow-up). */
  async function next(like = '', after = '') {
    setBusy('next')
    setError('')
    try {
      const r = await post<{ question: PracticeQuestion | null }>('/api/practice/next', { ...setup, seen, like, after })
      if (!r.question) {
        setError(after ? 'That was the last part of this question.' : 'No questions match these choices. Try another bank, stage or difficulty.')
      } else {
        // the earlier parts stay on screen while their follow-ups are asked; a new question starts clean
        if (after && q && graded) setEarlier((e) => [...e, { q, answer, graded }])
        else setEarlier([])
        setQ(r.question)
        setSeen((s) => [...s, r.question!.key])
        dictation.stop()
        setAnswer('')
        setParts({})
        setTypeItOut(false)
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
    dictation.stop()
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

  /** Check the answer: the labeled boxes and the free text, put together. */
  function finish() {
    const text = written
    setAnswer(text) // "Your answer" shows what was checked
    setParts({})
    return submit(text)
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

  const ready = setup.categories.length > 0 && (setup.guides !== null || setup.bank !== '')

  return (
    <section className="practice">
      <SetupBar setup={setup} setSetup={setSetup} banks={banks} guides={myGuides} />

      {voice && <VoiceInterview setup={setup} onExit={() => setVoice(false)} />}

      {!voice && !q && (
        <div className="practice-start">
          <div className="practice-start-buttons">
            <button className="primary big" disabled={!ready || busy !== ''} onClick={() => next()}>
              {busy === 'next' ? 'Finding a question…' : 'Start practicing'}
            </button>
            {voiceSupported() && (
              <button className="ghost big" disabled={!ready} onClick={() => setVoice(true)} title="The interviewer talks to you and listens to your answers">
                Voice interview
              </button>
            )}
          </div>
          <p className="muted">
            {school.club ? 'Questions come from your club question banks, plus' : 'Questions are common interview questions plus'} technical
            problems with new numbers each time (worked out so the math is doable by hand).
          </p>
        </div>
      )}
      {error && <p className="notice error">{error}</p>}

      {!voice && q && (
        <div className="pq card">
          <div className="pq-head">
            <Meta q={q} />
            {tally.done > 0 && (
              <span className="pq-tally">
                {tally.correct} of {tally.done} correct this session
              </span>
            )}
          </div>
          {earlier.map((e, i) => (
            <div key={e.q.key} className="pq-earlier">
              <small>Part {i + 1}</small>
              <p className="pq-earlier-q">{e.q.question}</p>
              {e.answer.trim() && <p className="pq-earlier-a"><strong>You said:</strong> {e.answer}</p>}
              {(e.graded.answer || e.graded.explanation) && (
                <p className="pq-earlier-a"><strong>Answer:</strong> {e.graded.answer || e.graded.explanation}</p>
              )}
            </div>
          ))}
          {earlier.length > 0 && <small className="pq-part">Part {earlier.length + 1}</small>}
          <p className="pq-question">{q.question}</p>
          {taxNote(q) && <p className="pq-note">{taxNote(q)}</p>}

          {!graded ? (
            <>
              {form && <AnswerForm form={form} parts={parts} setParts={setParts} onSubmit={() => written.trim() && finish()} />}
              <textarea
                className="pq-answer"
                ref={bullets.ref}
                value={answer}
                onChange={bullets.onChange}
                placeholder={dictation.listening ? 'Listening… say your answer' : form ? 'Anything else (optional): your reasoning or the steps…' : q.category === 'Technical' ? 'Type or dictate your answer the way you would say it, including the numbers…' : 'Type or dictate what you would say…'}
                rows={form ? 2 : 5}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && written.trim()) {
                    e.preventDefault()
                    return finish()
                  }
                  bullets.onKeyDown(e)
                }}
              />
              {form && (
                <button type="button" className="link muted pq-typeout" onClick={() => { setAnswer(compose(form, parts, answer)); setTypeItOut(true) }}>
                  Write it all out instead
                </button>
              )}
              {dictation.interim && <p className="pq-interim muted">{dictation.interim}</p>}
              {dictation.error && <p className="notice error">{dictation.error}</p>}
              <div className="pq-actions">
                <button className="primary" disabled={!(answer.trim() || anyFilled(parts)) || busy !== ''} onClick={finish}>
                  {busy === 'grade' ? 'Checking…' : 'Check my answer'}
                </button>
                {dictation.supported && (
                  <button className={`ghost ${dictation.listening ? 'listening' : ''}`} disabled={busy !== ''} onClick={dictation.toggle}>
                    {dictation.listening ? '● Stop dictating' : 'Dictate my answer'}
                  </button>
                )}
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
              {graded.verdict ? (
                <p className={`verdict v-${graded.verdict}`}>{VERDICT_LABEL[graded.verdict]}</p>
              ) : (
                <p className="verdict v-none">How did you do?</p>
              )}
              {graded.feedback && <p className="pq-feedback">{graded.feedback}</p>}
              {answer.trim() && (
                <div className="pq-yours">
                  <strong>Your answer</strong>
                  <p>{answer}</p>
                </div>
              )}
              {graded.answer && (
                <p className="pq-key">
                  <strong>Answer:</strong> {graded.answer}
                </p>
              )}
              {graded.explanation && (
                <div className="pq-explain">
                  <strong>Explanation</strong>
                  <p>{graded.explanation}</p>
                  {graded.sources && graded.sources.length > 0 && (
                    <small className="pq-sources">
                      From your library:{' '}
                      {graded.sources.map((s, i) => (
                        <span key={i}>
                          {s.source}
                          {s.location && `, ${s.location}`}
                          {s.private && <em> (private)</em>}
                          {i < graded.sources!.length - 1 ? ' · ' : ''}
                        </span>
                      ))}
                    </small>
                  )}
                </div>
              )}
              <FollowUp key={graded.attempt_id} attemptId={graded.attempt_id} />
              <div className="pq-mark">
                <span>{graded.verdict ? 'Disagree with the grade?' : 'Mark yourself:'}</span>
                {(['correct', 'partial', 'incorrect'] as Verdict[]).map((v) => (
                  <button key={v} className={`chip ${graded.verdict === v ? 'on' : ''}`} onClick={() => mark(v)}>
                    {VERDICT_LABEL[v]}
                  </button>
                ))}
              </div>
              <div className="pq-actions">
                {q.has_next ? (
                  <button className="primary" disabled={busy !== ''} onClick={() => next('', q.key)}>
                    {busy === 'next' ? 'One moment…' : 'Next part of this question'}
                  </button>
                ) : (
                  <button className="primary" disabled={busy !== ''} onClick={() => next(q.key)}>
                    Try a similar problem
                  </button>
                )}
                <button className="ghost" disabled={busy !== ''} onClick={() => next()}>
                  {q.has_next ? 'Skip to a new question' : 'Next question'}
                </button>
                {voiceSupported() && (
                  <button className="ghost" disabled={busy !== ''} onClick={() => { setQ(null); setVoice(true) }}>
                    Switch to a voice interview
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

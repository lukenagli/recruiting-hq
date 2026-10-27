import { useState } from 'react'
import Practice from './Practice'
import Progress from './Progress'
import Stories from './Stories'
import type { PrepOptions, Question } from './api'
import { Loading, Logo, useApi, usePreview, useSchool } from './ui'

const ROUND_HELP: Record<string, string> = {
  'Coffee Chat': 'Informal call with a banker or a student who has been through it',
  'Round 1': 'First-round interview',
  'Round 2': 'Second-round interview',
  Superday: 'Final round, back-to-back interviews',
}
const SOURCE_LABEL: Record<string, string> = {
  live_1y: 'This year, 1Ys',
  live_2y: 'This year, 2Ys',
  master: 'Prior years',
  ib_2025: '2025 bank',
  technical: 'Technical bank',
}

function go(bank: string, round: string, who: string) {
  const q = new URLSearchParams()
  if (round) q.set('round', round)
  if (bank) q.set('bank', bank)
  if (who) q.set('who', who)
  q.set('tab', 'browse')
  window.location.hash = `#/prep?${q}`
}

function Results({ bank, round, who }: { bank: string; round: string; who: string }) {
  const { data, error } = useApi<{ total: number; questions: Question[] }>('/api/prep/questions', { bank, round })
  const [type, setType] = useState('All')
  const [open, setOpen] = useState<number | null>(null)
  if (!data) return <Loading error={error} />

  const lastName = who.split(' ').slice(-1)[0]?.toLowerCase() ?? ''
  const fromWho = who ? data.questions.filter((q) => q.interviewer.toLowerCase().includes(lastName)) : []
  const types = ['All', ...Array.from(new Set(data.questions.map((q) => q.qtype)))]
  const shown = data.questions.filter((q) => type === 'All' || q.qtype === type)

  return (
    <section>
      <h2>
        {data.total.toLocaleString()} questions on file
        {data.total > data.questions.length && <small> · showing the newest {data.questions.length}</small>}
      </h2>
      {who && (
        <p className="notice">
          {fromWho.length > 0
            ? `${fromWho.length} of these were logged from conversations with ${who}. They are marked below.`
            : `Nobody has logged questions from ${who} yet, so this is everything asked at ${bank} in this round.`}
        </p>
      )}
      {data.total === 0 && <p className="muted">Nothing logged for this combination yet. Try "Any round" or another bank.</p>}
      <div className="chips">
        {types.length > 2 &&
          types.map((t) => (
            <button key={t} className={`chip ${type === t ? 'on' : ''}`} onClick={() => setType(t)}>
              {t} {t !== 'All' && <em>{data.questions.filter((q) => q.qtype === t).length}</em>}
            </button>
          ))}
      </div>
      <ul className="questions">
        {shown.map((q) => {
          const mine = who && q.interviewer.toLowerCase().includes(lastName)
          return (
            <li key={q.id} className={mine ? 'mine' : ''}>
              <button onClick={() => setOpen(open === q.id ? null : q.id)} disabled={!q.answer_notes}>
                <span className={`qtype t-${q.qtype.replace(' ', '')}`}>{q.qtype}</span>
                <span className="qtext">
                  {q.question}
                  <small>
                    {[q.bank !== 'Unknown' && bank === 'Any' ? q.bank : '', q.grp, q.interviewer, q.round !== 'Unknown' && round === 'Any' ? q.round : '', SOURCE_LABEL[q.source]]
                      .filter(Boolean)
                      .join(' · ')}
                    {q.answer_notes && (open === q.id ? ' · hide notes' : ' · show notes')}
                  </small>
                  {open === q.id && <span className="answer">{q.answer_notes}</span>}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

const TABS = [
  ['practice', 'Practice'],
  ['stories', 'Key information'],
  ['progress', 'My progress'],
  ['browse', 'Browse the question bank'],
]

export default function Prep({ bank, round, who, tab }: { bank: string; round: string; who: string; tab: string }) {
  const { data, error } = useApi<PrepOptions>('/api/prep/options')
  const school = useSchool()
  const preview = usePreview()
  const [topic, setTopic] = useState('')
  if (!data) return <Loading error={error} />
  const tabs = TABS.filter(([id]) => (id !== 'browse' || school.club) && (id !== 'stories' || !preview)) // the question bank is the school club's material; preview drops Key information
  const current = tab && tabs.some(([id]) => id === tab) ? tab : round && school.club ? 'browse' : 'practice'
  const header = (
    <>
      <h1>Interview Prep</h1>
      <div className="tabs">
        {tabs.map(([id, label]) => (
          <a key={id} href={`#/prep?tab=${id}`} className={current === id ? 'on' : ''} onClick={() => setTopic('')}>
            {label}
          </a>
        ))}
      </div>
    </>
  )
  if (current === 'practice')
    return (
      <div className="prep">
        {header}
        <Practice key={topic} options={data} start={topic ? { categories: ['Technical'], topics: [topic], stage: '', difficulty: 'adaptive' } : undefined} />
      </div>
    )
  if (current === 'stories')
    return (
      <div className="prep">
        {header}
        <Stories />
      </div>
    )
  if (current === 'progress')
    return (
      <div className="prep">
        {header}
        <Progress
          onPractice={(t) => {
            window.location.hash = '#/prep?tab=practice'
            setTimeout(() => setTopic(t), 0)
          }}
        />
      </div>
    )

  const count = (b: string, r: string) =>
    data.counts.filter((c) => (b === 'Any' || c.bank === b) && (r === 'Any' || c.round === r)).reduce((n, c) => n + c.n, 0)
  const myBanks = new Set(data.people.map((p) => p.bank))
  const banks = Array.from(new Set(data.counts.map((c) => c.bank)))
    .filter((b) => b !== 'Unknown' && (myBanks.has(b) || count(b, round || 'Any') > 0))
    .sort((a, b) => Number(myBanks.has(b)) - Number(myBanks.has(a)) || count(b, round || 'Any') - count(a, round || 'Any'))
  const contacts = data.people.filter((p) => p.bank === bank)

  return (
    <div className="prep">
      {header}

      <section className="step">
        <h2><span className="step-n">1</span> What are we preparing for?</h2>
        <div className="round-cards">
          {[...data.rounds, 'Any'].map((r) => (
            <button key={r} className={`round-card ${round === r ? 'on' : ''}`} onClick={() => go(bank, r, who)}>
              <strong>{r === 'Any' ? 'Any round' : r}</strong>
              <span>{ROUND_HELP[r] ?? 'Everything on file'}</span>
              <em>{count('Any', r).toLocaleString()} questions</em>
            </button>
          ))}
        </div>
      </section>

      {round && (
        <section className="step">
          <h2><span className="step-n">2</span> Which bank?</h2>
          <div className="chips banks">
            <button className={`chip ${bank === 'Any' ? 'on' : ''}`} onClick={() => go('Any', round, '')}>
              Any bank <em>{count('Any', round)}</em>
            </button>
            {banks.map((b) => (
              <button key={b} className={`chip ${bank === b ? 'on' : ''}`} onClick={() => go(b, round, '')}>
                <Logo bank={b} domain={data.domains[b] ?? ''} size={18} /> {b} <em>{count(b, round)}</em>
              </button>
            ))}
          </div>
        </section>
      )}

      {round && bank && bank !== 'Any' && contacts.length > 0 && (
        <section className="step">
          <h2><span className="step-n">3</span> With who? <small>optional</small></h2>
          <div className="chips">
            <button className={`chip ${who === '' ? 'on' : ''}`} onClick={() => go(bank, round, '')}>
              Not sure yet
            </button>
            {contacts.map((p) => (
              <button key={p.name} className={`chip ${who === p.name ? 'on' : ''}`} onClick={() => go(bank, round, p.name)}>
                {p.name} <em>{[p.title, p.grp].filter(Boolean).join(', ')}</em>
              </button>
            ))}
          </div>
        </section>
      )}

      {round && bank && <Results key={`${bank}|${round}|${who}`} bank={bank} round={round} who={who} />}
    </div>
  )
}

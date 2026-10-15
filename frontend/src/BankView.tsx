import { useEffect, useState } from 'react'
import { post } from './api'
import type { BankDetail, Interaction, Person, ThankYouDraft } from './api'
import DraftCard from './DraftCard'
import JourneyMap from './JourneyMap'
import { Loading, Logo, StagePips, StatusTag, YALE_LABEL, fmtDate, roleOf, useApi } from './ui'

function when(i: { date: string; date_note: string }) {
  if (!i.date) return i.date_note || 'date not recorded'
  return i.date_note && !i.date_note.startsWith('around') ? `${fmtDate(i.date, true)}, ${i.date_note}` : i.date_note || fmtDate(i.date, true)
}

function thankYou(chat: Interaction) {
  if (chat.status !== 'done') return null
  if (chat.thank_you === 'n/a') return <span className="tag">Thank-you not needed</span>
  if (chat.thank_you === 'sent') return <span className="tag s-spoke">Thank-you sent</span>
  if (chat.thank_you) return <span className="tag s-spoke">Thank-you sent {fmtDate(chat.thank_you)}</span>
  return <span className="tag s-awaiting">Thank-you owed</span>
}

/** For a finished chat that still needs a thank-you: the saved draft, or a button to write one. */
function ChatThankYou({ c, personId, onChanged }: { c: Interaction; personId: number; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (c.status !== 'done' || c.thank_you) return null
  if (c.draft)
    return <DraftCard id={c.draft.id} body={c.draft.body} check={c.draft.check_line} send={c.draft.send_line} sent={Boolean(c.draft.sent_at)} onSent={onChanged} />

  async function write() {
    setBusy(true)
    setError('')
    try {
      const out = await post<ThankYouDraft>('/api/thank-you', { interaction_id: c.id, person_id: personId })
      if (out.ok) onChanged()
      else setError(out.reason ?? 'Could not draft it.')
    } catch (e) {
      setError(`Could not reach the server (${(e as Error).message}).`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button className="btn" disabled={busy} onClick={write}>
        {busy ? 'Drafting…' : 'Draft thank-you note'}
      </button>
      {error && <p className="notice error">{error}</p>}
    </>
  )
}

function QuestionList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null
  return (
    <>
      <h4>{title}</h4>
      <ul className="qlist">
        {items.map((q) => (
          <li key={q}>{q}</li>
        ))}
      </ul>
    </>
  )
}

/** Public-web background, kept visibly separate from Luke's own notes. */
function Background({ p, onChanged }: { p: Person; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => setMessage(''), [p.id])

  async function run(path: string) {
    setBusy(true)
    setMessage('')
    try {
      const out = await post<{ ok: boolean; message?: string }>(path, {})
      if (!out.ok && out.message) setMessage(out.message)
      onChanged()
    } catch (e) {
      setMessage(`Could not reach the server (${(e as Error).message}).`)
    } finally {
      setBusy(false)
    }
  }

  const search = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${p.name} ${p.bank}`)}`
  return (
    <div className="background">
      <h4>Background from the web</h4>
      {p.background && <p>{p.background}</p>}
      {p.background && (
        <p className="fine">
          Found by web search on {fmtDate(p.background_at)}. Not verified, so check before relying on it.{' '}
          {p.background_sources.map((s, i) => (
            <a key={s} href={s} target="_blank" rel="noreferrer">
              source {i + 1}
            </a>
          ))}
        </p>
      )}
      {message && <p className="notice error">{message}</p>}
      <a className="btn" href={p.linkedin_url || search} target="_blank" rel="noreferrer">
        {p.linkedin_url ? 'Open LinkedIn profile' : 'Search LinkedIn'}
      </a>
      <button className="btn" disabled={busy} onClick={() => run(`/api/people/${p.id}/background`)}>
        {busy ? 'Looking…' : p.background ? 'Look up again' : 'Look up background'}
      </button>
      {(p.background || p.linkedin_url) && (
        <button className="btn" disabled={busy} onClick={() => run(`/api/people/${p.id}/background/clear`)}>
          Remove
        </button>
      )}
    </div>
  )
}

function PersonPanel({ p, onChanged }: { p: Person; onChanged: () => void }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>{p.name}</h3>
        <StatusTag status={p.status} />
      </div>
      <p className="role">{[p.title, p.grp, p.subgroup, p.title === '2Y' ? '' : YALE_LABEL[p.alum ?? '']].filter(Boolean).join(' · ')}</p>
      {p.email && (
        <p>
          <a href={`mailto:${p.email}`}>{p.email}</a>
        </p>
      )}
      {p.outreach && <p className="muted">Reached out {p.outreach.split(', ').map((d) => fmtDate(d)).join(' and ')}</p>}
      {p.notes && <p>{p.notes}</p>}

      {p.chats.map((c) => (
        <div className="convo" key={c.id}>
          <div className="convo-head">
            <strong>Coffee chat</strong>
            <span>{when(c)}{c.format ? ` · ${c.format}` : ''}</span>
          </div>
          {c.summary ? <p>{c.summary}</p> : c.status === 'done' && <p className="muted">No notes recorded for this conversation yet.</p>}
          <QuestionList title="They asked me" items={c.asked_me} />
          <QuestionList title="I asked them" items={c.i_asked} />
          {thankYou(c)}
          <ChatThankYou c={c} personId={p.id} onChanged={onChanged} />
        </div>
      ))}
      {p.events.map((e) => (
        <div className="convo" key={e.id}>
          <div className="convo-head">
            <strong>{e.title}</strong>
            <span>{when(e)}</span>
          </div>
          {e.notes ? <p>{e.notes}</p> : <p className="muted">No notes recorded.</p>}
        </div>
      ))}
      <Background p={p} onChanged={onChanged} />
    </div>
  )
}

function EventPanel({ i, detail, onSelect }: { i: Interaction; detail: BankDetail; onSelect: (id: string) => void }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>{i.title}</h3>
        <StatusTag status={i.status as 'done'} />
      </div>
      <p className="role">{[i.date || i.date_note ? when(i) : '', i.format].filter(Boolean).join(' · ')}</p>
      {i.summary && <p>{i.summary}</p>}
      {i.people.length > 0 && <h4>People I met</h4>}
      {i.people.map((j) => {
        const p = detail.contacts.find((c) => c.id === j.person_id)
        if (!p) return null
        return (
          <button className="mini-person" key={p.id} onClick={() => onSelect(`person:${p.id}`)}>
            <strong>{p.name}</strong>
            <small>{[p.title, p.grp].filter(Boolean).join(' · ')}</small>
            {j.notes && <span>{j.notes}</span>}
          </button>
        )
      })}
    </div>
  )
}

export default function BankView({ bank }: { bank: string }) {
  const { data, error, reload } = useApi<BankDetail>(`/api/banks/${encodeURIComponent(bank)}`)
  const [selected, setSelected] = useState('')
  useEffect(() => setSelected(''), [bank])
  if (!data) return <Loading error={error} />

  const app = data.application
  const person = data.contacts.find((p) => `person:${p.id}` === selected)
  const event = data.interactions.find((i) => `interaction:${i.id}` === selected)
  const names = new Map(data.contacts.map((p) => [p.id, p.name]))
  const timeline = [...data.interactions].sort((a, b) => (a.date || '9').localeCompare(b.date || '9'))

  return (
    <div>
      <a className="back" href="#/map">← All banks</a>
      <div className="bank-head">
        <Logo bank={data.bank} domain={data.domain} size={56} />
        <div>
          <h1>{data.bank}</h1>
          <p className="lede">
            {data.people} {data.people === 1 ? 'person' : 'people'} · {data.spoke} spoken
            {data.scheduled ? ` · ${data.scheduled} scheduled` : ''}
            {app.prefs ? ` · group preference: ${app.prefs}` : ''}
          </p>
        </div>
        <StagePips stage={data.stage} labels />
      </div>

      {app.status === 'out' && <p className="notice out">No longer in this process. {app.notes}</p>}
      {app.status !== 'out' && app.notes && <p className="notice">{app.notes}</p>}

      <div className="facts">
        <div>
          <small>Application</small>
          <strong>{app.status === 'out' ? 'Out of process' : app.applied === 'Yes' ? 'Submitted' : app.applied === 'No' ? 'Not applied yet' : 'Not tracked'}</strong>
        </div>
        <div>
          <small>Deadline</small>
          <strong>{app.deadline ? fmtDate(app.deadline, true) : 'Not listed'}</strong>
        </div>
        <div>
          <small>Application link</small>
          {app.link ? <a href={app.link} target="_blank" rel="noreferrer">Open posting</a> : <strong>Not listed</strong>}
        </div>
        <div>
          <small>Interview questions on file</small>
          <a href={`#/prep?bank=${encodeURIComponent(data.bank)}`}>{data.questions_on_file} questions → practice</a>
        </div>
      </div>

      <h2>How I got here</h2>
      <p className="muted">Click anyone or any event to see the details.</p>
      <div className="journey-layout">
        <JourneyMap detail={data} selected={selected} onSelect={setSelected} />
        {person ? (
          <PersonPanel p={person} onChanged={reload} />
        ) : event ? (
          <EventPanel i={event} detail={data} onSelect={setSelected} />
        ) : (
          <div className="panel empty">
            <p className="muted">Select a person or event on the map.</p>
          </div>
        )}
      </div>

      <h2>Fact sheet</h2>
      {data.facts.length === 0 ? (
        <p className="muted">Nothing recorded about {data.bank} itself yet. Facts from your chats land here.</p>
      ) : (
        <div className="factsheet">
          {Array.from(new Set(data.facts.map((f) => f.category))).map((category) => (
            <div className="card" key={category}>
              <h3>{category}</h3>
              <ul>
                {data.facts
                  .filter((f) => f.category === category)
                  .map((f) => (
                    <li key={f.id}>
                      {f.fact}
                      {f.source && <small> · {f.source}</small>}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <h2>
        Everyone at {data.bank} <small>{data.contacts.length} contacts, including people I have not spoken with</small>
      </h2>
      <div className="table-wrap">
        <table className="progress">
          <thead>
            <tr>
              <th>Name</th>
              <th>Role</th>
              <th>Group</th>
              <th>Yale</th>
              <th>Status</th>
              <th>Last contact</th>
            </tr>
          </thead>
          <tbody>
            {[...data.contacts]
              .sort((a, b) => roleOf(a.title).rank - roleOf(b.title).rank || a.name.localeCompare(b.name))
              .map((p) => {
                const last = [...p.chats, ...p.events].map((x) => x.date).filter(Boolean).sort().pop()
                return (
                  <tr
                    key={p.id}
                    onClick={() => {
                      setSelected(`person:${p.id}`)
                      document.querySelector('.journey-layout')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }}
                  >
                    <td><strong>{p.name}</strong></td>
                    <td>{p.title || '–'}</td>
                    <td>{p.grp || '–'}</td>
                    <td>{YALE_LABEL[p.alum ?? ''] || '–'}</td>
                    <td><StatusTag status={p.status} /></td>
                    <td>{last ? fmtDate(last) : '–'}</td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>

      <h2>Timeline</h2>
      {timeline.length === 0 && <p className="muted">Nothing logged for this bank yet.</p>}
      <ol className="timeline">
        {timeline.map((i) => (
          <li key={i.id} className={`s-${i.status}`}>
            <button
              onClick={() => {
                setSelected(i.kind === 'coffee_chat' && i.people[0] ? `person:${i.people[0].person_id}` : `interaction:${i.id}`)
                document.querySelector('.journey-layout')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            >
              <span className="t-date">{i.date ? fmtDate(i.date, true) : i.date_note || 'No date'}</span>
              <span className="t-body">
                <strong>{i.title}</strong>
                <small>
                  {i.kind !== 'coffee_chat' && i.people.length > 0 && `Met ${i.people.map((j) => names.get(j.person_id)).join(', ')}. `}
                  {i.summary}
                </small>
              </span>
              <StatusTag status={i.status as 'done'} />
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}

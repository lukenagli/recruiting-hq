import { useEffect, useState } from 'react'
import { post } from './api'
import type { BankDetail, Interaction, Person, ThankYouDraft } from './api'
import DraftCard from './DraftCard'
import JourneyMap from './JourneyMap'
import { Loading, Logo, StatusTag, alumLabel, fmtDate, roleOf, useApi, usePreview, useSchool } from './ui'

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
  const preview = usePreview()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (preview && c.status === 'done' && c.thank_you) return <SentThankYou c={c} personId={personId} onChanged={onChanged} />
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

/** Preview: a chat whose thank-you is done (or not needed). Shows the note that went out, to read or copy again;
 *  lets you save one sent outside the app, or write one anyway when none was needed (a 2Y you've met before). */
function SentThankYou({ c, personId, onChanged }: { c: Interaction; personId: number; onChanged: () => void }) {
  const [mode, setMode] = useState<'' | 'paste'>('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  async function act(fn: () => Promise<{ ok: boolean; reason?: string }>) {
    setBusy(true)
    setError('')
    try {
      const out = await fn()
      if (out.ok) onChanged()
      else setError(out.reason ?? 'That did not work.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const write = () => act(() => post('/api/thank-you', { interaction_id: c.id, person_id: personId }))

  if (c.draft) {
    const sent = Boolean(c.draft.sent_at) || c.thank_you !== 'n/a'
    if (!sent) return <DraftCard id={c.draft.id} body={c.draft.body} check={c.draft.check_line} send={c.draft.send_line} onSent={onChanged} />
    return (
      <details className="sent-note">
        <summary>{c.thank_you === 'n/a' ? 'Thank-you you sent' : 'Read the thank-you you sent'}</summary>
        <pre>{c.draft.body}</pre>
        <button
          className="btn"
          onClick={async () => {
            await navigator.clipboard.writeText(c.draft!.body).catch(() => undefined)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </details>
    )
  }
  return (
    <div className="sent-note-actions">
      {mode === 'paste' ? (
        <>
          <textarea rows={6} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the thank-you email you sent" />
          <button className="btn" disabled={busy || !text.trim()}
            onClick={() => act(() => post('/api/thank-you/record', { interaction_id: c.id, person_id: personId, body: text }))}>
            {busy ? 'Saving…' : 'Save it'}
          </button>
          <button className="link" onClick={() => setMode('')}>Cancel</button>
        </>
      ) : (
        <>
          {c.thank_you === 'n/a' && (
            <button className="btn" disabled={busy} onClick={write}>{busy ? 'Drafting…' : 'Write one anyway'}</button>
          )}
          <button className="link" onClick={() => setMode('paste')}>
            {c.thank_you === 'n/a' ? 'Or save one you sent' : 'Save the email you sent, to find it here later'}
          </button>
        </>
      )}
      {error && <p className="notice error">{error}</p>}
    </div>
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
  const school = useSchool()
  return (
    <div className="panel">
      <div className="panel-head">
        <h3>{p.name}</h3>
        <StatusTag status={p.status} />
      </div>
      <p className="role">{[p.title, p.grp, p.subgroup, p.title === '2Y' ? '' : alumLabel(school, p.alum)].filter(Boolean).join(' · ')}</p>
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

// The bank overview's fixed fields: what matters about the bank itself, not who said what.
// [topic, label, shown only when something is known]
const OVERVIEW_FIELDS: [string, string, boolean][] = [
  ['Spots for SOM', 'Offers to students from your school', true],
  ['Program', 'Generalist or group', false],
  ['Homework', 'Homework', false],
  ['Final project', 'Final project', false],
  ['Training', 'Training', false],
  ['Staffing', 'Staffing', false],
  ['Team size', 'Team size', false],
  ['Recruiting process', 'Recruiting process', true],
]

export default function BankView({ bank, initial = '' }: { bank: string; initial?: string }) {
  const { data, error, reload } = useApi<BankDetail>(`/api/banks/${encodeURIComponent(bank)}`)
  const school = useSchool()
  const [selected, setSelected] = useState('')
  // Arriving from a dot on the recruiting map opens that person or event and scrolls to it.
  useEffect(() => {
    setSelected(initial)
    if (initial) setTimeout(() => document.querySelector('.journey-layout')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300)
  }, [bank, initial])
  if (!data) return <Loading error={error} />

  const app = data.application
  const person = data.contacts.find((p) => `person:${p.id}` === selected)
  const event = data.interactions.find((i) => `interaction:${i.id}` === selected)

  return (
    <div>
      <a className="back" href="#/map">← All banks</a>
      <div className="bank-head">
        <Logo bank={data.bank} domain={data.domain} size={56} />
        <div>
          <h1>{data.bank}</h1>
          {app.prefs && <p className="lede">Recruiting for {app.prefs.split('>')[0].trim()}</p>}
        </div>
      </div>

      {app.status === 'out' && <p className="notice out">No longer in this process. {app.notes}</p>}
      {app.status !== 'out' && app.notes && <p className="notice">{app.notes}</p>}

      <h2>Overview</h2>
      <div className="overview">
        <div className="ov-item ov-app">
          <small>Application</small>
          <strong>
            {app.status === 'out' ? 'Out of process' : app.applied === 'Yes' ? 'Submitted' : app.deadline ? `Due ${fmtDate(app.deadline, true)}` : 'No deadline listed'}
          </strong>
          <span className="ov-links">
            {app.link && <a href={app.link} target="_blank" rel="noreferrer">Application</a>}
            <a href={`#/letters/${encodeURIComponent(data.bank)}`}>Cover letter</a>
            <a href={`#/prep?bank=${encodeURIComponent(data.bank)}`}>Practice questions</a>
          </span>
        </div>
        {OVERVIEW_FIELDS.map(([field, label, onlyWhenKnown]) => {
          const items = data.facts.filter((f) => f.category === field)
          if (onlyWhenKnown && items.length === 0) return null
          return (
            <div className={`ov-item ${items.length ? '' : 'unknown'}`} key={field}>
              <small>{label}</small>
              {items.length === 0 ? (
                <span className="muted">Not known yet</span>
              ) : (
                items.map((f) => (
                  <span key={f.id} title={f.source ? `From ${f.source}` : undefined}>
                    {f.fact}
                  </span>
                ))
              )}
            </div>
          )
        })}
      </div>

      <h2>How it has gone</h2>
      <p className="muted">Each step in date order. Click a card for the details.</p>
      <div className="journey-layout">
        <JourneyMap detail={data} selected={selected} onSelect={setSelected} />
        {person ? (
          <PersonPanel p={person} onChanged={reload} />
        ) : event ? (
          <EventPanel i={event} detail={data} onSelect={setSelected} />
        ) : (
          <div className="panel empty">
            <p className="muted">Select a step or a person.</p>
          </div>
        )}
      </div>
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
              <th>{school.short || 'School'}</th>
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
                    <td>{alumLabel(school, p.alum) || '–'}</td>
                    <td><StatusTag status={p.status} /></td>
                    <td>{last ? fmtDate(last) : '–'}</td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>

    </div>
  )
}

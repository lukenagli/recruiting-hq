import { useEffect, useRef, useState } from 'react'
import { API_URL, post } from './api'
import type { CoverLetter } from './api'
import { Loading, useApi } from './ui'

/** One bank's cover letter: who it is addressed to, the draft (editable), its checks, and a Word download. */
export default function CoverLetterEditor({ bank }: { bank: string }) {
  const path = `/api/cover-letters/${encodeURIComponent(bank)}`
  const { data, error, reload } = useApi<CoverLetter>(path)
  const [paragraphs, setParagraphs] = useState<string[]>([])
  const [details, setDetails] = useState({ recruiter_name: '', recruiter_title: '', office: '', address: '' })
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [asked, setAsked] = useState('') // the recruiter the "Mr. or Ms.?" question was put aside for

  // While the site works out Mr. or Ms. for the recruiter (a few seconds, in the background), check back.
  const polls = useRef(0)
  useEffect(() => {
    if (!data || !data.needs_honorific || data.greeting_lookup === 'unknown' || polls.current >= 12) return
    polls.current += 1
    const timer = setTimeout(reload, 4000)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  useEffect(() => {
    if (!data) return
    setParagraphs(data.paragraphs)
    setDetails({ recruiter_name: data.recruiter_name, recruiter_title: data.recruiter_title, office: data.office, address: data.address })
    setDirty(false)
  }, [data])

  // Edits to the letter save themselves a moment after typing stops, and when the page is left.
  const [saveNote, setSaveNote] = useState('')
  const latest = useRef(paragraphs)
  const pending = useRef(false)
  pending.current = dirty
  useEffect(() => {
    latest.current = paragraphs
    if (!dirty) return
    const sent = paragraphs
    const timer = setTimeout(() => {
      setSaveNote('Saving…')
      post(path, { paragraphs: sent }).then(
        () => {
          if (latest.current !== sent) return // typed more meanwhile: that is saved next
          setDirty(false)
          setSaveNote('Saved')
        },
        (e) => setSaveNote(`Not saved: ${(e as Error).message}`),
      )
    }, 800)
    return () => clearTimeout(timer)
  }, [paragraphs, dirty, path])
  useEffect(() => {
    const flush = () => {
      if (!pending.current) return
      pending.current = false
      fetch(`${API_URL}${path}`, { method: 'POST', keepalive: true, credentials: 'include', headers: { 'Content-Type': 'application/json' },
                                   body: JSON.stringify({ paragraphs: latest.current }) }).catch(() => undefined)
    }
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush() // leaving this letter for another page of the site
    }
  }, [path])

  if (!data) return <Loading error={error} />

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label)
    setMessage('')
    try {
      await action()
      reload()
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  const write = () => {
    if (data.submitted && !confirm('You marked this letter as submitted. A new draft replaces it. Continue?')) return
    if ((data.edited || dirty || saveNote === 'Saved') && !confirm('Writing a new draft replaces your edits to this letter. Continue?')) return
    run('write', async () => {
      const out = await post<{ ok: boolean; reason?: string }>(`${path}/write`, {})
      if (!out.ok) throw new Error(out.reason)
    })
  }
  const saveDetails = () => {
    polls.current = 0
    return run('details', () => post(path, { details }))
  }
  const answer = (h: string) => run('honorific', () => post(path, { details: { recruiter_honorific: h } }))
  const askNow = data.needs_honorific && data.greeting_lookup === 'unknown' && asked !== data.recruiter_name
  const words = paragraphs.join(' ').split(/\s+/).filter(Boolean).length

  return (
    <div className="letter-editor">
      {askNow && (
        <div className="modal-back" role="dialog" aria-modal="true">
          <div className="modal ask-honorific">
            <h3>How should the letter address {data.recruiter_name}?</h3>
            <p className="muted">The site couldn't tell from the name or from anything public. The greeting uses the full name until you say.</p>
            <div className="ask-honorific-choices">
              {['Ms.', 'Mr.', 'Mx.'].map((h) => (
                <button key={h} className="primary" disabled={!!busy} onClick={() => answer(h)}>
                  {busy === 'honorific' ? '…' : h}
                </button>
              ))}
              <button className="ghost" disabled={!!busy} onClick={() => setAsked(data.recruiter_name)}>
                Not sure yet
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="card letter-to">
        <h3>Addressed to</h3>
        <div className="letter-fields">
          <label className="field">
            Recruiter <small>(e.g. Ms. Jordan Lee)</small>
            <input value={details.recruiter_name} onChange={(e) => setDetails({ ...details, recruiter_name: e.target.value })} />
          </label>
          <label className="field">
            Their title
            <input value={details.recruiter_title} onChange={(e) => setDetails({ ...details, recruiter_title: e.target.value })} placeholder="e.g. Campus Recruiter" />
          </label>
          <label className="field">
            Office you are applying to
            <input value={details.office} onChange={(e) => setDetails({ ...details, office: e.target.value })} placeholder="e.g. New York" />
          </label>
          <label className="field">
            Office address
            <textarea rows={2} value={details.address} onChange={(e) => setDetails({ ...details, address: e.target.value })} />
          </label>
        </div>
        <button className="btn" disabled={!!busy} onClick={saveDetails}>
          {busy === 'details' ? 'Saving…' : 'Save'}
        </button>
      </div>

      {data.basis && (
        <p className="letter-basis">
          {data.exists ? 'A new draft starts' : 'Drafts start'} from your <strong>{data.basis.bank}</strong> letter
          {data.basis.uploaded ? ' (your first one)' : ''}
          {data.basis.reasons.length > 0 ? `: ${data.basis.reasons.join(', ')}` : ', your closest one'}.
          {data.basis.others.length > 0 && <> Wording can also come from your {data.basis.others.join(' and ')} letter{data.basis.others.length > 1 ? 's' : ''}.</>}
        </p>
      )}
      <div className="letter-actions">
        <button className="primary" disabled={!!busy} onClick={write}>
          {busy === 'write' ? 'Writing… about 30 seconds' : data.exists ? 'Write a new draft' : 'Write a draft'}
        </button>
        {data.exists && (
          <>
            <a className="btn" href={`${API_URL}${path}/docx`} title="For a PDF, open it in Word and choose File > Save As > PDF">
              Download Word file
            </a>
            <button
              className={`btn ${data.submitted ? 'on' : ''}`}
              disabled={!!busy}
              title="Letters you submitted are where drafts for similar banks start"
              onClick={() => run('submitted', () => post(`${path}/submitted`, { submitted: !data.submitted }))}
            >
              {data.submitted ? '✓ Submitted' : 'Mark as submitted'}
            </button>
            <button className="btn" onClick={() => navigator.clipboard.writeText([data.salutation, ...paragraphs, 'Sincerely,', data.signature].join('\n\n'))}>
              Copy text
            </button>
          </>
        )}
      </div>
      {data.exists && <p className="muted"><small>For a PDF, open the Word file and choose File &gt; Save As &gt; PDF: only Word lays it out exactly as Word does.</small></p>}
      {message && <p className="notice error">{message}</p>}

      {data.warnings.length > 0 && (
        <div className="notice letter-warnings">
          <strong>Fill in or check before sending</strong>
          <ul>{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </div>
      )}

      {data.exists ? (
        <div className="card letter-page">
          <p>{data.date}</p>
          <p className="letter-recipient">{data.recipient.join('\n')}</p>
          <p>{data.salutation}</p>
          {paragraphs.map((text, i) => (
            <textarea
              key={i}
              className={`letter-paragraph ${text.includes('[[NEED:') ? 'has-need' : ''}`}
              value={text}
              rows={Math.max(4, Math.ceil(text.length / 95))}
              onChange={(e) => {
                const next = [...paragraphs]
                next[i] = e.target.value
                setParagraphs(next)
                setDirty(true)
              }}
            />
          ))}
          <p>Sincerely,</p>
          <p>{data.signature}</p>
          <div className="letter-foot">
            <small className={words > 460 ? 'urgent' : ''}>{words} words{words > 460 ? ', likely more than one page' : ''}</small>
            {saveNote && <small className="muted">{saveNote}</small>}
          </div>
        </div>
      ) : (
        <p className="muted">
          No letter yet. Each draft is your own cover letter, tailored to {bank}: its name, the people you have logged there and
          the group you're recruiting for.
        </p>
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { API_URL, post } from './api'
import type { CoverLetter } from './api'
import { Loading, useApi, usePreview } from './ui'

/** One bank's cover letter: who it is addressed to, the draft (editable), its checks, and a Word download. */
export default function CoverLetterEditor({ bank }: { bank: string }) {
  const path = `/api/cover-letters/${encodeURIComponent(bank)}`
  const { data, error, reload } = useApi<CoverLetter>(path)
  const [paragraphs, setParagraphs] = useState<string[]>([])
  const [details, setDetails] = useState({ recruiter_name: '', recruiter_title: '', office: '', address: '' })
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!data) return
    setParagraphs(data.paragraphs)
    setDetails({ recruiter_name: data.recruiter_name, recruiter_title: data.recruiter_title, office: data.office, address: data.address })
    setDirty(false)
  }, [data])

  // preview: edits to the letter save themselves a moment after typing stops, and when the page is left.
  const preview = usePreview()
  const [saveNote, setSaveNote] = useState('')
  const latest = useRef(paragraphs)
  const pending = useRef(false)
  pending.current = dirty
  useEffect(() => {
    latest.current = paragraphs
    if (!preview || !dirty) return
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
  }, [paragraphs, dirty, preview, path])
  useEffect(() => {
    if (!preview) return
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
  }, [preview, path])

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
    if ((data.edited || dirty || saveNote === 'Saved') && !confirm('Writing a new draft replaces your edits to this letter. Continue?')) return
    run('write', async () => {
      const out = await post<{ ok: boolean; reason?: string }>(`${path}/write`, {})
      if (!out.ok) throw new Error(out.reason)
    })
  }
  const saveDetails = () => run('details', () => post(path, { details }))
  const saveText = () => run('text', () => post(path, { paragraphs }))
  const words = paragraphs.join(' ').split(/\s+/).filter(Boolean).length

  return (
    <div className="letter-editor">
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

      <div className="letter-actions">
        <button className="primary" disabled={!!busy} onClick={write}>
          {busy === 'write' ? 'Writing… about 30 seconds' : data.exists ? 'Write a new draft' : 'Write a draft'}
        </button>
        {data.exists && (
          <>
            <a className="btn" href={`${API_URL}${path}/docx`}>Download Word file</a>
            {preview && <a className="btn" href={`${API_URL}${path}/pdf`}>Download PDF</a>}
            <button className="btn" onClick={() => navigator.clipboard.writeText([data.salutation, ...paragraphs, 'Sincerely,', data.signature].join('\n\n'))}>
              Copy text
            </button>
          </>
        )}
      </div>
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
            {preview && saveNote && <small className="muted">{saveNote}</small>}
            {!preview && dirty && (
              <button className="btn" disabled={!!busy} onClick={saveText}>
                {busy === 'text' ? 'Saving…' : 'Save my edits'}
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="muted">
          No letter yet. Drafts are written from your profile (Settings), the people you have logged at {bank}, and what you have
          learned about the bank, in the shape of your cover letter template (or the standard four-paragraph format).
        </p>
      )}
    </div>
  )
}

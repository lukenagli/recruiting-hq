import { useState } from 'react'
import { API_URL, upload } from './api'
import type { LetterSummary, SetupState } from './api'
import CoverLetterEditor from './CoverLetterEditor'
import { Loading, Logo, fmtDate, useApi } from './ui'

/** Your letters: the first one you wrote yourself, then every one you've submitted. Each new draft starts from the
 *  one most like that application (same group or program, same kind of bank). Before the first: how to write it. */
function YourLetter({ state, onChange, letters }: { state: SetupState; onChange: () => void; letters: LetterSummary[] }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const info = state.cover_template

  async function send(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      await upload<SetupState>('/api/setup/cover-template', file)
      onChange()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (info.has_template) {
    const submitted = letters.filter((l) => l.submitted).map((l) => l.bank)
    // "Nagli_Luke Cover Letter (Guggenheim).docx" reads as "Guggenheim"
    const first = info.filename.match(/\(([^)]+)\)/)?.[1] ?? info.filename.replace(/\.docx$/i, '')
    return (
      <section className="card your-letters">
        <h2>Your letters</h2>
        <p>
          Each new draft starts from the letter of yours most like that application: the same group, or the same kind of program
          (generalist or one group), at the same kind of bank (bulge bracket, boutique). Your other letters help with the wording. The
          more letters you submit, the closer each new draft starts.
        </p>
        <div className="chips your-letter-chips">
          <span className="chip static" title={info.filename}>Your first letter <em>{first}</em></span>
          {submitted.map((b) => (
            <a key={b} className="chip" href={`#/letters/${encodeURIComponent(b)}`}>{b} <em>submitted</em></a>
          ))}
        </div>
        <p className="fine">
          {submitted.length === 0
            ? 'Mark a letter as submitted once you send it, and new drafts can start from it.'
            : 'Mark each letter as submitted once you send it, and it joins the letters drafts start from.'}{' '}
          <label className="link file-link">
            <input type="file" accept=".docx" onChange={(e) => send(e.target.files?.[0])} disabled={busy} />
            {busy ? 'Reading…' : 'Replace your first letter'}
          </label>
          {error && <span className="error-text"> {error}</span>}
        </p>
      </section>
    )
  }

  return (
    <section className="card letter-start">
      <h2>Start with your own letter</h2>
      <p>Write your first cover letter yourself. After that, Recruiting HQ tailors it for every other bank.</p>
      <ol className="letter-steps">
        <li>
          <strong>Download the Yale SOM cover letter template</strong> (a Word file).{' '}
          <a className="btn" href={`${API_URL}/api/setup/cover-template/file`}>Download the template</a>
        </li>
        <li>
          <strong>Write one letter in it</strong>, for any bank you're applying to: why that bank, the people you've spoken with, and your
          experience. Keep the template's layout: the "Dear …:" line, your paragraphs, then "Sincerely," and your name.
        </li>
        <li>
          <strong>Upload it here.</strong> A letter you already sent to a bank works too.
          <label className={`dropzone small ${busy ? 'busy' : ''}`}>
            <input type="file" accept=".docx" onChange={(e) => send(e.target.files?.[0])} disabled={busy} />
            <strong>{busy ? 'Reading…' : 'Choose your cover letter (.docx)'}</strong>
            <span>Word files only, so your fonts and spacing are kept exactly.</span>
          </label>
        </li>
      </ol>
      <p className="fine">
        Then pick a bank below and click "Write a draft". Your sentences stay as you wrote them; only the bank-specific parts change: the
        bank, group and office, the people you spoke with there and what you learned from them, and why that bank.
      </p>
      {error && <p className="notice error">{error}</p>}
    </section>
  )
}

/** All cover letters: one per bank still in the process, and the editor for the one picked. */
export default function Letters({ bank }: { bank: string }) {
  const { data, error } = useApi<LetterSummary[]>('/api/cover-letters')
  const setup = useApi<SetupState>('/api/setup')
  if (!data || !setup.data) return <Loading error={error || setup.error} />
  const current = bank || data.find((l) => l.exists)?.bank || data[0]?.bank || ''
  const ready = setup.data.cover_template.has_template // letters start from the student's own letter

  return (
    <div>
      <h1>Cover Letters</h1>
      <p className="lede">
        One letter per bank, each tailored from your own letters: the one most like that bank. Nothing is made up; gaps are highlighted
        for you to fill. Review every one before you submit it.
      </p>
      <YourLetter state={setup.data} onChange={setup.reload} letters={data} />
      {ready && (
        <>
          <div className="chips banks">
            {data.map((l) => (
              <a key={l.bank} href={`#/letters/${encodeURIComponent(l.bank)}`} className={`chip ${l.bank === current ? 'on' : ''}`}>
                <Logo bank={l.bank} domain={l.domain} size={18} /> {l.bank}
                <em>{l.exists ? (l.submitted ? 'submitted' : l.warnings ? `${l.warnings} to check` : l.edited ? 'edited' : `drafted ${fmtDate(l.updated_at.slice(0, 10))}`) : 'no letter'}</em>
              </a>
            ))}
          </div>
          {data.length === 0 && <p className="muted">No banks yet. Add banks through the assistant or the Recruiting Map.</p>}
          {current && <CoverLetterEditor key={current} bank={current} />}
        </>
      )}
    </div>
  )
}

import { useState } from 'react'
import { API_URL, upload } from './api'
import type { LetterSummary, SetupState } from './api'
import CoverLetterEditor from './CoverLetterEditor'
import { Loading, Logo, fmtDate, useApi, usePreview } from './ui'

/** Your own letter comes first: download the Yale SOM template, write one letter yourself, upload it. */
function YourLetter({ state, onChange }: { state: SetupState; onChange: () => void }) {
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

  if (info.has_template)
    return (
      <p className="notice your-letter">
        Tailoring from your letter <strong>{info.filename}</strong>.{' '}
        <label className="link file-link">
          <input type="file" accept=".docx" onChange={(e) => send(e.target.files?.[0])} disabled={busy} />
          {busy ? 'Reading…' : 'Upload a different one'}
        </label>
        {error && <span className="error-text"> {error}</span>}
      </p>
    )

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
  const preview = usePreview()
  if (!data || !setup.data) return <Loading error={error || setup.error} />
  const current = bank || data.find((l) => l.exists)?.bank || data[0]?.bank || ''
  const ready = !preview || setup.data.cover_template.has_template // preview: letters start from the student's own letter

  return (
    <div>
      <h1>Cover Letters</h1>
      {preview ? (
        <p className="lede">
          One letter per bank, tailored from a letter you wrote yourself. Nothing is made up; gaps are highlighted for you to fill. Review
          every one before you submit it.
        </p>
      ) : (
        <p className="lede">
          One letter per bank, following your cover letter template (set it in Settings → Setup): who you have spoken to and why the
          bank, your experience, and a closing. Nothing is made up; gaps are highlighted for you to fill. Review every one before you submit it.
        </p>
      )}
      {preview && <YourLetter state={setup.data} onChange={setup.reload} />}
      {ready && (
        <>
          <div className="chips banks">
            {data.map((l) => (
              <a key={l.bank} href={`#/letters/${encodeURIComponent(l.bank)}`} className={`chip ${l.bank === current ? 'on' : ''}`}>
                <Logo bank={l.bank} domain={l.domain} size={18} /> {l.bank}
                <em>{l.exists ? (preview && l.submitted ? 'submitted' : l.warnings ? `${l.warnings} to check` : l.edited ? 'edited' : `drafted ${fmtDate(l.updated_at.slice(0, 10))}`) : 'no letter'}</em>
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

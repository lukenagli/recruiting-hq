import { useState } from 'react'
import { API_URL, del, post, upload } from './api'
import type { SetupState } from './api'

/** The cover letter Word file new letters are written into. Used in Setup and in Settings. */
export function CoverTemplate({ state, onChange }: { state: SetupState; onChange: (s: SetupState) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const info = state.cover_template

  async function send(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      onChange(await upload<SetupState>('/api/setup/cover-template', file))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    onChange(await del<SetupState>('/api/setup/cover-template'))
  }

  return (
    <section className="template-block">
      <h3>Cover letter template</h3>
      <p className="fine">
        Upload a cover letter you have written, as a Word file, in the Yale SOM format. Every new letter is written into a copy of it, so the
        fonts, spacing and layout are exactly yours, and its paragraph count, length and voice are matched.
      </p>
      <label className={`dropzone small ${info.has_template ? 'done' : ''}`}>
        <input type="file" accept=".docx" onChange={(e) => send(e.target.files?.[0])} disabled={busy} />
        <strong>{busy ? 'Reading…' : info.has_template ? `✓ ${info.filename}` : 'Choose your cover letter (.docx)'}</strong>
        <span>{info.has_template ? 'Choose another file to replace it.' : 'Until you add one, letters use the Yale SOM template.'}</span>
      </label>
      <div className="template-tools">
        <a className="link" href={`${API_URL}/api/setup/cover-template/file`}>
          Download {info.has_template ? 'your template' : 'the Yale SOM template'}
        </a>
        {info.has_template && (
          <button type="button" className="link danger-link" onClick={remove}>
            Remove and use the Yale SOM template
          </button>
        )}
      </div>
      {error && <p className="notice error">{error}</p>}
    </section>
  )
}

/** The four Finance Club email templates, each editable. */
export function EmailTemplates({ state, onChange }: { state: SetupState; onChange: (s: SetupState) => void }) {
  const [texts, setTexts] = useState<Record<string, string>>(state.email_templates)
  const [open, setOpen] = useState<string>(state.email_kinds[0]?.kind ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const changed = state.email_kinds.some((k) => (texts[k.kind] ?? '') !== (state.email_templates[k.kind] ?? ''))

  async function save() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const next = await post<SetupState>('/api/setup/templates', { email_templates: texts })
      onChange(next)
      setMessage('Saved.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="template-block">
      <h3>Email templates</h3>
      <p className="fine">
        These start as the club's standard templates. Edit them to match exactly what you send. Parts in [square brackets] change for each email;
        everything else is kept word for word. The assistant drafts any of these for you ("draft an outreach email to …"), and thank-yous are
        drafted automatically after you log a chat.
      </p>
      <div className="email-tabs">
        {state.email_kinds.map((k) => (
          <button key={k.kind} type="button" className={`chip ${open === k.kind ? 'on' : ''}`} onClick={() => setOpen(k.kind)}>
            {k.label}
            {!(texts[k.kind] ?? '').trim() && <em>empty</em>}
          </button>
        ))}
      </div>
      {state.email_kinds
        .filter((k) => k.kind === open)
        .map((k) => (
          <div key={k.kind} className="email-editor">
            <small>{k.help}</small>
            <textarea
              rows={14}
              value={texts[k.kind] ?? ''}
              placeholder={k.kind === 'slots_expired' ? 'Paste the follow-up you send when all the times you offered have passed…' : ''}
              onChange={(e) => setTexts({ ...texts, [k.kind]: e.target.value })}
            />
            {k.default && (texts[k.kind] ?? '') !== k.default && (
              <button type="button" className="link" onClick={() => setTexts({ ...texts, [k.kind]: k.default })}>
                Reset to the club standard
              </button>
            )}
          </div>
        ))}
      {error && <p className="notice error">{error}</p>}
      {message && !changed && <p className="notice ok">{message}</p>}
      <button type="button" className="primary" disabled={busy || !changed} onClick={save}>
        {busy ? 'Saving…' : changed ? 'Save email templates' : 'Saved'}
      </button>
      {state.is_admin && <ClubStandard changed={changed} onChange={onChange} />}
    </section>
  )
}

/** Admin only: make your saved templates the standard every Yale account starts with. */
function ClubStandard({ changed, onChange }: { changed: boolean; onChange: (s: SetupState) => void }) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [done, setDone] = useState(false)

  async function publish(force: boolean) {
    setBusy(true)
    setProblem('')
    try {
      onChange(await post<SetupState>('/api/admin/club-templates', { force }))
      setDone(true)
    } catch (e) {
      setProblem((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="club-standard">
      <strong>Club standard</strong>
      <p className="fine">
        Make your saved templates the starting point for every Yale account. Anyone who has not edited a template gets your updates too. Keep
        personal details (your name, phone, email) in [brackets] so they are filled in for each person.
      </p>
      {problem && (
        <div className="notice error">
          {problem}{' '}
          <button type="button" className="link danger-link" onClick={() => publish(true)} disabled={busy}>
            Publish anyway
          </button>
        </div>
      )}
      {done && !problem && <p className="notice ok">Your templates are now the club standard.</p>}
      <button type="button" className="ghost" disabled={busy || changed} onClick={() => publish(false)} title={changed ? 'Save your changes first' : ''}>
        {busy ? 'Publishing…' : 'Make these the standard for every account'}
      </button>
    </div>
  )
}

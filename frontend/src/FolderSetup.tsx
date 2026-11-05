import { useEffect, useState } from 'react'
import { post } from './api'
import { useApi } from './ui'

/**
 * Preview: before an account's first scan, which Outlook folders hold recruiting email. The reader has looked at the
 * folder list (no email opened); the site suggests read every email, check each one, or skip for each folder, and the
 * student clicks to change any. Their choices (and an optional note) steer the first scan.
 */

type Pick = 'always' | 'auto' | 'skip'
type Suggestion = { name: string; pick: Pick; why: string; fixed: boolean }
type Setup = { confirmed: boolean; note: string; folders: Suggestion[] }

const CHOICES: { pick: Pick; label: string }[] = [
  { pick: 'always', label: 'Read every email' },
  { pick: 'auto', label: 'Check each one' },
  { pick: 'skip', label: 'Skip' },
]
const GROUPS: { pick: Pick; title: string; help: string }[] = [
  { pick: 'always', title: 'Recruiting email', help: 'Every email in these is read.' },
  { pick: 'auto', title: 'Not sure', help: 'Each email is checked, and only ones that mention a bank, a banker or the process are opened.' },
  { pick: 'skip', title: 'Not recruiting', help: 'Never opened.' },
]

export default function FolderSetup({ onStart }: { onStart: () => void }) {
  const { data, error } = useApi<Setup>('/api/sync/folder-setup')
  const [choices, setChoices] = useState<Record<string, Pick>>({})
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState('')
  useEffect(() => {
    if (!data) return
    setChoices(Object.fromEntries(data.folders.map((f) => [f.name, f.pick])))
    setNote(data.note || '')
  }, [data])
  if (error) return <p className="notice error">{error}</p>
  if (!data) return null

  async function start() {
    setSaving(true)
    setFailed('')
    try {
      await post('/api/sync/folder-setup', { choices, note })
      onStart()
    } catch (e) {
      setFailed(String((e as Error).message || e))
    } finally {
      setSaving(false)
    }
  }

  // grouped by the site's first suggestion, so a folder doesn't jump between groups as it is changed
  return (
    <div className="refresh-warning folder-setup">
      <p>
        <strong>Before your first scan: where do you keep recruiting email?</strong> The reader looked at your {data.folders.length} Outlook
        folders (it hasn't opened any email). Here's its guess. Check the "Not sure" ones; open a group to change any folder.
      </p>
      {GROUPS.map((g) => {
        const folders = data.folders.filter((f) => f.pick === g.pick)
        if (!folders.length) return null
        return (
          // "Not sure" starts open: those are the ones to look at; the other two show their names and open on a click
          <details key={g.pick} className="folder-setup-group" open={g.pick === 'auto'}>
            <summary>
              <strong>{g.title}</strong> <span className="muted">{folders.length}</span>
              <small className="muted folder-setup-names">{folders.map((f) => f.name).join(', ')}</small>
            </summary>
            <p className="fine">{g.help}</p>
            <ul>
              {folders.map((f) => (
                <li key={f.name}>
                  <span className="folder-setup-name">
                    <strong>{f.name}</strong>
                    <small className="muted">{f.why}</small>
                  </span>
                  {f.fixed ? (
                    <span className="muted folder-setup-fixed">Always read</span>
                  ) : (
                    <span className="folder-setup-choices" role="radiogroup" aria-label={`How to read ${f.name}`}>
                      {CHOICES.map((c) => (
                        <button key={c.pick} type="button" role="radio" aria-checked={choices[f.name] === c.pick}
                          className={choices[f.name] === c.pick ? 'on' : ''} onClick={() => setChoices((s) => ({ ...s, [f.name]: c.pick }))}>
                          {c.label}
                        </button>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )
      })}
      <label className="folder-setup-note">
        <span>Anything else the reader should know? <small className="muted">(optional)</small></span>
        <textarea rows={2} maxLength={600} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="For example: my coffee chat emails are in a folder called Networking, or Finance Club emails stay in my Inbox." />
      </label>
      {failed && <p className="notice error">{failed}</p>}
      <button className="primary" disabled={saving} onClick={start}>Start my first scan</button>
      <small className="muted">
        {' '}Start it when you can step away for about 15 minutes: a Chrome window reads your Outlook in front of everything else until it
        closes itself. After that you can close the laptop.
      </small>
    </div>
  )
}

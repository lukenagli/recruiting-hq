import { useState } from 'react'
import { API_URL, del } from './api'
import { Loading, useApi } from './ui'

type Source = { source: string; private: boolean; passages: number; questions: number }

// One upload box per Breaking Into Wall Street guide. The name is how the guide is stored for this account.
const BIWS = [
  { name: '400 Questions', label: '400 Questions guide' },
  { name: 'Accounting', label: 'Accounting guide' },
  { name: 'Enterprise & Equity Value', label: 'Enterprise & Equity Value guide' },
  { name: 'DCF', label: 'DCF guide' },
  { name: 'Merger Models', label: 'Merger Models guide' },
  { name: 'LBO', label: 'LBO guide' },
  { name: 'Modeling', label: 'Modeling guide' },
  { name: 'IB Associate Complete Guide', label: 'IB Associate Complete Guide' },
]

async function sendFile(file: File, name: string) {
  const form = new FormData()
  form.append('file', file)
  form.append('name', name)
  const res = await fetch(`${API_URL}/api/library/guides`, { method: 'POST', body: form, credentials: 'include' })
  const out = await res.json()
  if (!res.ok) throw new Error(out.detail || 'Upload failed')
  return out as { source: string; questions: number; passages: number }
}

function GuideSlot({ label, name, have, onDone }: { label: string; name: string; have?: Source; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function upload(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      await sendFile(file, name)
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    await del(`/api/library/guides?source=${encodeURIComponent(name)}`)
    onDone()
  }

  return (
    <div className={`guide-slot ${have ? 'done' : ''}`}>
      <b aria-hidden>{have ? '✓' : ''}</b>
      <span className="guide-slot-text">
        <strong>{label}</strong>
        <small>
          {busy
            ? 'Reading… about 10 seconds'
            : !have
              ? 'Not uploaded yet'
              : have.questions
                ? `${have.questions} practice questions · ${have.passages} passages`
                : `${have.passages} passages · Replace to add its practice questions`}
        </small>
        {error && <small className="err">{error}</small>}
      </span>
      <label className="ghost file-button small-btn">
        <input type="file" accept=".pdf" onChange={(e) => upload(e.target.files?.[0])} disabled={busy} />
        {have ? 'Replace' : 'Upload PDF'}
      </label>
      {have && (
        <button className="link danger-link" onClick={remove}>
          Remove
        </button>
      )}
    </div>
  )
}

/** Settings: the study guides behind practice answers. Each person uploads their own copies; they stay private. */
export default function StudyGuides() {
  const { data, error, reload } = useApi<Source[]>('/api/practice/library')
  const [busy, setBusy] = useState('')
  const [problem, setProblem] = useState('')
  if (!data) return <Loading error={error} />
  const mine = data.filter((s) => s.private)
  const byName = new Map(mine.map((s) => [s.source, s]))
  const others = mine.filter((s) => !BIWS.some((b) => b.name === s.source))
  const shared = data.filter((s) => !s.private)

  async function sendOther(files: FileList | null) {
    if (!files?.length) return
    setProblem('')
    for (const file of Array.from(files)) {
      setBusy(`Reading ${file.name}…`)
      try {
        await sendFile(file, '')
      } catch (e) {
        setProblem(`${file.name}: ${(e as Error).message}`)
      }
    }
    setBusy('')
    reload()
  }

  return (
    <section className="card study-guides">
      <h3>Study guides</h3>
      <div className="notice copyright-note">
        <strong>Why you upload these yourself:</strong> the Breaking Into Wall Street guides are paid, copyrighted material, so Recruiting HQ
        can't hand out their questions and answers. Upload your own copies below. Each guide's questions join your practice and are graded
        against the guide's own answers, and explanations quote it. Your uploads are private to your account.
      </div>

      <h4>Breaking Into Wall Street guides</h4>
      <div className="guide-slots">
        {BIWS.map((g) => (
          <GuideSlot key={g.name} label={g.label} name={g.name} have={byName.get(g.name)} onDone={reload} />
        ))}
      </div>

      <h4>Other guides</h4>
      {others.map((s) => (
        <GuideSlot key={s.source} label={s.source} name={s.source} have={s} onDone={reload} />
      ))}
      <label className={`dropzone small ${busy ? 'busy' : ''}`}>
        <input type="file" accept=".pdf,.docx" multiple onChange={(e) => sendOther(e.target.files)} disabled={!!busy} />
        <strong>{busy || 'Add another guide (PDF or Word)'}</strong>
        <span>Any interview guide you own. Only upload material you're licensed to use.</span>
      </label>
      {problem && <p className="notice error">{problem}</p>}

      {shared.length > 0 && (
        <details className="shared-sources">
          <summary>Shared with the whole club ({shared.length} sources)</summary>
          <ul className="guide-list shared">
            {shared.map((s) => (
              <li key={s.source}>
                <span>
                  <strong>{s.source}</strong>
                  <small>{s.passages} passages</small>
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

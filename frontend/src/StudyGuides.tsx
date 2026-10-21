import { useState } from 'react'
import { API_URL, del } from './api'
import { Loading, useApi } from './ui'

type Source = { source: string; private: boolean; passages: number; questions: number }

/** Settings: the study guides behind practice answers. Each person uploads their own copies; they stay private. */
export default function StudyGuides() {
  const { data, error, reload } = useApi<Source[]>('/api/practice/library')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [problem, setProblem] = useState('')
  if (!data) return <Loading error={error} />
  const mine = data.filter((s) => s.private)
  const shared = data.filter((s) => !s.private)

  async function send(files: FileList | null) {
    if (!files?.length) return
    setProblem('')
    setMessage('')
    const done: string[] = []
    for (const file of Array.from(files)) {
      setBusy(`Reading ${file.name}…`)
      const form = new FormData()
      form.append('file', file)
      try {
        const res = await fetch(`${API_URL}/api/library/guides`, { method: 'POST', body: form, credentials: 'include' })
        const out = await res.json()
        if (!res.ok) throw new Error(out.detail || 'Upload failed')
        done.push(`${out.source}: ${out.questions} questions, ${out.passages} passages`)
      } catch (e) {
        setProblem(`${file.name}: ${(e as Error).message}`)
      }
    }
    setBusy('')
    if (done.length) setMessage(`Added ${done.join(' · ')}.`)
    reload()
  }

  async function remove(source: string) {
    await del(`/api/library/guides?source=${encodeURIComponent(source)}`)
    reload()
  }

  return (
    <section className="card study-guides">
      <h3>Study guides</h3>
      <p>
        Upload the interview guides you own (for example your Breaking Into Wall Street PDFs). Their numbered questions join your practice,
        graded against the guide's own answers, and explanations and follow-ups draw on them. They are private to your account; only
        upload material you are licensed to use.
      </p>
      <label className={`dropzone small ${busy ? 'busy' : ''}`}>
        <input type="file" accept=".pdf,.docx" multiple onChange={(e) => send(e.target.files)} disabled={!!busy} />
        <strong>{busy || 'Choose PDFs to upload'}</strong>
        <span>You can select several at once. Large guides take about 10 seconds each.</span>
      </label>
      {message && <p className="notice ok">{message}</p>}
      {problem && <p className="notice error">{problem}</p>}

      {mine.length > 0 && (
        <>
          <h4>Your guides</h4>
          <ul className="guide-list">
            {mine.map((s) => (
              <li key={s.source}>
                <span>
                  <strong>{s.source}</strong>
                  <small>
                    {s.questions ? `${s.questions} practice questions · ` : ''}
                    {s.passages} passages
                  </small>
                </span>
                <button className="link danger-link" onClick={() => remove(s.source)}>
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {shared.length > 0 && (
        <>
          <h4>Shared with the club</h4>
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
        </>
      )}
    </section>
  )
}

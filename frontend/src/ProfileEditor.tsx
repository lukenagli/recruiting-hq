import { useEffect, useState } from 'react'
import { post, upload } from './api'
import type { Profile } from './api'
import { Loading, useApi } from './ui'

/** Your resume and story: what the cover letter writer and practice grader know about you. */
export default function ProfileEditor() {
  const { data, error, reload } = useApi<Profile>('/api/profile')
  const [form, setForm] = useState<Profile | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => setForm(data), [data])
  if (!data || !form) return <Loading error={error} />

  const set = (field: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [field]: e.target.value })

  async function save() {
    setBusy(true)
    setMessage('')
    try {
      await post('/api/profile', { resume_text: form!.resume_text, story: form!.story })
      setMessage('Saved.')
      reload()
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function sendResume(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setMessage('')
    try {
      await upload('/api/profile/resume', file)
      setMessage('Resume read. Check the text below.')
      reload()
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card profile-editor">
      <h3>Resume and story</h3>
      <p className="muted">Cover letters and practice feedback use only what is here and in your tracker, so the more specific this is, the better they are.</p>
      <label className="field">
        Resume <small>(upload a .docx or .pdf, or paste the text)</small>
        <input type="file" accept=".docx,.pdf,.txt" onChange={(e) => sendResume(e.target.files?.[0])} disabled={busy} />
        <textarea rows={8} value={form.resume_text} onChange={set('resume_text')} />
      </label>
      <label className="field">
        Your story and rules <small>(target groups per bank, why banking, why the industry, stories to use, anything never to say)</small>
        <textarea rows={8} value={form.story} onChange={set('story')} />
      </label>
      {message && <p className="notice">{message}</p>}
      <button className="primary" disabled={busy} onClick={save}>
        {busy ? 'Saving…' : 'Save resume and story'}
      </button>
    </section>
  )
}

import { useEffect, useState } from 'react'
import { post, upload } from './api'
import type { Profile } from './api'
import { Loading, useApi } from './ui'

/** What the cover letter writer knows about you. */
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
      await post('/api/profile', form)
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
      <h3>Your profile for cover letters</h3>
      <p className="muted">Cover letters use only what is here and in your tracker, so the more specific this is, the better they are.</p>
      <label className="field">
        How you describe yourself <small>(finishes "My name is …, and I am …")</small>
        <input value={form.school_line} onChange={set('school_line')} placeholder="a first-year MBA candidate at the Yale School of Management" />
      </label>
      <label className="field">
        Letter footer <small>(address | phone | email)</small>
        <input value={form.contact_line} onChange={set('contact_line')} placeholder="123 Main Street, New Haven, CT | (555) 555-5555 | you@yale.edu" />
      </label>
      <label className="field">
        Resume <small>(upload a .docx or .pdf, or paste the text)</small>
        <input type="file" accept=".docx,.pdf,.txt" onChange={(e) => sendResume(e.target.files?.[0])} disabled={busy} />
        <textarea rows={8} value={form.resume_text} onChange={set('resume_text')} />
      </label>
      <label className="field">
        Your story and rules <small>(target groups per bank, why banking, why the industry, stories to use, anything never to say)</small>
        <textarea rows={8} value={form.story} onChange={set('story')} />
      </label>
      <label className="field">
        A cover letter you already like <small>(optional, used for voice only)</small>
        <textarea rows={6} value={form.example_letter} onChange={set('example_letter')} />
      </label>
      {message && <p className="notice">{message}</p>}
      <button className="primary" disabled={busy} onClick={save}>
        {busy ? 'Saving…' : 'Save profile'}
      </button>
    </section>
  )
}

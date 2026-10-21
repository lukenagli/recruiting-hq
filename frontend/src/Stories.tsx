import { useEffect, useState } from 'react'
import { post } from './api'
import type { Profile, SetupState } from './api'
import { Loading, useApi } from './ui'

type Story = { key: string; prompt: string; situation: string; task: string; action: string; result: string; reflection: string; updated_at: string }
const PARTS: [keyof Story, string, string][] = [
  ['situation', 'Situation', 'Where were you, what was going on? One or two sentences of context.'],
  ['task', 'Task', 'What were you responsible for, or what had to get done?'],
  ['action', 'Action', 'What did you do, specifically? Use "I", not "we".'],
  ['result', 'Result', 'What happened? Numbers if you have them.'],
  ['reflection', 'Reflection', 'What did you learn, and how does it make you a better banker?'],
]

function StoryCard({ story, onSaved }: { story: Story; onSaved: (s: Story) => void }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(story)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const filled = PARTS.filter(([k]) => (story[k] as string).trim()).length
  const changed = PARTS.some(([k]) => form[k] !== story[k])

  async function save() {
    setBusy(true)
    setError('')
    try {
      onSaved(await post<Story>(`/api/stars/${story.key}`, Object.fromEntries(PARTS.map(([k]) => [k, form[k]]))))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`story card ${open ? 'open' : ''}`}>
      <button className="story-head" onClick={() => setOpen(!open)}>
        <span>
          <strong>{story.prompt}</strong>
          <small>{filled === 0 ? 'Not started' : filled === PARTS.length ? 'Complete' : `${filled} of ${PARTS.length} parts`}</small>
        </span>
        <span className="story-pips" aria-hidden>
          {PARTS.map(([k]) => (
            <i key={k} className={(story[k] as string).trim() ? 'on' : ''} />
          ))}
        </span>
      </button>
      {open && (
        <div className="story-body">
          {PARTS.map(([k, label, hint]) => (
            <label key={k} className="field">
              {label}
              <small>{hint}</small>
              <textarea rows={k === 'action' ? 4 : 2} value={form[k] as string} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </label>
          ))}
          {error && <p className="notice error">{error}</p>}
          <button className="primary" disabled={busy || !changed} onClick={save}>
            {busy ? 'Saving…' : changed ? 'Save story' : 'Saved'}
          </button>
        </div>
      )}
    </div>
  )
}

const PITCH = [
  ['why_group', '', 'e.g. I spent four years investing in consumer-facing airlines and saw how…', 3],
  ['highlights', 'What do you want to highlight?', 'e.g. Deal experience at Indigo Partners, client-facing work with airline management teams…', 3],
  ['projects', 'Notable projects and experiences', 'e.g.\n• APiJET sale: built the buyer list, ran diligence calls, compared bids\n• Led a 5-person team on…', 6],
] as const
type PitchKey = (typeof PITCH)[number][0]

/** The big-picture answers: why this group, what to highlight, the projects to draw on. Cover letters use them too. */
function Pitch() {
  const prof = useApi<Profile>('/api/profile')
  const setup = useApi<SetupState>('/api/setup')
  const [form, setForm] = useState<Record<PitchKey, string>>({ why_group: '', highlights: '', projects: '' })
  const [saved, setSaved] = useState(form)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!prof.data) return
    const f = { why_group: prof.data.why_group ?? '', highlights: prof.data.highlights ?? '', projects: prof.data.projects ?? '' }
    setForm(f)
    setSaved(f)
  }, [prof.data])

  if (!prof.data || !setup.data) return <Loading error={prof.error || setup.error} />
  const group = setup.data.profile.target_groups.split(',')[0]?.trim()
  const changed = PITCH.some(([k]) => form[k] !== saved[k])

  async function save() {
    setBusy(true)
    setError('')
    try {
      await post('/api/profile', form)
      setSaved(form)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card pitch">
      <h3>Your pitch</h3>
      <p className="muted">
        The answers behind "Walk me through your resume", "Why {group || 'this group'}?" and "Tell me about your experience". Practice grades
        against these, and your cover letters are built from them.
      </p>
      {PITCH.map(([k, label, hint, rows]) => (
        <label key={k} className="field">
          {label || `Why are you interested in ${group || 'your target group'}?`}
          {k === 'projects' && <small>For work-experience and "tell me about a time" questions. Bullet points are fine.</small>}
          <textarea rows={rows} value={form[k]} placeholder={hint} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
        </label>
      ))}
      {!group && (
        <p className="fine">
          Pick your target groups in <a href="#/settings">Settings</a> so this asks about the right one.
        </p>
      )}
      {error && <p className="notice error">{error}</p>}
      <button className="primary" disabled={busy || !changed} onClick={save}>
        {busy ? 'Saving…' : changed ? 'Save' : 'Saved'}
      </button>
    </div>
  )
}

/** Interview Prep > Key information: your pitch, then how you'll answer the common "Tell me about a time..." questions. */
export default function Stories() {
  const { data, error } = useApi<Story[]>('/api/stars')
  const [saved, setSaved] = useState<Record<string, Story>>({})
  if (!data) return <Loading error={error} />
  const stories = data.map((s) => saved[s.key] ?? s)
  const done = stories.filter((s) => PARTS.every(([k]) => (s[k] as string).trim())).length

  return (
    <section className="stories">
      <Pitch />
      <h3 className="stories-title">STAR stories</h3>
      <p className="lede">
        Plan how you'll answer the common behavioral questions: Situation, Task, Action, Result, Reflection. Full sentences or bullet notes both
        work. When you practice behavioral questions, your answers are graded against these, and model answers are built from your own stories.
        <br />
        <strong>
          {done} of {stories.length} complete
        </strong>
      </p>
      {stories.map((s) => (
        <StoryCard key={s.key} story={s} onSaved={(n) => setSaved((cur) => ({ ...cur, [n.key]: n }))} />
      ))}
    </section>
  )
}

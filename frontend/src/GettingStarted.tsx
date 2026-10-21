import { useState } from 'react'
import type { Profile, SetupState } from './api'
import { TOUR_SEEN } from './Tour'
import { useApi } from './ui'

const HIDDEN = 'rhq-getting-started-hidden'

function stored(key: string) {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

/** Homepage checklist for new accounts. It disappears once everything on it is done (or the user hides it). */
export default function GettingStarted({ people }: { people: number }) {
  const setup = useApi<SetupState>('/api/setup')
  const prof = useApi<Profile>('/api/profile')
  const guides = useApi<{ private: boolean }[]>('/api/practice/library')
  const stars = useApi<Record<string, string>[]>('/api/stars')
  const [hidden, setHidden] = useState(() => stored(HIDDEN))
  if (hidden || !setup.data || !prof.data || !guides.data || !stars.data) return null

  const p = prof.data
  const items: [boolean, string, string, string][] = [
    [stored(TOUR_SEEN), 'Take the 2-minute tour', 'See what Recruiting HQ does', '#/tour'],
    [setup.data.done.ai, 'Add your AI key', 'Turns on the assistant, grading and writing', '#/settings'],
    [setup.data.done.resume, 'Upload your resume', 'Letters and practice are built from it', '#/settings'],
    [setup.data.done.banks, 'Pick your banks and groups', 'So your map and letters know where you’re going', '#/settings'],
    [guides.data.some((g) => g.private), 'Upload your study guides', 'Your Breaking Into Wall Street PDFs', '#/settings'],
    [
      !!(p.why_group || p.highlights || p.projects) && stars.data.some((s) => ['situation', 'task', 'action', 'result'].some((k) => s[k])),
      'Write your pitch and a STAR story',
      'Interview Prep → Key information',
      '#/prep?tab=stories',
    ],
    [people > 0, 'Log your first coffee chat', 'Type it in the box above', '#/'],
  ]
  const done = items.filter(([d]) => d).length
  if (done === items.length) return null

  function hide() {
    try {
      localStorage.setItem(HIDDEN, '1')
    } catch {
      /* hiding just won't stick */
    }
    setHidden(true)
  }

  return (
    <section className="card getting-started">
      <div className="getting-started-head">
        <h2>Getting started</h2>
        <span className="muted">
          {done} of {items.length} done
        </span>
        <span className="meter" aria-hidden>
          <i style={{ width: `${(done / items.length) * 100}%` }} />
        </span>
        <button className="link" onClick={hide}>
          Hide
        </button>
      </div>
      <ul className="getting-started-list">
        {items.map(([d, title, sub, href]) => (
          <li key={title} className={d ? 'done' : ''}>
            <a
              href={href}
              onClick={(e) => {
                if (href === '#/') {
                  e.preventDefault()
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                  document.querySelector<HTMLTextAreaElement>('.home-compose textarea')?.focus({ preventScroll: true })
                }
              }}
            >
              <b aria-hidden>{d ? '✓' : ''}</b>
              <span>
                <strong>{title}</strong>
                <small>{sub}</small>
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  )
}

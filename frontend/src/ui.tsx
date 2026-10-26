import { createContext, useContext, useEffect, useState } from 'react'
import { get } from './api'
import type { PersonStatus, School, Stage } from './api'

export function useApi<T>(path: string, params?: Record<string, string>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [rev, setRev] = useState(0)
  const key = path + JSON.stringify(params ?? {})
  useEffect(() => {
    let live = true
    if (rev === 0) setData(null) // a reload keeps showing the current data until the new data arrives
    setError('')
    get<T>(path, params)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(String(e.message ?? e)))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rev])
  return { data, error, reload: () => setRev((r) => r + 1) }
}

export function Loading({ error }: { error: string }) {
  if (error)
    return (
      <p className="notice error">
        Could not reach the app's server ({error}). Check that the backend is running on port 8000.
      </p>
    )
  return <p className="notice">Loading…</p>
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function parse(iso: string) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** "Oct 14" or, with weekday, "Wed, Oct 14". Non-ISO text is returned unchanged. */
export function fmtDate(iso: string, weekday = false) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const d = parse(iso)
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return weekday ? `${DAYS[d.getDay()]}, ${base}` : base
}

export function daysUntil(iso: string, today: string) {
  return Math.round((parse(iso).getTime() - parse(today).getTime()) / 86400000)
}

export function initials(name: string) {
  const parts = name.replace(/[^A-Za-z. ]/g, '').split(' ').filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function Logo({ bank, domain, size = 40 }: { bank: string; domain: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  if (!domain || failed)
    return (
      <span className="logo-fallback" style={{ width: size, height: size, fontSize: size * 0.36 }}>
        {initials(bank)}
      </span>
    )
  return (
    <img
      className="logo"
      width={size}
      height={size}
      alt=""
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=128`}
      onError={() => setFailed(true)}
    />
  )
}

export function StagePips({ stage, labels = false }: { stage: Stage[]; labels?: boolean }) {
  return (
    <span className={`pips ${labels ? 'with-labels' : ''}`}>
      {stage.map((s) => (
        <span key={s.label} className={`pip ${s.done ? 'done' : ''}`} title={s.label}>
          {labels && <em>{s.label}</em>}
        </span>
      ))}
    </span>
  )
}

const ROLES: [RegExp, string][] = [
  [/\b2y\b/i, '2Ys'],
  [/analyst/i, 'Analysts'],
  [/associate/i, 'Associates'],
  [/\bvp\b|vice president/i, 'VPs'],
  [/principal|principle|^director|executive director/i, 'Directors and Principals'],
  [/\bmd\b|managing director|partner|head/i, 'MDs'],
  [/recruit/i, 'Recruiters'],
]

/** Seniority bucket for a job title: its position in the ladder and a heading for it. */
export function roleOf(title: string) {
  const i = ROLES.findIndex(([pattern]) => pattern.test(title))
  return i === -1 ? { rank: ROLES.length, label: 'Role not recorded' } : { rank: i, label: ROLES[i][1] }
}

/** Who the signed-in user is (school and program), for wording across the app. */
/** True for an account trying out changes that haven't shipped to everyone yet. Gate every preview change on it. */
export const PreviewContext = createContext(false)
export const usePreview = () => useContext(PreviewContext)

export const SchoolContext = createContext<School>({
  school: '', school_full: '', short: '', level: 'mba', class_year: '', role: 'Summer Associate',
  peer: '2Y', peers: 'Students and classmates', alum: 'Alum', club: false,
})
export const useSchool = () => useContext(SchoolContext)

/** "Yale alum" / "Not a Yale alum" / "Yale 2Y" for a contact, in the user's own school's words. */
export function alumLabel(school: School, alum: string | undefined) {
  const short = school.short ? `${school.short} ` : ''
  const labels: Record<string, string> = {
    yes: school.alum,
    no: `Not a ${school.alum}`,
    student: school.peer === '2Y' ? `${short}2Y` : `${short}student`,
  }
  return labels[alum ?? ''] ?? ''
}

export const STATUS_LABEL: Record<PersonStatus | 'done' | 'upcoming' | 'todo', string> = {
  spoke: 'Spoke',
  scheduled: 'Scheduled',
  met: 'Met at event',
  known: 'Classmate',
  awaiting: 'Awaiting reply',
  no_reply: 'No reply',
  not_contacted: 'Not contacted yet',
  not_spoken: 'Not spoken with yet',
  done: 'Done',
  upcoming: 'Upcoming',
  todo: 'To do',
}

export function StatusTag({ status }: { status: keyof typeof STATUS_LABEL }) {
  return <span className={`tag s-${status}`}>{STATUS_LABEL[status]}</span>
}

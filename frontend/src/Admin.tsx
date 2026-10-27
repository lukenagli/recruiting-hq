import { useState } from 'react'
import { post } from './api'
import type { SetupState } from './api'
import { EmailTemplates } from './Templates'
import { Loading, Logo, fmtDate, useApi } from './ui'

/** The admin panel: who uses the site, and what the admin pushes to every account. */

type BankFields = { recruiter_name: string; recruiter_title: string; letter_name: string; address: string }
type DirectoryChat = { name: string; app: 'slack' | 'whatsapp'; groups: string[] }
type FeedItem = { id: number; source: string; posted_at: string; kind: string; bank: string; happens_on: string; title: string; detail: string }
type Overview = {
  users: { id: number; name: string; email: string; is_admin: number; created_at: string; own_key: number; banks: number; people: number
    interactions: number; last_active: string; last_sync?: string }[]
  bank_defaults: Record<string, BankFields>
  club_chats: string[]
  chat_directory: DirectoryChat[]
  slack_team: string
  feed: FeedItem[]
  groups: { industry_groups: string[]; product_groups: string[] }
  domains: Record<string, string>
}

const when = (iso: string) => (iso ? `${fmtDate(iso.slice(0, 10))}${iso.length > 10 ? ` ${iso.slice(11, 16)}` : ''}` : '–')

function Users({ users }: { users: Overview['users'] }) {
  return (
    <section className="card admin-card">
      <h2>People using the site <small>{users.length} signed up</small></h2>
      <div className="table-wrap">
        <table className="progress">
          <thead>
            <tr><th>Name</th><th>Email</th><th>Joined</th><th>Last active</th><th>Banks</th><th>Contacts</th><th>Chats logged</th><th>AI key</th><th>Reader</th></tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.name}</strong>{u.is_admin ? <small className="muted"> admin</small> : null}</td>
                <td>{u.email}</td>
                <td>{when(u.created_at.slice(0, 10))}</td>
                <td>{when(u.last_active)}</td>
                <td>{u.banks}</td>
                <td>{u.people}</td>
                <td>{u.interactions}</td>
                <td>{u.own_key ? 'Yes' : 'No'}</td>
                <td>{u.last_sync ? `Last ${when(u.last_sync)}` : 'Not set up'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function BankDetails({ initial, domains }: { initial: Record<string, BankFields>; domains: Record<string, string> }) {
  const [banks, setBanks] = useState(initial)
  const [filter, setFilter] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const changed = JSON.stringify(banks) !== JSON.stringify(initial)
  const set = (bank: string, field: keyof BankFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setBanks({ ...banks, [bank]: { ...banks[bank], [field]: e.target.value } })

  async function push() {
    setBusy(true)
    try {
      setBanks(await post<Record<string, BankFields>>('/api/admin/bank-defaults', { banks }))
      setMessage('Pushed. Every account uses these, except where a student typed their own for that bank.')
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card admin-card">
      <h2>Bank details for cover letters</h2>
      <p className="fine">
        Who each letter is addressed to, the firm's formal name and the office address. When you push, every account gets these as its
        default. A student who typed their own recruiter or address for a bank keeps theirs.
      </p>
      <input className="admin-filter" placeholder="Find a bank" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="admin-banks">
        {Object.keys(banks)
          .filter((b) => b.toLowerCase().includes(filter.toLowerCase()))
          .map((b) => (
            <div key={b} className="admin-bank">
              <strong><Logo bank={b} domain={domains[b] ?? ''} size={20} /> {b}</strong>
              <input placeholder="Recruiter name" value={banks[b].recruiter_name} onChange={set(b, 'recruiter_name')} />
              <input placeholder="Recruiter title" value={banks[b].recruiter_title} onChange={set(b, 'recruiter_title')} />
              <input placeholder={`Formal name (e.g. ${b}, LLC)`} value={banks[b].letter_name} onChange={set(b, 'letter_name')} />
              <textarea rows={2} placeholder="Office address" value={banks[b].address} onChange={set(b, 'address')} />
            </div>
          ))}
      </div>
      <button className="primary" disabled={busy || !changed} onClick={push}>{busy ? 'Pushing…' : 'Push to everyone'}</button>
      {message && <p className="notice">{message}</p>}
    </section>
  )
}

function Chats({ data }: { data: Overview }) {
  const [club, setClub] = useState(data.club_chats.join('\n'))
  const [team, setTeam] = useState(data.slack_team)
  const [directory, setDirectory] = useState<DirectoryChat[]>(data.chat_directory)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const groups = [...data.groups.industry_groups, ...data.groups.product_groups]
  const edit = (i: number, change: Partial<DirectoryChat>) => setDirectory(directory.map((c, j) => (i === j ? { ...c, ...change } : c)))

  async function push() {
    setBusy(true)
    try {
      const out = await post<{ club_chats: string[]; chat_directory: DirectoryChat[]; slack_team: string }>('/api/admin/chats', {
        club_chats: club.split('\n'), chat_directory: directory, slack_team: team.trim(),
      })
      setClub(out.club_chats.join('\n'))
      setDirectory(out.chat_directory)
      setTeam(out.slack_team)
      setMessage('Saved for everyone.')
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card admin-card">
      <h2>Chats</h2>
      <label className="field">
        Club chats, one per line <small>(only your reader reads these; what matters goes into everyone's club feed, and everyone else's reader skips them)</small>
        <textarea rows={3} value={club} onChange={(e) => setClub(e.target.value)} />
      </label>
      <label className="field">
        Club Slack workspace ID <small>(the T… part of app.slack.com/client/T…/; students' readers open this workspace)</small>
        <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="T0123ABCD" />
      </label>
      <h3>Group chats students can pick in setup</h3>
      <p className="fine">Setup shows each student the chats for the groups they recruit for. Their own reader reads the ones they pick.</p>
      {directory.map((c, i) => (
        <div key={i} className="admin-chat">
          <input value={c.name} placeholder="Chat or channel name, exactly as it appears" onChange={(e) => edit(i, { name: e.target.value })} />
          <select value={c.app} onChange={(e) => edit(i, { app: e.target.value as DirectoryChat['app'] })}>
            <option value="slack">Slack channel</option>
            <option value="whatsapp">WhatsApp group</option>
          </select>
          <div className="choice-row">
            {groups.map((g) => (
              <button key={g} type="button" className={`choice-pill ${c.groups.includes(g) ? 'on' : ''}`}
                onClick={() => edit(i, { groups: c.groups.includes(g) ? c.groups.filter((x) => x !== g) : [...c.groups, g] })}>
                {g}
              </button>
            ))}
          </div>
          <button className="link danger-link" onClick={() => setDirectory(directory.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <button className="ghost" onClick={() => setDirectory([...directory, { name: '', app: 'whatsapp', groups: [] }])}>+ Add a group chat</button>
      <div>
        <button className="primary" disabled={busy} onClick={push}>{busy ? 'Saving…' : 'Save for everyone'}</button>
      </div>
      {message && <p className="notice">{message}</p>}
    </section>
  )
}

function Feed({ items, onChanged }: { items: FeedItem[]; onChanged: () => void }) {
  return (
    <section className="card admin-card">
      <h2>Club feed <small>what everyone sees from the club chats</small></h2>
      {items.length === 0 && <p className="muted">Nothing yet. Press Refresh on your home page to read the club chats.</p>}
      <ul className="reading-list">
        {items.map((f) => (
          <li key={f.id}>
            <span className="reading-angle">{[f.kind, f.bank].filter(Boolean).join(' · ')}</span>
            <strong>{f.title}</strong>
            {f.detail && <p>{f.detail}</p>}
            <small className="muted">{f.source} · posted {when(f.posted_at)}</small>
            <button className="link danger-link" onClick={async () => { await post(`/api/admin/feed/${f.id}/hide`, {}); onChanged() }}>
              Remove from everyone's feed
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function Admin() {
  const { data, error, reload } = useApi<Overview>('/api/admin/overview')
  const setup = useApi<SetupState>('/api/setup')
  if (!data || !setup.data) return <Loading error={error || setup.error} />
  return (
    <div className="admin">
      <h1>Admin</h1>
      <p className="lede">Everything here goes to every account. Students' own edits always win over what you push.</p>
      <Users users={data.users} />
      <section className="card setup-card admin-card">
        <p className="fine">Email templates: edit and save them here, then click "Make these the standard for every account". Students who never changed a template get yours.</p>
        <EmailTemplates key={JSON.stringify(setup.data.email_templates)} state={setup.data} onChange={setup.reload} />
      </section>
      <BankDetails initial={data.bank_defaults} domains={data.domains} />
      <Chats data={data} />
      <Feed items={data.feed} onChanged={reload} />
    </div>
  )
}

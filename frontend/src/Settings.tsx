import { useState } from 'react'
import { post } from './api'
import type { AiSettings, SetupState, User } from './api'
import AboutYou from './AboutYou'
import ReaderSettings from './ReaderSettings'
import StudyGuides from './StudyGuides'
import { CoverTemplate, EmailTemplates } from './Templates'
import { PracticeHistory } from './Progress'
import { Loading, useApi } from './ui'

const PROVIDERS = [
  { id: 'portkey', label: 'Yale class key (Portkey)', where: '', hint: 'the long key from your AI class setup' },
  { id: 'anthropic', label: 'Claude (Anthropic)', where: 'https://console.anthropic.com/settings/keys', hint: 'Starts with sk-ant-' },
  { id: 'openai', label: 'OpenAI', where: 'https://platform.openai.com/api-keys', hint: 'Starts with sk-' },
]

type SyncState = { has_key: boolean }

/** The sections of Settings, each opened on its own page (#/settings/<id>). */
const SECTIONS = [
  { id: 'outlook', title: 'Outlook reader', note: 'Keeps your tracker up to date from your email and calendar.' },
  { id: 'ai', title: 'AI', note: 'The key that powers the assistant, practice feedback and writing.' },
  { id: 'about', title: 'About you', note: 'Your resume, the banks you are recruiting for and your groups.' },
  { id: 'templates', title: 'Writing templates', note: 'The cover letter and emails Recruiting HQ writes follow these exactly.' },
  { id: 'guides', title: 'Study guides', note: 'The Breaking Into Wall Street guides your practice questions come from.' },
  { id: 'history', title: 'Practice history', note: "Every question you've answered, and how you did." },
] as const

export default function Settings({ user, onSignOut, section = '' }: { user: User; onSignOut: () => void; section?: string }) {
  const { data, error, reload } = useApi<AiSettings>('/api/settings/ai')
  if (!data) return <Loading error={error} />
  const open = SECTIONS.find((s) => s.id === section)
  if (open) return <SettingsPage title={open.title}><Section id={open.id} ai={data} reloadAi={reload} /></SettingsPage>
  return <SettingsList user={user} onSignOut={onSignOut} ai={data} />
}

/** The list of sections, like a phone's Settings: tap one to open it. */
function SettingsList({ user, onSignOut, ai }: { user: User; onSignOut: () => void; ai: AiSettings }) {
  const sync = useApi<SyncState>('/api/sync/state')
  const aiOn = !!ai.provider || ai.using_site_key
  const status: Record<string, { on: boolean; text: string } | undefined> = {
    ai: { on: aiOn, text: aiOn ? 'On' : 'Off' },
    outlook: sync.data ? { on: sync.data.has_key, text: sync.data.has_key ? 'Connected' : 'Not connected' } : undefined,
  }
  return (
    <div className="settings simple-settings">
      <h1>Settings</h1>
      <p className="lede settings-who">
        {user.name} · {user.email}
        <span>
          <a href="#/tour">Replay the tour</a>
          <button className="link" onClick={onSignOut}>Sign out</button>
        </span>
      </p>
      <nav className="card settings-list">
        {SECTIONS.map((s) => (
          <a key={s.id} href={`#/settings/${s.id}`} className="settings-row">
            <span>
              <strong>{s.title}</strong>
              <small>{s.note}</small>
            </span>
            {status[s.id] && <em className={status[s.id]!.on ? 'on' : 'off'}>{status[s.id]!.text}</em>}
            <i aria-hidden>›</i>
          </a>
        ))}
      </nav>
    </div>
  )
}

function SettingsPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="settings simple-settings settings-page">
      <a href="#/settings" className="settings-back">‹ Settings</a>
      <h1>{title}</h1>
      {children}
    </div>
  )
}

function Section({ id, ai, reloadAi }: { id: string; ai: AiSettings; reloadAi: () => void }) {
  if (id === 'outlook') return <ReaderSettings />
  if (id === 'ai') return <AiCard ai={ai} reload={reloadAi} />
  if (id === 'about') return <AboutYou />
  if (id === 'templates') return <TemplatesCard />
  if (id === 'guides') return <StudyGuides />
  return <PracticeHistory />
}

/** "Yale class key (Portkey)" reads as "Yale class key"; "Claude (Anthropic)" as "Claude key". */
const keyName = (label: string) => (/key/i.test(label) ? label.replace(/ \(.*\)$/, '') : `${label.replace(/ \(.*\)$/, '')} key`)

/** The AI key as one line saying whether the AI is on; the form only when there's no key, or when asked for. */
function AiCard({ ai, reload }: { ai: AiSettings; reload: () => void }) {
  const [open, setOpen] = useState(!ai.provider && !ai.using_site_key)
  const [provider, setProvider] = useState(ai.provider || 'portkey')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const on = !!ai.provider || ai.using_site_key

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      await post('/api/settings/ai', { provider, key })
      setKey('')
      setOpen(false)
      reload()
    } catch (err) {
      setMessage((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h2>AI</h2>
      <p className={`status-line ${on ? 'on' : 'off'}`}>
        <b aria-hidden>{on ? '✓' : '!'}</b>
        {ai.provider ? `On, using your ${keyName(ai.provider_label)} ending in ${ai.hint}.` : ai.using_site_key ? "On, using the site's own key." : 'Off: add your key so Recruiting HQ can read your email and write for you.'}
        {on && !open && <button className="link" onClick={() => setOpen(true)}>Change</button>}
      </p>
      {open && (
        <form onSubmit={save} className="ai-form">
          <label className="field">
            {provider === 'portkey' ? 'Paste your Yale AI class key' : `Paste your ${PROVIDERS.find((p) => p.id === provider)!.label.split(' (')[0]} key`}
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          <details className="help">
            <summary>Where do I find it?</summary>
            <p>
              {provider === 'portkey'
                ? "It's the long key from your MGT 409 AI class. If you saved it in a file, it's the line that starts with PORTKEY_API_KEY=: copy what comes after the equals sign."
                : `Create one on ${PROVIDERS.find((p) => p.id === provider)!.where.replace('https://', '')} (API use is billed separately from a subscription).`}
            </p>
          </details>
          <details className="help">
            <summary>Use a different kind of key</summary>
            <div className="chips">
              {PROVIDERS.map((p) => (
                <button type="button" key={p.id} className={`chip ${provider === p.id ? 'on' : ''}`} onClick={() => setProvider(p.id)}>
                  {p.label}
                </button>
              ))}
            </div>
          </details>
          {message && <p className="notice error">{message}</p>}
          <div className="ai-form-actions">
            <button className="primary" disabled={busy || key.trim().length < 20}>{busy ? 'Checking…' : 'Save'}</button>
            {on && <button type="button" className="link muted" onClick={() => setOpen(false)}>Cancel</button>}
            {ai.provider && (
              <button type="button" className="link danger-link" onClick={async () => { await post('/api/settings/ai/remove', {}); reload() }}>
                Remove my key
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  )
}

/** Cover letter and email templates, the same editors as in setup. */
function TemplatesCard() {
  const { data, error, reload } = useApi<SetupState>('/api/setup')
  if (!data) return <Loading error={error} />
  return (
    <section className="card setup-card templates-card">
      <CoverTemplate state={data} onChange={reload} />
      <EmailTemplates key={JSON.stringify(data.email_templates)} state={data} onChange={reload} />
    </section>
  )
}

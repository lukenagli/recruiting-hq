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

export default function Settings({ user, onSignOut }: { user: User; onSignOut: () => void }) {
  const { data, error, reload } = useApi<AiSettings>('/api/settings/ai')
  if (!data) return <Loading error={error} />
  return <SimpleSettings user={user} onSignOut={onSignOut} ai={data} reloadAi={reload} />
}

/** Settings as a few plain sections. What you need most is at the top; what you rarely change is folded away. */
function SimpleSettings({ user, onSignOut, ai, reloadAi }: { user: User; onSignOut: () => void; ai: AiSettings; reloadAi: () => void }) {
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

      <ReaderSettings />

      <AiCard ai={ai} reload={reloadAi} />

      <AboutYou />

      <details className="card fold">
        <summary>
          <strong>Your writing templates</strong>
          <small>The cover letter and emails Recruiting HQ writes for you follow these exactly.</small>
        </summary>
        <TemplatesCard />
      </details>

      <details className="card fold">
        <summary>
          <strong>Study guides and practice history</strong>
          <small>The guides your practice questions come from, and how you've done.</small>
        </summary>
        <StudyGuides />
        <PracticeHistory />
      </details>
    </div>
  )
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

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

export default function Settings({ user, onSignOut }: { user: User; onSignOut?: () => void }) {
  const { data, error, reload } = useApi<AiSettings>('/api/settings/ai')
  const [provider, setProvider] = useState('portkey')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  if (!data) return <Loading error={error} />

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMessage('')
    try {
      await post('/api/settings/ai', { provider, key })
      setKey('')
      reload()
    } catch (err) {
      setMessage((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    await post('/api/settings/ai/remove', {})
    reload()
  }

  const chosen = PROVIDERS.find((p) => p.id === provider)!
  if (onSignOut) return <SimpleSettings user={user} onSignOut={onSignOut} ai={data} reloadAi={reload} />
  return (
    <div className="settings">
      <h1>Settings</h1>
      {onSignOut ? (
        <p className="lede settings-who">
          Signed in as {user.name} ({user.email}).
          <button className="btn" onClick={onSignOut}>Sign out</button>
        </p>
      ) : (
        <p className="lede">
          Signed in as {user.name} ({user.email}). <a href="#/tour">Replay the 2-minute tour</a>.
        </p>
      )}

      <section className="card">
        <h3>Your AI key</h3>
        <p>
          The assistant, chat recording, thank-you drafts and background lookups run on <strong>your own</strong> key (your Yale class
          Portkey key, or a Claude or OpenAI key), so the cost goes on your key, not anyone else's. The tracker, map and question bank work without a key.
        </p>
        {data.provider ? (
          <p className="notice">
            Using your {data.provider_label} key ending in <strong>{data.hint}</strong> (model {data.model}).{' '}
            <button className="link" onClick={remove}>Remove key</button>
          </p>
        ) : data.using_site_key ? (
          <p className="notice">This account uses the site's own key (model {data.model}). Add your own below to use that instead.</p>
        ) : (
          <p className="notice error">No key yet, so the AI features are off for your account.</p>
        )}

        <form onSubmit={save}>
          <div className="chips">
            {PROVIDERS.map((p) => (
              <button type="button" key={p.id} className={`chip ${provider === p.id ? 'on' : ''}`} onClick={() => setProvider(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
          <label className="field">
            {data.provider ? 'Replace with a new key' : 'API key'} <small>({chosen.hint})</small>
            <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
          </label>
          {chosen.id === 'portkey' ? (
            <p className="fine">
              Use the Portkey API key from your AI class (MGT 409): the long string you pasted when you set up your coding agent, often saved as{' '}
              <code>PORTKEY_API_KEY</code> in that project's <code>.env</code> file. The key is checked before saving, stored encrypted, and never
              shown again.
            </p>
          ) : (
            <p className="fine">
              Create one at{' '}
              <a href={chosen.where} target="_blank" rel="noreferrer">
                {chosen.where.replace('https://', '')}
              </a>
              . A Claude.ai or ChatGPT subscription does not include API access; the API is billed separately by usage. The key is checked
              before saving, stored encrypted, and never shown again.
            </p>
          )}
          {message && <p className="notice error">{message}</p>}
          <button className="primary" disabled={busy || key.trim().length < 20}>
            {busy ? 'Checking the key…' : 'Save key'}
          </button>
        </form>
      </section>

      {onSignOut && <ReaderSettings />}

      <AboutYou />

      <StudyGuides />

      <TemplatesCard />

      <PracticeHistory />
    </div>
  )
}

/** Preview: Settings as a few plain sections. What you need most is at the top; what you rarely change is folded away. */
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

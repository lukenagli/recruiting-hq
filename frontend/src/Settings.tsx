import { useState } from 'react'
import { post } from './api'
import type { AiSettings, SetupState, User } from './api'
import AboutYou from './AboutYou'
import StudyGuides from './StudyGuides'
import { CoverTemplate, EmailTemplates } from './Templates'
import { PracticeHistory } from './Progress'
import { Loading, useApi } from './ui'

const PROVIDERS = [
  { id: 'anthropic', label: 'Claude (Anthropic)', where: 'https://console.anthropic.com/settings/keys', hint: 'Starts with sk-ant-' },
  { id: 'openai', label: 'OpenAI', where: 'https://platform.openai.com/api-keys', hint: 'Starts with sk-' },
]

export default function Settings({ user }: { user: User }) {
  const { data, error, reload } = useApi<AiSettings>('/api/settings/ai')
  const [provider, setProvider] = useState('anthropic')
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
  return (
    <div className="settings">
      <h1>Settings</h1>
      <p className="lede">Signed in as {user.name} ({user.email}).</p>

      <section className="card">
        <h3>Your AI key</h3>
        <p>
          The assistant, chat recording, thank-you drafts and background lookups run on <strong>your own</strong> Claude or OpenAI
          account, so the cost goes on your key, not anyone else's. The tracker, map and question bank work without a key.
        </p>
        {data.provider ? (
          <p className="notice">
            Using your {data.provider_label} key ending in <strong>{data.hint}</strong> (model {data.model}).{' '}
            <button className="link" onClick={remove}>Remove key</button>
          </p>
        ) : data.using_site_key ? (
          <p className="notice">As the site's admin you are using the site's own key (model {data.model}). Add your own below to use that instead.</p>
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
          <p className="fine">
            Create one at{' '}
            <a href={chosen.where} target="_blank" rel="noreferrer">
              {chosen.where.replace('https://', '')}
            </a>
            . A Claude.ai or ChatGPT subscription does not include API access; the API is billed separately by usage. The key is checked
            before saving, stored encrypted, and never shown again.
          </p>
          {message && <p className="notice error">{message}</p>}
          <button className="primary" disabled={busy || key.trim().length < 20}>
            {busy ? 'Checking the key…' : 'Save key'}
          </button>
        </form>
      </section>

      <AboutYou />

      <StudyGuides />

      <TemplatesCard />

      <PracticeHistory />
    </div>
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

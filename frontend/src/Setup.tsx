import { useEffect, useState } from 'react'
import { post, upload } from './api'
import { CoverTemplate, EmailTemplates } from './Templates'
import type { SetupState } from './api'
import { Loading, Logo, useApi } from './ui'

/**
 * First-run setup, one short step at a time: AI key, resume, banks and groups, writing templates.
 * Every step saves as soon as you continue, every step can be skipped, and the whole thing can be reopened
 * from Settings. Everyone is a Yale SOM MBA student for now.
 */

const STEPS = ['AI key', 'Resume', 'Banks', 'Templates', 'Done']

const PROVIDERS = [
  {
    id: 'anthropic',
    label: 'Claude',
    company: 'Anthropic',
    url: 'https://console.anthropic.com/settings/keys',
    billing: 'https://console.anthropic.com/settings/billing',
    hint: 'starts with sk-ant-',
  },
  {
    id: 'openai',
    label: 'ChatGPT',
    company: 'OpenAI',
    url: 'https://platform.openai.com/api-keys',
    billing: 'https://platform.openai.com/settings/organization/billing',
    hint: 'starts with sk-',
  },
]

function Nav({ step, onBack, children }: { step: number; onBack?: () => void; children: React.ReactNode }) {
  return (
    <div className="setup-nav">
      {onBack && step > 0 ? (
        <button type="button" className="ghost" onClick={onBack}>
          Back
        </button>
      ) : (
        <span />
      )}
      <div className="setup-nav-right">{children}</div>
    </div>
  )
}

function KeyStep({ s, next, back }: { s: SetupState; next: () => void; back: () => void }) {
  const [provider, setProvider] = useState(s.ai.provider || 'anthropic')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const p = PROVIDERS.find((x) => x.id === provider)!

  async function save() {
    setBusy(true)
    setError('')
    try {
      await post('/api/settings/ai', { provider, key })
      next()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2>Connect your AI</h2>
      <p className="setup-why">
        Grading your practice answers, writing cover letters and thank-you emails, and reading deal documents all run on your own AI account.
        It stays private to you, and you only pay for what you use (for most people a few dollars a month).
      </p>
      {s.ai.ready && (
        <p className="notice ok">
          ✓ {s.ai.using_site_key ? "You're using the site's own key." : `Connected: your ${s.ai.provider_label} key ending in ${s.ai.hint}.`} You can
          continue, or replace it below.
        </p>
      )}
      <div className="choice-row">
        {PROVIDERS.map((x) => (
          <button key={x.id} type="button" className={`choice-pill ${provider === x.id ? 'on' : ''}`} onClick={() => setProvider(x.id)}>
            {x.label} <small>by {x.company}</small>
          </button>
        ))}
      </div>
      <ol className="setup-steps">
        <li>
          Open{' '}
          <a href={p.url} target="_blank" rel="noreferrer">
            {p.company}'s API keys page
          </a>{' '}
          and sign in (the same login as {p.label} works, or create a free account).
        </li>
        <li>
          Add a few dollars of credit on the{' '}
          <a href={p.billing} target="_blank" rel="noreferrer">
            billing page
          </a>
          . API use is billed separately from a {p.label} subscription.
        </li>
        <li>Click "Create key", give it any name, and copy it.</li>
        <li>Paste it below. We check that it works before saving, store it encrypted, and never show it again.</li>
      </ol>
      <label className="field">
        Your {p.company} API key <small>({p.hint})</small>
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
      </label>
      <p className="fine">
        Why not just sign in with your {p.label} account? {p.company} does not let other websites use a {p.label} subscription; an API key is the only
        way they allow.
      </p>
      {error && <p className="notice error">{error}</p>}
      <Nav step={0} onBack={back}>
        <button className="ghost" onClick={next}>
          {s.ai.ready ? 'Continue' : 'Skip for now'}
        </button>
        <button className="primary" disabled={busy || key.trim().length < 20} onClick={save}>
          {busy ? 'Checking the key…' : 'Save key'}
        </button>
      </Nav>
    </>
  )
}

function ResumeStep({ s, next, back, reload }: { s: SetupState; next: () => void; back: () => void; reload: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(s.profile.has_resume)

  async function send(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      await upload('/api/profile/resume', file)
      setDone(true)
      reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2>Upload your resume</h2>
      <p className="setup-why">Your cover letters and practice feedback are built from your real experience. Nothing is ever made up.</p>
      <label className={`dropzone ${done ? 'done' : ''}`}>
        <input type="file" accept=".pdf,.docx,.txt" onChange={(e) => send(e.target.files?.[0])} disabled={busy} />
        <strong>{busy ? 'Reading your resume…' : done ? '✓ Resume uploaded' : 'Choose your resume'}</strong>
        <span>{done ? 'Choose another file to replace it.' : 'Word (.docx) or PDF'}</span>
      </label>
      {error && <p className="notice error">{error}</p>}
      <Nav step={1} onBack={back}>
        <button className={done ? 'primary' : 'ghost'} onClick={next}>
          {done ? 'Continue' : 'Skip for now'}
        </button>
      </Nav>
    </>
  )
}

function BanksStep({ s, next, back }: { s: SetupState; next: () => void; back: () => void }) {
  const [banks, setBanks] = useState<string[]>(s.banks)
  const [extra, setExtra] = useState('')
  const [groups, setGroups] = useState<string[]>(s.profile.target_groups ? s.profile.target_groups.split(',').map((g) => g.trim()).filter(Boolean) : [])
  const [story, setStory] = useState(s.profile.story)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toggle = (list: string[], x: string) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x])
  const custom = banks.filter((b) => !s.bank_choices.some((c) => c.bank === b))

  async function save() {
    setBusy(true)
    setError('')
    try {
      await post('/api/setup/banks', { banks, groups, story })
      next()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function addExtra() {
    const name = extra.trim()
    if (name) setBanks((cur) => (cur.some((b) => b.toLowerCase() === name.toLowerCase()) ? cur : [...cur, name]))
    setExtra('')
  }

  return (
    <>
      <h2>Which banks are you recruiting with?</h2>
      <p className="setup-why">Tap every bank you are targeting. You can add or remove banks any time.</p>
      <div className="bank-grid">
        {s.bank_choices.map((b) => (
          <button key={b.bank} type="button" className={`bank-tile ${banks.includes(b.bank) ? 'on' : ''}`} onClick={() => setBanks((cur) => toggle(cur, b.bank))}>
            <Logo bank={b.bank} domain={b.domain} size={28} />
            <span>{b.bank}</span>
            {banks.includes(b.bank) && <i aria-hidden>✓</i>}
          </button>
        ))}
        {custom.map((b) => (
          <button key={b} type="button" className="bank-tile on" onClick={() => setBanks((cur) => toggle(cur, b))}>
            <Logo bank={b} domain="" size={28} />
            <span>{b}</span>
            <i aria-hidden>✓</i>
          </button>
        ))}
      </div>
      <div className="add-bank">
        <input
          value={extra}
          onChange={(e) => setExtra(e.target.value)}
          placeholder="Another bank, e.g. William Blair"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addExtra()
            }
          }}
        />
        <button type="button" className="ghost" onClick={addExtra} disabled={!extra.trim()}>
          Add
        </button>
      </div>

      <h3 className="setup-sub">Which groups interest you?</h3>
      <p className="setup-why">Pick in order of preference; your first pick is what your cover letters focus on. Not sure yet? Skip this.</p>
      {[
        ['Industry groups', s.options.industry_groups],
        ['Product groups', s.options.product_groups],
      ].map(([label, list]) => (
        <div key={label as string} className="group-block">
          <small>{label as string}</small>
          <div className="choice-row">
            {(list as string[]).map((g) => (
              <button key={g} type="button" className={`choice-pill ${groups.includes(g) ? 'on' : ''}`} onClick={() => setGroups((cur) => toggle(cur, g))}>
                {groups.includes(g) && <b className="rank">{groups.indexOf(g) + 1}</b>}
                {g}
              </button>
            ))}
          </div>
        </div>
      ))}
      <label className="field">
        Anything you want your letters to get right? <small>(optional)</small>
        <textarea
          rows={3}
          value={story}
          onChange={(e) => setStory(e.target.value)}
          placeholder="Why banking, why these groups, a story you always tell, or words you never use…"
        />
      </label>
      {error && <p className="notice error">{error}</p>}
      <Nav step={2} onBack={back}>
        <button className="primary" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : banks.length ? `Continue with ${banks.length} ${banks.length === 1 ? 'bank' : 'banks'}` : 'Skip for now'}
        </button>
      </Nav>
    </>
  )
}

function TemplatesStep({ s, next, back, reload }: { s: SetupState; next: () => void; back: () => void; reload: () => void }) {
  return (
    <>
      <h2>Your templates</h2>
      <p className="setup-why">Your cover letters and emails follow these exactly. The Finance Club versions are already filled in; change anything you write differently.</p>
      <CoverTemplate state={s} onChange={reload} />
      <EmailTemplates state={s} onChange={reload} />
      <Nav step={3} onBack={back}>
        <button className="primary" onClick={next}>
          Continue
        </button>
      </Nav>
    </>
  )
}

function DoneStep({ s, back, finish }: { s: SetupState; back: () => void; finish: () => void }) {
  const items: [keyof SetupState['done'], string, string][] = [
    ['ai', 'AI connected', s.ai.ready ? (s.ai.provider_label || 'Site key') : 'Grading, letters and emails stay off until you add a key in Settings'],
    ['resume', 'Resume', s.profile.has_resume ? 'Uploaded' : 'Add it in Settings before writing cover letters'],
    ['banks', 'Banks', s.banks.length ? s.banks.join(', ') : 'Add banks any time from the Recruiting Map'],
    ['templates', 'Cover letter template', s.cover_template.has_template ? s.cover_template.filename : 'Using the Yale SOM template'],
  ]
  return (
    <>
      <h2>You're all set</h2>
      <ul className="setup-summary">
        {items.map(([k, label, detail]) => (
          <li key={k} className={s.done[k] ? 'ok' : ''}>
            <b aria-hidden>{s.done[k] ? '✓' : '–'}</b>
            <span>
              <strong>{label}</strong>
              <small>{detail}</small>
            </span>
          </li>
        ))}
      </ul>
      <p className="setup-why">
        From here, tell the Assistant (bottom right) about every coffee chat or event, in plain words or by voice. It keeps your map, thank-you emails
        and cover letters up to date.
      </p>
      <Nav step={4} onBack={back}>
        <button className="primary big" onClick={finish}>
          Go to my dashboard
        </button>
      </Nav>
    </>
  )
}

export default function Setup({ onDone }: { onDone: () => void }) {
  const { data, error, reload } = useApi<SetupState>('/api/setup')
  const [step, setStep] = useState(-1)
  const [version, setVersion] = useState(0)
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [step])
  useEffect(() => {
    setVersion((v) => v + 1) // re-open the step with fresh saved values
  }, [data])
  if (!data) return <Loading error={error} />
  if (step === -1) {
    // open at the first step not done yet, so someone who stopped halfway picks up where they left off
    if (window.location.hash.includes('step=banks')) {
      setStep(2)
      return <Loading error="" />
    }
    const order: (keyof SetupState['done'])[] = ['ai', 'resume', 'banks']
    const first = order.findIndex((k) => !data.done[k])
    setStep(first === -1 ? 0 : first)
    return <Loading error="" />
  }
  const go = (n: number) => {
    reload()
    setStep(n)
  }
  const next = () => go(step + 1)
  const back = () => go(step - 1)

  async function finish() {
    await post('/api/setup/finish', {})
    onDone()
  }

  return (
    <div className="setup">
      <div className="setup-progress" aria-label={`Step ${step + 1} of ${STEPS.length}`}>
        {STEPS.map((label, i) => (
          <button key={label} className={i === step ? 'on' : i < step ? 'past' : ''} onClick={() => go(i)}>
            <i />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="card setup-card" key={`${step}-${version}`}>
        {step === 0 && <KeyStep s={data} next={next} back={back} />}
        {step === 1 && <ResumeStep s={data} next={next} back={back} reload={reload} />}
        {step === 2 && <BanksStep s={data} next={next} back={back} />}
        {step === 3 && <TemplatesStep s={data} next={next} back={back} reload={reload} />}
        {step === 4 && <DoneStep s={data} back={back} finish={finish} />}
      </div>
    </div>
  )
}

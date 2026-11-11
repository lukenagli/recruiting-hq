import { useEffect, useState } from 'react'
import { post, upload } from './api'
import ReaderSettings from './ReaderSettings'
import type { SetupState } from './api'
import { Loading, Logo, useApi } from './ui'

/**
 * First-run setup, one short step at a time: AI key, resume, banks and groups, writing templates.
 * Every step saves as soon as you continue, every step can be skipped, and the whole thing can be reopened
 * from Settings. Everyone is a Yale SOM MBA student for now.
 */

// One question per screen, in plain words; templates are already filled in (change them in Settings)
const STEPS = ['AI', 'Resume', 'Banks', 'Groups', 'Outlook', 'Done']

const PROVIDERS = [
  {
    id: 'portkey',
    label: 'Yale class key',
    company: 'Portkey',
    url: '',
    billing: '',
    hint: 'the long key from your AI class setup',
  },
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

/** Turning the AI on, without the jargon. The Yale class key is the default; anything technical is folded away. */
function AiStep({ s, next, back }: { s: SetupState; next: () => void; back: () => void }) {
  const [provider, setProvider] = useState(s.ai.provider || 'portkey')
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
      <h2>Turn on the AI</h2>
      <p className="setup-why">
        Recruiting HQ uses AI to read your emails, log your coffee chats and write your thank-you notes. It runs on your own key, so only
        you can use it and the cost goes on your account.
      </p>
      {s.ai.ready ? (
        <p className="notice ok">
          ✓ The AI is on{s.ai.using_site_key ? '.' : ` (your ${/key/i.test(s.ai.provider_label) ? s.ai.provider_label.replace(/ \(.*\)$/, '') : `${s.ai.provider_label} key`} ending in ${s.ai.hint}).`}
        </p>
      ) : null}
      <label className="field big-field">
        {provider === 'portkey' ? 'Paste your Yale AI class key' : `Paste your ${p.label} key`}
        <input type="password" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false}
          placeholder={s.ai.ready ? 'Paste a new key to replace it' : ''} />
      </label>
      <details className="help">
        <summary>Where do I find it?</summary>
        {provider === 'portkey' ? (
          <p>
            It's the long key from your MGT 409 AI class, the one you pasted when you set up your coding agent. If you saved it in a file, it's
            the line that starts with <code>PORTKEY_API_KEY=</code>: copy what comes after the equals sign.
          </p>
        ) : (
          <p>
            Sign in at{' '}
            <a href={p.url} target="_blank" rel="noreferrer">{p.company}'s keys page</a>, add a few dollars of credit on the{' '}
            <a href={p.billing} target="_blank" rel="noreferrer">billing page</a> (it's separate from a {p.label} subscription), click Create
            key and copy it.
          </p>
        )}
      </details>
      <details className="help">
        <summary>{provider === 'portkey' ? 'Use a Claude or ChatGPT key instead' : 'Use a different kind of key'}</summary>
        <div className="choice-row">
          {PROVIDERS.map((x) => (
            <button key={x.id} type="button" className={`choice-pill ${provider === x.id ? 'on' : ''}`} onClick={() => setProvider(x.id)}>
              {x.id === 'portkey' ? 'Yale class key' : x.label}
            </button>
          ))}
        </div>
      </details>
      <p className="fine">We check the key works before saving it. It's stored encrypted and never shown again.</p>
      {error && <p className="notice error">{error}</p>}
      <Nav step={0} onBack={back}>
        {key.trim().length >= 20 ? (
          <button className="primary" disabled={busy} onClick={save}>{busy ? 'Checking…' : 'Continue'}</button>
        ) : s.ai.ready ? (
          <button className="primary" onClick={next}>Continue</button>
        ) : (
          <button className="link muted" onClick={next}>Skip for now</button>
        )}
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

function BanksStep({ s, next, back, part }: { s: SetupState; next: () => void; back: () => void; part: 'banks' | 'groups' }) {
  const [banks, setBanks] = useState<string[]>(s.banks)
  const [extra, setExtra] = useState('')
  const [groups, setGroups] = useState<string[]>(s.profile.target_groups ? s.profile.target_groups.split(',').map((g) => g.trim()).filter(Boolean) : [])
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const toggle = (list: string[], x: string) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x])
  const custom = banks.filter((b) => !s.bank_choices.some((c) => c.bank === b))

  async function save() {
    setBusy(true)
    setError('')
    try {
      await post('/api/setup/banks', { banks, groups })
      if (why.trim()) await post('/api/profile', { why_group: why })
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

  const showBanks = part !== 'groups'
  const showGroups = part !== 'banks'
  return (
    <>
      {showBanks && (<>
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
      </>)}
      {showGroups && (<>
      {part === 'groups' ? <h2>Which groups interest you most?</h2> : <h3 className="setup-sub">Which groups interest you?</h3>}
      <p className="setup-why">Tap them in order of preference: your first pick is what your cover letters focus on. Not sure yet? Skip this.</p>
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
      {(part !== 'groups' || groups.length > 0) && <label className="field">
        Why are you interested in {groups[0] ?? 'that group'}? <small>(optional, you can add more in Interview Prep → Key information)</small>
        <textarea rows={3} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="A sentence or two your cover letters can build on…" />
      </label>}
      </>)}
      {error && <p className="notice error">{error}</p>}
      <Nav step={2} onBack={back}>
        {part === 'groups' && !groups.length ? (
          <button className="link muted" onClick={next}>Skip for now</button>
        ) : (
          <button className="primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : part === 'groups' ? 'Continue' : banks.length ? `Continue with ${banks.length} ${banks.length === 1 ? 'bank' : 'banks'}` : 'Skip for now'}
          </button>
        )}
      </Nav>
    </>
  )
}

function ReaderStep({ next, back }: { next: () => void; back: () => void }) {
  const { data, reload } = useApi<{ has_key: boolean }>('/api/sync/state')
  return (
    <>
      <h2>Connect your Outlook</h2>
      <p className="setup-why">
        This keeps your tracker up to date by itself: press Refresh and every coffee chat, event and thank-you in your Outlook gets logged.
        Do this on your laptop, in Chrome.
      </p>
      <ReaderSettings bare onChange={reload} />
      <Nav step={4} onBack={back}>
        {data?.has_key ? (
          <button className="primary" onClick={next}>Continue</button>
        ) : (
          <button className="link muted" onClick={next}>Skip for now</button>
        )}
      </Nav>
    </>
  )
}

function DoneStep({ s, back, finish }: { s: SetupState; back: () => void; finish: () => void }) {
  const reader = useApi<{ has_key: boolean }>('/api/sync/state')
  const items: [keyof SetupState['done'], string, string][] = [
    ['ai', 'AI', s.ai.ready ? 'On' : 'Off for now: add your key in Settings to turn it on'],
    ['resume', 'Resume', s.profile.has_resume ? 'Uploaded' : 'Not yet: add it in Settings before writing cover letters'],
    ['banks', 'Banks', s.banks.length ? s.banks.join(', ') : 'None yet: add them any time from the Recruiting Map'],
  ]
  const readerOn = !!reader.data?.has_key
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
        <li className={readerOn ? 'ok' : ''}>
          <b aria-hidden>{readerOn ? '✓' : '–'}</b>
          <span>
            <strong>Outlook</strong>
            <small>{readerOn ? 'Connected' : 'Not yet: connect it any time in Settings, on your laptop in Chrome'}</small>
          </span>
        </li>
      </ul>
      <p className="setup-why">
        {readerOn
          ? 'Next, press Refresh on your homepage. The first one reads your email and calendar back to September 1, so it takes a while. After that, a refresh takes a minute or two. '
          : ''}
        Anything that isn't in your email, just type into the box at the top of your homepage, in plain words.
      </p>
      <Nav step={4} onBack={back}>
        <button className="primary big" onClick={finish}>
          Go to my homepage
        </button>
      </Nav>
    </>
  )
}

export default function Setup({ onDone }: { onDone: () => void }) {
  const steps = STEPS
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
    let saved = -1
    try {
      saved = Number(sessionStorage.getItem('rhq-setup-step') ?? -1)
    } catch {
      saved = -1
    }
    if (saved >= 0 && saved < steps.length) {
      setStep(saved)
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
    try {
      sessionStorage.setItem('rhq-setup-step', String(n))
    } catch {
      // private window: a reload starts at the first unfinished step instead
    }
  }
  const next = () => go(step + 1)
  const back = () => go(step - 1)

  async function finish() {
    try {
      sessionStorage.removeItem('rhq-setup-step')
    } catch {
      // nothing saved
    }
    await post('/api/setup/finish', {})
    onDone()
  }

  return (
    <div className="setup">
      <div className="setup-progress" aria-label={`Step ${step + 1} of ${steps.length}`}>
        {steps.map((label, i) => (
          <button key={label} className={i === step ? 'on' : i < step ? 'past' : ''} onClick={() => go(i)}>
            <i />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="card setup-card" key={`${step}-${version}`}>
        {step === 0 && <AiStep s={data} next={next} back={back} />}
        {step === 1 && <ResumeStep s={data} next={next} back={back} reload={reload} />}
        {step === 2 && <BanksStep s={data} next={next} back={back} part="banks" />}
        {step === 3 && <BanksStep s={data} next={next} back={back} part="groups" />}
        {step === 4 && <ReaderStep next={next} back={back} />}
        {step === steps.length - 1 && <DoneStep s={data} back={back} finish={finish} />}
      </div>
    </div>
  )
}

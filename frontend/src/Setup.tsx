import { useEffect, useState } from 'react'
import { post, upload } from './api'
import type { SetupState } from './api'
import { Loading, Logo, useApi } from './ui'

/**
 * First-run setup, one short step at a time: school, AI key, resume, banks and groups, writing templates.
 * Every step saves as soon as you continue, everything but the school can be skipped, and the whole thing
 * can be reopened from Settings.
 */

const STEPS = ['School', 'AI key', 'Resume', 'Banks', 'Templates', 'Done']

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

function SchoolStep({ s, next }: { s: SetupState; next: () => void }) {
  const known = s.options.schools
  const [choice, setChoice] = useState(s.profile.school && !known.includes(s.profile.school) ? 'Other' : s.profile.school || '')
  const [other, setOther] = useState(known.includes(s.profile.school) ? '' : s.profile.school)
  const [level, setLevel] = useState(s.profile.level || (choice === 'University of Arizona' ? 'undergrad' : 'mba'))
  const [year, setYear] = useState(s.profile.class_year)
  const [line, setLine] = useState(s.profile.school_line)
  const [contact, setContact] = useState(s.profile.contact_line)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const school = choice === 'Other' ? other.trim() : choice

  async function save() {
    setBusy(true)
    setError('')
    try {
      await post('/api/setup/school', { school, level, class_year: year, school_line: line, contact_line: contact })
      next()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2>Where are you recruiting from?</h2>
      <p className="setup-why">This sets the wording in your cover letters (Summer Associate or Summer Analyst) and which school resources you see.</p>
      <div className="choice-row">
        {[...known, 'Other'].map((k) => (
          <button
            key={k}
            type="button"
            className={`choice-pill ${choice === k ? 'on' : ''}`}
            onClick={() => {
              setChoice(k)
              if (k === 'University of Arizona') setLevel('undergrad')
              if (k === 'Yale SOM') setLevel('mba')
            }}
          >
            {k === 'Other' ? 'Another school' : k}
          </button>
        ))}
      </div>
      {choice === 'Yale SOM' && (
        <p className="fine">The Finance Club's question banks, deadlines and calendar are included for accounts signed up with a @yale.edu email.</p>
      )}
      {choice === 'Other' && (
        <label className="field">
          School name
          <input value={other} onChange={(e) => setOther(e.target.value)} placeholder="e.g. University of Michigan Ross" autoFocus />
        </label>
      )}
      {choice && (
        <>
          <div className="field-row">
            <label className="field">
              Program
              <select value={level} onChange={(e) => setLevel(e.target.value)}>
                <option value="mba">MBA (Summer Associate)</option>
                <option value="undergrad">Undergraduate (Summer Analyst)</option>
              </select>
            </label>
            <label className="field">
              Class of <small>(optional)</small>
              <input value={year} onChange={(e) => setYear(e.target.value)} placeholder="e.g. 2028" inputMode="numeric" />
            </label>
          </div>
          <label className="field">
            How you describe yourself in a cover letter <small>(optional, you can change it later)</small>
            <input
              value={line}
              onChange={(e) => setLine(e.target.value)}
              placeholder={level === 'mba' ? `a first-year MBA candidate at ${school || 'your school'}` : `a junior at ${school || 'your school'} studying Finance`}
            />
          </label>
          <label className="field">
            Contact line for the bottom of your letters <small>(optional)</small>
            <input value={contact} onChange={(e) => setContact(e.target.value)} placeholder="City, State | (555) 555-5555 | you@school.edu" />
          </label>
        </>
      )}
      {error && <p className="notice error">{error}</p>}
      <Nav step={0}>
        <button className="primary" disabled={!school || busy} onClick={save}>
          {busy ? 'Saving…' : 'Continue'}
        </button>
      </Nav>
    </>
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
      <Nav step={1} onBack={back}>
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
      <Nav step={2} onBack={back}>
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
      <Nav step={3} onBack={back}>
        <button className="primary" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : banks.length ? `Continue with ${banks.length} ${banks.length === 1 ? 'bank' : 'banks'}` : 'Skip for now'}
        </button>
      </Nav>
    </>
  )
}

function TemplatesStep({ s, next, back }: { s: SetupState; next: () => void; back: () => void }) {
  const [letter, setLetter] = useState<string | null>(null)
  const [hasLetter, setHasLetter] = useState(s.profile.has_cover_template)
  const [email, setEmail] = useState(s.profile.email_template)
  const [rules, setRules] = useState(s.profile.email_rules)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function readLetter(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const out = await upload<{ text: string }>('/api/setup/template-upload', file)
      setLetter(out.text)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    setBusy(true)
    setError('')
    try {
      await post('/api/setup/templates', { ...(letter !== null ? { cover_letter: letter } : {}), email_template: email, email_rules: rules })
      if (letter !== null) setHasLetter(!!letter.trim())
      next()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <h2>Your writing templates</h2>
      <p className="setup-why">Your cover letters and thank-you emails will follow these exactly. Skip either one to use the standard format.</p>

      <section className="template-block">
        <h3>Cover letter</h3>
        <p className="fine">
          Upload a cover letter you have written or your school's sample. New letters copy its structure, length and voice, written fresh for each bank.
        </p>
        {letter === null ? (
          <label className={`dropzone small ${hasLetter ? 'done' : ''}`}>
            <input type="file" accept=".pdf,.docx,.txt" onChange={(e) => readLetter(e.target.files?.[0])} disabled={busy} />
            <strong>{busy ? 'Reading…' : hasLetter ? '✓ Template saved' : 'Choose a cover letter'}</strong>
            <span>{hasLetter ? 'Choose another file to replace it.' : 'Word (.docx) or PDF'}</span>
          </label>
        ) : (
          <label className="field">
            Check the text we read from your file
            <textarea rows={8} value={letter} onChange={(e) => setLetter(e.target.value)} />
          </label>
        )}
      </section>

      <section className="template-block">
        <h3>Thank-you email</h3>
        <p className="fine">
          Paste the thank-you email you send after a coffee chat, and put the parts that change in [square brackets]. Everything outside the brackets
          is kept word for word. <strong>[First name]</strong>, <strong>[Bank]</strong>, <strong>[when]</strong> and <strong>[My name]</strong> are filled
          in automatically; anything else in brackets, like <strong>[something we talked about]</strong>, is written from your notes on the chat.
        </p>
        <textarea rows={9} value={email} onChange={(e) => setEmail(e.target.value)} placeholder={s.standard_email} />
        <div className="template-tools">
          {!email && (
            <button type="button" className="link" onClick={() => setEmail(s.standard_email)}>
              Start from the standard template
            </button>
          )}
          {email && (
            <button type="button" className="link" onClick={() => setEmail('')}>
              Use the standard template instead
            </button>
          )}
        </div>
        {email && (
          <label className="field">
            Rules the email must follow <small>(optional)</small>
            <input value={rules} onChange={(e) => setRules(e.target.value)} placeholder="e.g. No exclamation points. Each sentence under 30 words." />
          </label>
        )}
      </section>
      {error && <p className="notice error">{error}</p>}
      <Nav step={4} onBack={back}>
        <button className="primary" disabled={busy} onClick={save}>
          {busy ? 'Saving…' : 'Continue'}
        </button>
      </Nav>
    </>
  )
}

function DoneStep({ s, back, finish }: { s: SetupState; back: () => void; finish: () => void }) {
  const items: [keyof SetupState['done'], string, string][] = [
    ['school', 'School', s.profile.school],
    ['ai', 'AI connected', s.ai.ready ? (s.ai.provider_label || 'Site key') : 'Grading, letters and emails stay off until you add a key in Settings'],
    ['resume', 'Resume', s.profile.has_resume ? 'Uploaded' : 'Add it in Settings before writing cover letters'],
    ['banks', 'Banks', s.banks.length ? s.banks.join(', ') : 'Add banks any time from the Recruiting Map'],
    ['templates', 'Templates', s.done.templates ? 'Saved' : 'Using the standard formats'],
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
      <Nav step={5} onBack={back}>
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
    const order: (keyof SetupState['done'])[] = ['school', 'ai', 'resume', 'banks', 'templates']
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
          <button key={label} className={i === step ? 'on' : i < step ? 'past' : ''} onClick={() => i <= step || data.done.school ? go(i) : undefined}>
            <i />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="card setup-card" key={`${step}-${version}`}>
        {step === 0 && <SchoolStep s={data} next={next} />}
        {step === 1 && <KeyStep s={data} next={next} back={back} />}
        {step === 2 && <ResumeStep s={data} next={next} back={back} reload={reload} />}
        {step === 3 && <BanksStep s={data} next={next} back={back} />}
        {step === 4 && <TemplatesStep s={data} next={next} back={back} />}
        {step === 5 && <DoneStep s={data} back={back} finish={finish} />}
      </div>
    </div>
  )
}

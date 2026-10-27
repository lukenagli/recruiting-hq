import { useRef, useState } from 'react'
import { post, uploadWith } from './api'
import type { AiSettings, AssistantReply, BankDetail, CalendarItem, HomeData, SetupState } from './api'
import { useDictation } from './dictation'
import { ThanksCatchUp } from './Refresh'
import { Logo, fmtDate, useApi, useSchool } from './ui'

/**
 * Preview: catching up someone who has been recruiting before they found the app. Pick the banks you've talked to,
 * then one short page per bank: who, their role, where you met, what you talked about. Or drop in the spreadsheet
 * you've been keeping. Each bank is filed by the assistant in the background while you fill in the next one.
 */

type P = { name: string; title: string; group: string; yale: string; where: string; date: string; talked_about: string; thank_you_sent: boolean }
type Form = { people: P[]; emails: string; applied: string; file: File | null }
type Filed = { state: 'filing' | 'done' | 'failed'; reply: string; label: string }

const blank = (): P => ({ name: '', title: '', group: '', yale: '', where: 'Coffee chat · Zoom', date: '', talked_about: '', thank_you_sent: true })
const TITLES = ['Analyst', 'Associate', 'VP', 'Director', 'Managing Director', 'Recruiter', '2Y (summered there)']
const CHATS = ['Coffee chat · Zoom', 'Coffee chat · Phone', 'Coffee chat · In person']

function Segmented({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <span className="seg" role="radiogroup">
      {options.map(([v, label]) => (
        <button type="button" key={v} role="radio" aria-checked={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(value === v ? '' : v)}>
          {label}
        </button>
      ))}
    </span>
  )
}

function PersonCard({ p, set, remove, events }: { p: P; set: (p: P) => void; remove?: () => void; events: CalendarItem[] }) {
  const school = useSchool()
  const latest = useRef(p) // dictation adds to whatever has been typed since it started
  latest.current = p
  const dictation = useDictation((phrase) => set({ ...latest.current, talked_about: `${latest.current.talked_about}${latest.current.talked_about ? ' ' : ''}${phrase}` }))
  return (
    <div className="cu-person">
      {remove && (
        <button type="button" className="icon-close cu-remove" onClick={remove} aria-label="Remove this person" title="Remove">
          <svg viewBox="0 0 24 24" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      )}
      <div className="cu-grid">
        <label className="field">
          Name
          <input value={p.name} onChange={(e) => set({ ...p, name: e.target.value })} placeholder="First and last name" autoComplete="off" />
        </label>
        <label className="field">
          Title
          <input value={p.title} onChange={(e) => set({ ...p, title: e.target.value })} list="cu-titles" placeholder="e.g. Associate" />
        </label>
        <label className="field">
          Group
          <input value={p.group} onChange={(e) => set({ ...p, group: e.target.value })} list="cu-groups" placeholder="e.g. Consumer & Retail" />
        </label>
        <label className="field">
          Where you talked
          <select
            value={p.where}
            onChange={(e) => {
              const ev = events.find((x) => x.title === e.target.value)
              set({ ...p, where: e.target.value, date: ev ? ev.date : p.date })
            }}
          >
            {CHATS.map((c) => <option key={c}>{c}</option>)}
            {events.length > 0 && (
              <optgroup label="Club events">
                {events.map((ev) => <option key={ev.title} value={ev.title}>{ev.title} ({fmtDate(ev.date)})</option>)}
              </optgroup>
            )}
            <option>Bank info session or event</option>
            <option>Dinner</option>
          </select>
        </label>
        <label className="field">
          When <small>(roughly is fine)</small>
          <input type="date" value={p.date} onChange={(e) => set({ ...p, date: e.target.value })} />
        </label>
        <div className="field">
          {school.short || 'School'} connection
          <Segmented value={p.yale} onChange={(v) => set({ ...p, yale: v })}
            options={[['yes', 'Alum'], ['student', school.peer === '2Y' ? '2Y' : 'Student'], ['no', 'Neither']]} />
        </div>
      </div>
      <label className="field">
        What you talked about <small>(optional; a few words is plenty)</small>
        <span className="cu-talk">
          <textarea rows={2} value={p.talked_about} onChange={(e) => set({ ...p, talked_about: e.target.value })}
            placeholder="Their path, their group's deals, advice they gave, who they told you to talk to next…" />
          {dictation.supported && (
            <button type="button" className={`icon-attach dictate ${dictation.listening ? 'listening' : ''}`} onClick={dictation.toggle}
              aria-label={dictation.listening ? 'Stop dictating' : 'Dictate'} title={dictation.listening ? 'Stop dictating' : 'Dictate'}>
              <svg viewBox="0 0 24 24" aria-hidden><path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
            </button>
          )}
        </span>
        {dictation.listening && <small className="dictation-status">{dictation.interim || 'Listening…'}</small>}
      </label>
      <label className="cu-check">
        <input type="checkbox" checked={p.thank_you_sent} onChange={(e) => set({ ...p, thank_you_sent: e.target.checked })} /> I already sent a thank-you
      </label>
    </div>
  )
}

function BankPage({ bank, domain, form, setForm, events, groups }: {
  bank: string; domain: string; form: Form; setForm: (f: Form) => void; events: CalendarItem[]; groups: string[]
}) {
  const known = useApi<BankDetail>(`/api/banks/${encodeURIComponent(bank)}`)
  const picker = useRef<HTMLInputElement>(null)
  const spoken = (known.data?.contacts ?? []).filter((c) => c.origin !== 'listed')
  return (
    <>
      <div className="cu-bank-head">
        <Logo bank={bank} domain={domain} size={44} />
        <div>
          <h2>Who have you talked to at {bank}?</h2>
          {spoken.length > 0 && <p className="muted">Already in your tracker: {spoken.map((c) => c.name).join(', ')}. Add anyone else, or new details for them.</p>}
        </div>
      </div>
      <datalist id="cu-titles">{TITLES.map((t) => <option key={t} value={t} />)}</datalist>
      <datalist id="cu-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist>
      {form.people.map((p, i) => (
        <PersonCard key={i} p={p} events={events}
          set={(np) => setForm({ ...form, people: form.people.map((x, j) => (j === i ? np : x)) })}
          remove={form.people.length > 1 ? () => setForm({ ...form, people: form.people.filter((_, j) => j !== i) }) : undefined} />
      ))}
      <button type="button" className="btn cu-add" onClick={() => setForm({ ...form, people: [...form.people, blank()] })}>
        + Someone else at {bank}
      </button>

      <div className="cu-extras">
        <div className="field">
          Applied yet?
          <Segmented value={form.applied} onChange={(v) => setForm({ ...form, applied: v })} options={[['yes', 'Yes'], ['no', 'Not yet']]} />
        </div>
        <label className="field">
          Emails with {bank} <small>(optional: paste invites, scheduling threads, recruiter emails)</small>
          <textarea rows={3} value={form.emails} onChange={(e) => setForm({ ...form, emails: e.target.value })} placeholder="Paste one or more emails here" />
        </label>
        <div className="field">
          The bank's team card or a roster <small>(optional: PDF, Word, screenshot, or an Outlook email)</small>
          <input ref={picker} type="file" hidden accept=".pdf,.docx,.txt,.eml,.msg,.png,.jpg,.jpeg,.webp"
            onChange={(e) => { setForm({ ...form, file: e.target.files?.[0] ?? null }); e.target.value = '' }} />
          {form.file ? (
            <div className="attached-file">
              <span>📎 {form.file.name}</span>
              <button type="button" className="icon-close" onClick={() => setForm({ ...form, file: null })} aria-label="Remove the file">
                <svg viewBox="0 0 24 24" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
          ) : (
            <button type="button" className="btn" onClick={() => picker.current?.click()}>Attach a file</button>
          )}
        </div>
      </div>
    </>
  )
}

export default function CatchUp() {
  const setup = useApi<SetupState>('/api/setup')
  const cal = useApi<CalendarItem[]>('/api/calendar')
  const home = useApi<HomeData>('/api/home')
  const ai = useApi<AiSettings>('/api/settings/ai')
  const [picked, setPicked] = useState<string[]>([])
  const [other, setOther] = useState('')
  const [step, setStep] = useState<'banks' | 'done' | number>('banks')
  const [forms, setForms] = useState<Record<string, Form>>({})
  const [filed, setFiled] = useState<Record<string, Filed>>({})
  const [sheetError, setSheetError] = useState('')
  const [reading, setReading] = useState(false)
  const queue = useRef<Promise<void>>(Promise.resolve())
  const sheetPicker = useRef<HTMLInputElement>(null)

  const s = setup.data
  const today = home.data?.today ?? new Date().toISOString().slice(0, 10)
  const events = (cal.data ?? []).filter((e) => e.date <= today && !/^club meeting/i.test(e.title))
  const groups = s ? [...s.options.industry_groups, ...s.options.product_groups] : []
  const choices = s ? [...s.bank_choices].sort((a, b) => Number(s.banks.includes(b.bank)) - Number(s.banks.includes(a.bank)) || a.bank.localeCompare(b.bank)) : []
  const domainOf = (bank: string) => s?.bank_choices.find((c) => c.bank === bank)?.domain ?? ''

  /** File one block in the background, one at a time, so you can keep going while it's read. */
  function file(key: string, label: string, run: () => Promise<AssistantReply>) {
    setFiled((f) => ({ ...f, [key]: { state: 'filing', reply: '', label } }))
    queue.current = queue.current.then(async () => {
      try {
        const out = await run()
        setFiled((f) => ({ ...f, [key]: { state: 'done', reply: out.reply, label } }))
      } catch (e) {
        setFiled((f) => ({ ...f, [key]: { state: 'failed', reply: (e as Error).message, label } }))
      }
    })
  }

  function saveBank(bank: string) {
    const f = forms[bank]
    if (!f) return
    const people = f.people.filter((p) => p.name.trim())
    if (people.length || f.emails.trim() || f.applied)
      file(bank, bank, () => post<AssistantReply>('/api/catch-up', {
        bank, people: people.map((p) => ({ ...p, where: p.where.replace(' · ', ' (') + (p.where.includes(' · ') ? ')' : '') })),
        emails: f.emails, applied: f.applied,
      }))
    if (f.file) {
      const attached = f.file
      file(`${bank}-file`, `${bank}: ${attached.name}`, () => uploadWith<AssistantReply>('/api/assistant/file', attached, {
        message: `This is from ${bank} (a team card, roster or email). File what it tells you. Nobody on a roster has been spoken with unless my tracker already says so.`,
        history: '[]',
      }))
    }
  }

  async function readSheet(sheet: File) {
    setSheetError('')
    setReading(true)
    try {
      const blocks = await uploadWith<{ bank: string; count: number; rows: string }[]>('/api/catch-up/sheet', sheet, {})
      if (!blocks.length) throw new Error('That spreadsheet has no rows with a bank in them.')
      for (const b of blocks)
        file(`sheet-${b.bank}`, `${b.bank} · ${b.count} ${b.count === 1 ? 'row' : 'rows'} from ${sheet.name}`,
          () => post<AssistantReply>('/api/catch-up', { bank: b.bank, sheet_rows: b.rows }))
      setStep('done')
    } catch (e) {
      setSheetError((e as Error).message)
    } finally {
      setReading(false)
    }
  }

  function start() {
    const banks = [...picked, ...other.split(',').map((b) => b.trim()).filter(Boolean)]
    setForms((f) => Object.fromEntries(banks.map((b) => [b, f[b] ?? { people: [blank()], emails: '', applied: '', file: null }])))
    setPicked(banks)
    setOther('')
    setStep(banks.length ? 0 : 'banks')
  }

  const noKey = ai.data && !ai.data.ready && (
    <a className="notice key-callout" href="#/settings">
      <strong>Add your Yale class (Portkey) key in Settings first.</strong> The assistant does the filing, so it needs the key.
    </a>
  )

  if (step === 'done') {
    const rows = Object.entries(filed)
    const working = rows.some(([, f]) => f.state === 'filing')
    return (
      <div className="catch-up">
        <h1>{working ? 'Filing everything…' : 'You’re caught up'}</h1>
        <p className="lede">
          {working ? 'This takes a few seconds per bank. You can leave this page; it keeps going while the tab is open.' : 'Here is what was saved. Anything wrong? Tell the assistant and it will fix it.'}
        </p>
        <ul className="cu-results">
          {rows.map(([k, f]) => (
            <li key={k} className={f.state}>
              <span className="cu-state" aria-hidden>{f.state === 'filing' ? '' : f.state === 'done' ? '✓' : '!'}</span>
              <div>
                <strong>{f.label}</strong>
                <p>{f.state === 'filing' ? 'Filing…' : f.reply}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="cu-nav">
          <a className="primary" href="#/map">See your Recruiting Map</a>
          <button className="btn" onClick={() => { setPicked([]); setStep('banks') }}>Catch up on more banks</button>
        </div>
        {!working && <ThanksCatchUp />}
      </div>
    )
  }

  if (typeof step === 'number') {
    const bank = picked[step]
    const last = step === picked.length - 1
    return (
      <div className="catch-up">
        <div className="cu-progress">
          <button className="link" onClick={() => setStep(step === 0 ? 'banks' : step - 1)}>← Back</button>
          <span>{bank} · {step + 1} of {picked.length}</span>
          <span className="meter" aria-hidden><i style={{ width: `${((step + 1) / picked.length) * 100}%` }} /></span>
        </div>
        {noKey}
        <section className="card cu-card">
          <BankPage key={bank} bank={bank} domain={domainOf(bank)} form={forms[bank]} events={events} groups={groups}
            setForm={(f) => setForms((all) => ({ ...all, [bank]: f }))} />
        </section>
        <div className="cu-nav">
          <button className="primary big" onClick={() => { saveBank(bank); setStep(last ? 'done' : step + 1) }}>
            {last ? 'Save and finish' : `Save and go to ${picked[step + 1]}`}
          </button>
          <button className="link" onClick={() => setStep(last ? (Object.keys(filed).length ? 'done' : 'banks') : step + 1)}>Skip {bank}</button>
        </div>
        {Object.keys(filed).length > 0 && (
          <p className="muted cu-bg">
            {Object.values(filed).map((f) => `${f.label}: ${f.state === 'filing' ? 'filing…' : f.state === 'done' ? 'saved' : 'didn’t save'}`).join(' · ')}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="catch-up">
      <h1>Catch up on your recruiting</h1>
      <p className="lede">Bring in everyone you've already talked to. Pick the banks, then fill in a short page for each one.</p>
      {noKey}

      <section className="card cu-card">
        <h2>Which banks have you talked to?</h2>
        <div className="cu-banks">
          {choices.map((c) => {
            const on = picked.includes(c.bank)
            return (
              <button type="button" key={c.bank} className={`cu-bank ${on ? 'on' : ''}`} aria-pressed={on}
                onClick={() => setPicked(on ? picked.filter((b) => b !== c.bank) : [...picked, c.bank])}>
                <Logo bank={c.bank} domain={c.domain} size={28} />
                <span>{c.bank}</span>
                {on && <b aria-hidden>✓</b>}
              </button>
            )
          })}
        </div>
        <label className="field cu-other">
          Another bank? <small>(separate with commas)</small>
          <input value={other} onChange={(e) => setOther(e.target.value)} placeholder="e.g. Qatalyst" />
        </label>
        <div className="cu-nav">
          <button className="primary big" disabled={!picked.length && !other.trim()} onClick={start}>
            {picked.length ? `Continue with ${picked.length} ${picked.length === 1 ? 'bank' : 'banks'}` : 'Pick at least one bank'}
          </button>
        </div>
      </section>

      <section className="card cu-card cu-sheet">
        <h2>Already keep a spreadsheet?</h2>
        <p className="muted">
          Drop in your networking sheet (Excel or CSV) instead. It needs a Bank or Company column; names, titles, groups, chat dates, notes and
          thank-you dates are all read. Each bank is filed separately.
        </p>
        <input ref={sheetPicker} type="file" hidden accept=".xlsx,.xlsm,.csv" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) readSheet(f) }} />
        <button type="button" className="btn" disabled={reading} onClick={() => sheetPicker.current?.click()}>
          {reading ? 'Reading…' : 'Upload a spreadsheet'}
        </button>
        {sheetError && <p className="notice error">{sheetError}</p>}
      </section>

      <ThanksCatchUp />
    </div>
  )
}

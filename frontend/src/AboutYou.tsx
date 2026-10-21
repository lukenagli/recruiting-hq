import { useEffect, useState } from 'react'
import { post, upload } from './api'
import type { Profile, SetupState } from './api'
import { Loading, Logo, useApi } from './ui'

const toggle = (list: string[], x: string) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x])

/** Settings: everything about you that letters and interview practice draw on, edited in one place. */
export default function AboutYou() {
  const setup = useApi<SetupState>('/api/setup')
  const prof = useApi<Profile>('/api/profile')
  const [banks, setBanks] = useState<string[]>([])
  const [groups, setGroups] = useState<string[]>([])
  const [extra, setExtra] = useState('')
  const [fields, setFields] = useState({ resume_text: '' })
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!setup.data || !prof.data) return
    setBanks(setup.data.banks)
    setGroups(setup.data.profile.target_groups ? setup.data.profile.target_groups.split(',').map((g) => g.trim()).filter(Boolean) : [])
    setFields({ resume_text: prof.data.resume_text ?? '' })
    setDirty(false)
  }, [setup.data, prof.data])

  if (!setup.data || !prof.data) return <Loading error={setup.error || prof.error} />
  const s = setup.data
  const custom = banks.filter((b) => !s.bank_choices.some((c) => c.bank === b))
  const change = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v)
    setDirty(true)
    setMessage('')
  }
  const setField = (k: keyof typeof fields) => (e: React.ChangeEvent<HTMLTextAreaElement>) => change(setFields)({ ...fields, [k]: e.target.value })

  async function save() {
    setBusy('save')
    setError('')
    try {
      await post('/api/setup/banks', { banks, groups })
      await post('/api/profile', fields)
      setDirty(false)
      setMessage('Saved.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  async function sendResume(file: File | undefined) {
    if (!file) return
    setBusy('resume')
    setError('')
    try {
      const out = await upload<Profile>('/api/profile/resume', file)
      setFields((f) => ({ ...f, resume_text: out.resume_text }))
      setMessage('Resume read and saved.')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  function addExtra() {
    const name = extra.trim()
    if (name) change(setBanks)(banks.some((b) => b.toLowerCase() === name.toLowerCase()) ? banks : [...banks, name])
    setExtra('')
  }

  return (
    <section className="card about-you">
      <h3>About you</h3>
      <p className="muted">Your cover letters and interview practice use only what's here, in Interview Prep → Key information and in your tracker. Nothing is made up.</p>

      <div className="about-block">
        <h4>Resume</h4>
        <div className="resume-row">
          <label className={`ghost file-button ${fields.resume_text ? '' : 'primary-like'}`}>
            <input type="file" accept=".pdf,.docx,.txt" onChange={(e) => sendResume(e.target.files?.[0])} disabled={!!busy} />
            {busy === 'resume' ? 'Reading…' : fields.resume_text ? 'Replace resume' : 'Upload resume'}
          </label>
          <span className="muted">{fields.resume_text ? `✓ On file (${fields.resume_text.split(/\s+/).length} words)` : 'Word or PDF'}</span>
        </div>
        {fields.resume_text && (
          <details>
            <summary>View or edit the text</summary>
            <textarea rows={8} value={fields.resume_text} onChange={setField('resume_text')} />
          </details>
        )}
      </div>

      <div className="about-block">
        <h4>Banks you're recruiting with</h4>
        <div className="bank-grid">
          {s.bank_choices.map((b) => (
            <button key={b.bank} type="button" className={`bank-tile ${banks.includes(b.bank) ? 'on' : ''}`} onClick={() => change(setBanks)(toggle(banks, b.bank))}>
              <Logo bank={b.bank} domain={b.domain} size={26} />
              <span>{b.bank}</span>
              {banks.includes(b.bank) && <i aria-hidden>✓</i>}
            </button>
          ))}
          {custom.map((b) => (
            <button key={b} type="button" className="bank-tile on" onClick={() => change(setBanks)(toggle(banks, b))}>
              <Logo bank={b} domain="" size={26} />
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
      </div>

      <div className="about-block">
        <h4>Target groups</h4>
        <p className="fine">In order of preference. Your first pick is what cover letters focus on (unless a bank runs a generalist program).</p>
        {[
          ['Industry groups', s.options.industry_groups],
          ['Product groups', s.options.product_groups],
        ].map(([label, list]) => (
          <div key={label as string} className="group-block">
            <small>{label as string}</small>
            <div className="choice-row">
              {(list as string[]).map((g) => (
                <button key={g} type="button" className={`choice-pill ${groups.includes(g) ? 'on' : ''}`} onClick={() => change(setGroups)(toggle(groups, g))}>
                  {groups.includes(g) && <b className="rank">{groups.indexOf(g) + 1}</b>}
                  {g}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="fine">
        Why your target group, what to highlight and your notable projects are in <a href="#/prep?tab=stories">Interview Prep → Key information</a>,
        next to your STAR stories.
      </p>

      {error && <p className="notice error">{error}</p>}
      <div className="about-save">
        <button className="primary" disabled={!!busy || !dirty} onClick={save}>
          {busy === 'save' ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
        {message && !dirty && <span className="saved-note">{message}</span>}
      </div>
    </section>
  )
}

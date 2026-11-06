import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { AiSettings, BankSummary, CalendarItem, HomeData } from './api'
import { useBullets } from './bullets'
import { useDictation } from './dictation'
import { ASK_EVENT } from './Assistant'
import ClubFeed from './ClubFeed'
import Refresh from './Refresh'
import { post } from './api'
import { Loading, Logo, StagePips, daysUntil, fmtDate, useApi, useSchool } from './ui'

/**
 * Preview home: a dashboard. The header holds a one-line update bar that hands what you type to the assistant
 * panel, and a button to add a coffee chat by hand; below it, the week ahead by day, one to-do list, every bank as a pipeline, and the club's season.
 * A new account is first asked where it is in recruiting (just starting, or already networking).
 */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function inDays(n: number) {
  return n === 0 ? 'today' : n === 1 ? 'tomorrow' : n < 0 ? `${-n} days ago` : `in ${n} days`
}

function dayLabel(iso: string, today: string) {
  const n = daysUntil(iso, today)
  if (n === 0) return 'Today'
  if (n === 1) return 'Tomorrow'
  const [y, m, d] = iso.split('-').map(Number)
  return `${DAYS[new Date(y, m - 1, d).getDay()]}, ${MONTHS[m - 1].slice(0, 3)} ${d}`
}

function ask(detail: { text?: string; record?: 'recap' | 'conversation'; draft?: string }) {
  window.dispatchEvent(new CustomEvent(ASK_EVENT, { detail }))
}

/** The box in the header: tell the assistant what happened. It opens in the side panel. Enter sends; Shift+Enter starts a
 *  new line, and the box grows with what is typed (up to about six lines, then it scrolls). */
function UpdateBar({ onAdd, added }: { onAdd: () => void; added: string }) {
  const [text, setText] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const [tall, setTall] = useState(false)
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
    setTall(el.scrollHeight > 44)
  }, [text])
  const dictation = useDictation((phrase) => setText((t) => `${t}${t && !/\s$/.test(t) ? ' ' : ''}${phrase}`))
  function go(e?: React.FormEvent) {
    e?.preventDefault()
    dictation.stop()
    if (!text.trim()) return ask({})
    ask({ text })
    setText('')
  }
  return (
    <>
      <form className={tall ? 'update-bar tall' : 'update-bar'} onSubmit={go}>
        <textarea
          ref={box}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends; Shift+Enter is a new line (and Enter while an accent or Asian character is being composed types it)
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              go()
            }
          }}
          placeholder={dictation.listening ? 'Listening…' : 'What happened? A chat, an email, an invite…'}
          aria-label="Tell the assistant what happened"
        />
        {dictation.supported && (
          <button type="button" className={`bar-icon ${dictation.listening ? 'listening' : ''}`} onClick={dictation.toggle}
            aria-label={dictation.listening ? 'Stop dictating' : 'Dictate'} title={dictation.listening ? 'Stop dictating' : 'Dictate'}>
            <svg viewBox="0 0 24 24" aria-hidden><path d="M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
          </button>
        )}
        <button type="submit" className="bar-send" aria-label="Send to the assistant" title="Send">
          <svg viewBox="0 0 24 24" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" /></svg>
        </button>
      </form>
      <div className="update-links">
        <button type="button" className="add-chat-open" onClick={onAdd}><span aria-hidden>+</span> Add a coffee chat</button>
        <button type="button" onClick={() => ask({ record: 'conversation' })}><span aria-hidden>●</span> Record a coffee chat</button>
        <button type="button" onClick={() => ask({})}>Open the assistant</button>
        {added && <span className="add-chat-msg">{added}</span>}
      </div>
    </>
  )
}

/** Add a coffee chat by hand: the day you spoke, who (name, role, bank, group, alum or not) and what you talked about.
 *  Saved straight to the tracker, no AI involved; it shows on that bank's Recruiting Map. */
function AddChat({ banks, onAdded, onClose }: { banks: string[]; onAdded: (msg: string) => void; onClose: () => void }) {
  const blank = { date: localToday(), name: '', title: '', bank: '', group: '', alum: '', notes: '' }
  const [f, setF] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  const dictation = useDictation((phrase) => setF((v) => ({ ...v, notes: `${v.notes}${v.notes && !/\s$/.test(v.notes) ? ' ' : ''}${phrase}` })))
  const bullets = useBullets(f.notes, (notes) => setF((v) => ({ ...v, notes })))
  async function save(e: React.FormEvent) {
    e.preventDefault()
    dictation.stop()
    setBusy(true)
    setMsg('')
    try {
      const r = await post<{ ok: boolean; reason?: string }>('/api/tracker/edits', { note: 'Added a coffee chat', ops: [{ op: 'add_chat', ...f }] })
      if (!r.ok) return setMsg(r.reason || 'Not saved.')
      onAdded(`Saved your chat with ${f.name} (${f.bank}).`)
    } catch (err) {
      setMsg(String((err as Error).message || err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="add-chat dash-card" onSubmit={save}>
      <h2>Add a coffee chat</h2>
      <div className="add-chat-row">
        <label>Date you spoke<input type="date" required value={f.date} onChange={set('date')} /></label>
        <label>Name<input required value={f.name} onChange={set('name')} placeholder="Jane Smith" /></label>
        <label>Role<input list="add-chat-roles" value={f.title} onChange={set('title')} placeholder="Associate" /></label>
        <datalist id="add-chat-roles">
          {['Analyst', 'Associate', 'Vice President', 'Director', 'Managing Director', '2Y (second-year student)', 'Recruiter'].map((r) => <option key={r} value={r} />)}
        </datalist>
      </div>
      <div className="add-chat-row">
        <label>Bank<input required list="add-chat-banks" value={f.bank} onChange={set('bank')} placeholder="Goldman Sachs" /></label>
        <datalist id="add-chat-banks">{banks.map((b) => <option key={b} value={b} />)}</datalist>
        <label>Group<input value={f.group} onChange={set('group')} placeholder="Healthcare" /></label>
        <label>Yale alum?
          <select value={f.alum} onChange={set('alum')}>
            <option value="">Not sure</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
      </div>
      <label>What you talked about / notes
        <textarea rows={4} ref={bullets.ref} value={f.notes} onChange={bullets.onChange} onKeyDown={bullets.onKeyDown}
          placeholder={dictation.listening ? 'Listening…' : 'Their path, the group, advice, anything to follow up on. Start a line with "- " for a bullet; Tab and Shift+Tab indent it.'} />
      </label>
      <div className="add-chat-actions">
        {dictation.supported && (
          <button type="button" className="ghost" onClick={dictation.toggle}>{dictation.listening ? 'Stop dictating' : 'Dictate notes'}</button>
        )}
        <span className="spacer" />
        <button type="button" className="ghost" onClick={() => { dictation.stop(); onClose() }}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save chat'}</button>
      </div>
      {msg && <p className="add-chat-error">{msg}</p>}
    </form>
  )
}

/** Minutes after midnight for a time note like "9:30 AM ET", "11 AM" or "noon"; untimed items go last in their day. */
function minutes(note: string) {
  if (/\bnoon\b/i.test(note)) return 12 * 60
  const t = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m/i.exec(note)
  if (!t) return 24 * 60
  return ((Number(t[1]) % 12) + (/p/i.test(t[3]) ? 12 : 0)) * 60 + Number(t[2] ?? 0)
}

/** The start time from a note, always written the same way: "6:00 PM ET at Ammos Estiatorio", "6pm" and
 *  "6:00–6:30 PM" all give "6:00 PM"; "Noon" gives "12:00 PM". */
function clock(note: string) {
  if (/\bnoon\b/i.test(note)) return '12:00 PM'
  // a range takes its AM/PM from the end when the start has none ("5:00–5:30 PM")
  const range = /\b(\d{1,2})(?::(\d{2}))?\s*(?:([ap])\.?m\.?)?\s*(?:[–—-]|to)\s*\d{1,2}(?::\d{2})?\s*([ap])\.?m\b/i.exec(note)
  const one = /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\b/i.exec(note)
  const [h, m, ap] = range ? [range[1], range[2], range[3] || range[4]] : one ? [one[1], one[2], one[3]] : []
  return h && ap ? `${Number(h)}:${m ?? '00'} ${ap.toUpperCase()}M` : ''
}

/** True once a timed item started more than an hour ago (it has happened); untimed items stay until the day is over. */
function isPast(date: string, time: string, today: string) {
  if (date < today) return true
  if (date > today || minutes(time) >= 24 * 60) return false
  const now = new Date()
  return minutes(time) + 60 <= now.getHours() * 60 + now.getMinutes()
}

function Agenda({ d, out }: { d: HomeData; out: Set<string> }) {
  const items = [
    ...d.upcoming.map((u) => ({ date: u.date, time: clock(u.date_note ?? ''), title: u.title, bank: u.bank, kind: u.kind })),
    ...d.deadlines.filter((a) => !out.has(a.bank)).map((a) => ({ date: a.date, time: '', title: 'Application due', bank: a.bank, kind: 'deadline' })),
  ]
    .filter((i) => daysUntil(i.date, d.today) <= 7)
    .sort((a, b) => a.date.localeCompare(b.date) || minutes(a.time) - minutes(b.time))
  const days = [...new Set(items.map((i) => i.date))]
  return (
    <section className="dash-card agenda">
      <h2>This week</h2>
      {days.length === 0 && <p className="muted">Nothing scheduled in the next seven days.</p>}
      {days.map((day) => (
        <div className="agenda-day" key={day}>
          <h3>{dayLabel(day, d.today)}</h3>
          <ul>
            {items.filter((i) => i.date === day).map((i) => (
              <li key={`${i.bank}-${i.title}`} className={`k-${i.kind} ${isPast(i.date, i.time, d.today) ? 'past' : ''}`}>
                <a href={i.kind === 'deadline' ? `#/bank/${encodeURIComponent(i.bank)}` : `#/prep?bank=${encodeURIComponent(i.bank)}`}>
                  <span className="agenda-time">{i.time || (i.kind === 'deadline' ? 'Due' : '')}</span>
                  <span className="agenda-what">
                    <strong>{i.title}</strong>
                    <small>{i.bank}</small>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

function Todos({ d, out, onChanged }: { d: HomeData; out: Set<string>; onChanged: () => void }) {
  const [all, setAll] = useState(false)
  const [ticked, setTicked] = useState<Set<number>>(new Set())
  async function tick(id: number) {
    setTicked((s) => new Set(s).add(id)) // gone at once; the list reloads behind it
    await post(`/api/todos/${id}/done`, {}).catch(() => undefined)
    onChanged()
  }
  const items = [
    // everyone from a coffee chat or networking event still to thank; each name drops off once the reader sees the email
    ...(d.thanks_due ?? []).map((t) => ({
      id: 0,
      key: `ty${t.bank}${t.title}${t.date}`,
      title: t.who.length === 1 ? `Send a thank-you email to ${t.who[0]}` : `Send thank-you emails to ${t.who.join(', ')}`,
      bank: t.bank,
      // opens that person on the bank's map, as clicking their name there does (several people: the event they met at)
      sel: t.who_ids?.length === 1 ? `person:${t.who_ids[0]}` : t.entry_id ? `interaction:${t.entry_id}` : '',
      date: t.date,
      when: t.kind === 'event' ? `${t.title}, ${fmtDate(t.date)}` : `spoke ${fmtDate(t.date)}`,
      urgent: true,
    })),
    ...(d.todos ?? []).filter((t) => !ticked.has(t.id)).map((t) => ({ id: t.id, key: `td${t.bank}${t.title}`, title: t.title, bank: t.bank, sel: `interaction:${t.id}`, date: t.date, when: t.date ? fmtDate(t.date) : '', urgent: !!t.date && daysUntil(t.date, d.today) <= 1 })),
    ...d.deadlines.filter((a) => !out.has(a.bank) && daysUntil(a.date, d.today) > 7).map((a) => ({ id: 0, key: `ap${a.bank}`, title: `Apply to ${a.bank}`, bank: a.bank, sel: '', date: a.date, when: `due ${fmtDate(a.date)}`, urgent: false })),
  ].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999')) // earliest first, undated last
  const shown = all ? items : items.slice(0, 7)
  return (
    <section className="dash-card todos">
      <h2>
        To do <span className="count">{items.length}</span>
      </h2>
      {items.length === 0 && <p className="muted">All caught up.</p>}
      <ul>
        {shown.map((t) => (
          <li key={t.key} className={t.urgent ? 'urgent' : ''}>
            {t.id ? (
              <button type="button" className="todo-dot todo-tick" onClick={() => tick(t.id)} aria-label={`Mark done: ${t.title}`} title="Mark done" />
            ) : (
              <span className="todo-dot" aria-hidden />
            )}
            <a href={`#/bank/${encodeURIComponent(t.bank)}${t.sel ? `?sel=${encodeURIComponent(t.sel)}` : ''}`}>
              <span className="todo-what">
                <strong>{t.title}</strong>
                <small>{[t.bank, t.when].filter(Boolean).join(' · ')}</small>
              </span>
            </a>
          </li>
        ))}
      </ul>
      {items.length > 7 && (
        <button className="link" onClick={() => setAll(!all)}>{all ? 'Show less' : `Show all ${items.length}`}</button>
      )}
    </section>
  )
}

type ReviewPerson = { id: number; name: string; title: string }
type ReviewEntry = { id: number; kind: string; title: string; date: string; status: string; people: string | null; who: ReviewPerson[] }
type Review = { ready: boolean; banks?: { bank: string; people: number; entries: ReviewEntry[] }[] }
const KIND_LABEL: Record<string, string> = { coffee_chat: 'Coffee chat', event: 'Event', interview: 'Interview' }

/** One person on one entry (or an entry with no one on it), every detail in its own box, saved as soon as it changes. */
function ReviewRow({ bank, entry, person, onSaved, onRemove }: {
  bank: string; entry: ReviewEntry; person: ReviewPerson | null; onSaved: (moved: boolean) => void; onRemove: () => void
}) {
  const start = { name: person ? person.name : entry.title, title: person?.title ?? '', bank, date: entry.date }
  const [f, setF] = useState(start)
  const [saved, setSaved] = useState(start)
  const [msg, setMsg] = useState('')
  const [removing, setRemoving] = useState(false)
  async function save(field: keyof typeof start) {
    const value = f[field].trim()
    if (value === saved[field].trim()) return
    const ops: Record<string, unknown>[] = []
    if (field === 'name' && value) ops.push(person ? { op: 'rename_person', id: person.id, name: value } : { op: 'update_entry', id: entry.id, fields: { title: value } })
    if (field === 'title' && person) ops.push({ op: 'update_person', id: person.id, fields: { title: value } })
    if (field === 'date' && value) ops.push({ op: 'update_entry', id: entry.id, fields: { date: value } })
    if (field === 'bank' && value) ops.push(person ? { op: 'move_person', id: person.id, bank: value } : { op: 'move_entry', id: entry.id, bank: value })
    if (!ops.length) return setF({ ...f, [field]: saved[field] })
    setMsg('Saving…')
    try {
      const r = await post<{ ok: boolean; reason?: string }>('/api/tracker/edits', { note: `Fixed after the first scan: ${entry.title}`, ops })
      if (!r.ok) {
        setMsg(r.reason || 'Not saved.')
        return setF({ ...f, [field]: saved[field] })
      }
      setSaved({ ...saved, [field]: value })
      setMsg('Saved')
      onSaved(field === 'bank')
    } catch (e) {
      setMsg(String((e as Error).message || e))
    }
  }
  const box = (field: keyof typeof start, label: string, extra: Record<string, unknown> = {}) => (
    <label className={`rv-field rv-${field}`}>
      <span>{label}</span>
      <input value={f[field]} onChange={(e) => setF({ ...f, [field]: e.target.value })} onBlur={() => save(field)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} {...extra} />
    </label>
  )
  return (
    <li className="rv-row">
      <span className="rv-kind">{KIND_LABEL[entry.kind] ?? entry.kind}{entry.status === 'upcoming' ? ' · coming up' : ''}</span>
      {box('name', person ? 'Name' : 'Event')}
      {person ? box('title', 'Role', { placeholder: 'Associate', list: 'rv-roles' }) : <span className="rv-field rv-title" />}
      {box('bank', 'Bank', { list: 'rv-banks' })}
      {box('date', 'Date', { type: 'date' })}
      <span className="rv-actions">
        {msg && <small className={msg === 'Saved' ? 'muted' : 'rv-error'}>{msg}</small>}
        {removing ? (
          <button type="button" className="link danger-link" onClick={onRemove}>Sure? Remove</button>
        ) : (
          <button type="button" className="link muted" onClick={() => setRemoving(true)} title="Remove this entry: it didn't happen">Remove</button>
        )}
      </span>
    </li>
  )
}

/** After a first scan: everything it found, bank by bank and person by person, to look over once. Each name, role, bank
 *  and date is in its own box: typing a fix saves it (a person moved to the right bank takes their chats along). */
function FirstScanReview({ onChanged, bankNames }: { onChanged: () => void; bankNames: string[] }) {
  const { data, reload } = useApi<Review>('/api/reader/review')
  const [removed, setRemoved] = useState<Set<number>>(new Set())
  if (!data?.ready || !data.banks?.length) return null
  async function remove(e: ReviewEntry) {
    await post('/api/tracker/edits', { note: `Removed after the first scan: ${e.title}`, ops: [{ op: 'delete_entry', id: e.id }] })
    setRemoved((s) => new Set(s).add(e.id))
    onChanged()
  }
  async function done() {
    await post('/api/reader/review/done', {})
    reload()
  }
  const saved = (moved: boolean) => {
    onChanged()
    if (moved) reload() // the row belongs under its new bank now
  }
  const left = (b: { entries: ReviewEntry[] }) => b.entries.filter((e) => !removed.has(e.id))
  const total = data.banks.reduce((n, b) => n + left(b).length, 0)
  const names = [...new Set([...bankNames, ...data.banks.map((b) => b.bank)])].sort()
  return (
    <section className="dash-card scan-review">
      <h2>Check what your first scan found <span className="count">{total}</span></h2>
      <p className="muted">
        The reader logged these from your email and calendar. Take two minutes to look them over: click into any box to fix a name, role,
        bank or date (it saves as soon as you click away), and remove anything that didn't happen. Your thank-you drafts and cover
        letters are built from this.
      </p>
      <datalist id="rv-banks">{names.map((n) => <option key={n} value={n} />)}</datalist>
      <datalist id="rv-roles">
        {['Analyst', 'Associate', 'Vice President', 'Director', 'Managing Director', '2Y', 'Recruiter'].map((r) => <option key={r} value={r} />)}
      </datalist>
      {data.banks.map((b) => (
        <details key={b.bank} className="scan-review-bank" open>
          <summary>
            <strong>{b.bank}</strong> <span className="muted">{left(b).length} logged · {b.people} {b.people === 1 ? 'person' : 'people'}</span>
          </summary>
          <ul>
            {left(b).flatMap((e) => (e.who?.length ? e.who : [null]).map((p) => (
              <ReviewRow key={`${e.id}-${p ? p.id : 'none'}`} bank={b.bank} entry={e} person={p}
                onSaved={saved} onRemove={() => remove(e)} />
            )))}
          </ul>
        </details>
      ))}
      <div className="scan-review-done">
        <button type="button" className="primary" onClick={done}>Looks right</button>
        <small className="muted">Anything you change or remove can be put back with Undo in the assistant.</small>
      </div>
    </section>
  )
}

/** What the reader couldn't file without the student: they type the answer right here, and Recruiting HQ files it. */
function ReaderQuestion({ q, onDone }: { q: { id: number; question: string }; onDone: () => void }) {
  const [answer, setAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState('')
  async function send(e: React.FormEvent) {
    e.preventDefault()
    if (!answer.trim()) return
    setBusy(true)
    try {
      const r = await post<{ reply: string }>(`/api/reader/questions/${q.id}/answer`, { answer })
      setReply(r.reply || 'Done.')
      setTimeout(onDone, 2500)
    } catch (err) {
      setReply(String((err as Error).message || err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <li>
      <span>{q.question}</span>
      {reply ? (
        <p className="rq-reply">{reply}</p>
      ) : (
        <form className="rq-answer" onSubmit={send}>
          <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Your answer, e.g. Goldman Sachs" aria-label={`Answer: ${q.question}`} />
          <button type="submit" className="btn" disabled={busy || !answer.trim()}>{busy ? 'Filing…' : 'Save'}</button>
          <button type="button" className="link muted" onClick={async () => { await post(`/api/reader/questions/${q.id}/done`, {}); onDone() }}>Dismiss</button>
        </form>
      )}
    </li>
  )
}

function ReaderQuestions({ onChanged }: { onChanged: () => void }) {
  const { data, reload } = useApi<{ id: number; asked_at: string; question: string }[]>('/api/reader/questions')
  if (!data || data.length === 0) return null
  return (
    <section className="dash-card reader-questions">
      <h2>The reader needs you <span className="count">{data.length}</span></h2>
      <p className="muted">It found these in your email and calendar but couldn't file them without you. Type the answer and press Save.</p>
      <ul>
        {data.map((q) => <ReaderQuestion key={q.id} q={q} onDone={() => { reload(); onChanged() }} />)}
      </ul>
    </section>
  )
}

function Pipeline({ banks, today }: { banks: BankSummary[]; today: string }) {
  const live = banks.filter((b) => b.application.status !== 'out')
  const out = banks.filter((b) => b.application.status === 'out')
  return (
    <section className="pipeline">
      <div className="section-head">
        <h2>Your banks</h2>
        <a href="#/map">Recruiting Map →</a>
      </div>
      <div className="pipe-grid">
        {live.map((b) => {
          const stage = [...b.stage].reverse().find((s) => s.done)?.label ?? 'Not started'
          return (
            <a key={b.bank} className="pipe-tile" href={`#/bank/${encodeURIComponent(b.bank)}`}>
              <span className="pipe-top">
                <Logo bank={b.bank} domain={b.domain} size={30} />
                <strong>{b.bank}</strong>
              </span>
              <StagePips stage={b.stage} />
              <span className="pipe-stage">{stage}</span>
              <small>
                {b.next_up ? `Next: ${b.next_up.title}, ${inDays(daysUntil(b.next_up.date, today))}` : b.last_touch ? `Last contact ${fmtDate(b.last_touch)}` : `${b.people} people`}
              </small>
            </a>
          )
        })}
      </div>
      {out.length > 0 && <p className="pipe-out">No longer in process: {out.map((b) => b.bank).join(', ')}</p>}
    </section>
  )
}

/** The club's fixed milestones (weekly club meetings move around, so they are left out). */
function Season({ items, today }: { items: CalendarItem[]; today: string }) {
  const marks = items.filter((i) => !/^club meeting/i.test(i.title))
  const next = marks.findIndex((i) => (i.end || i.date) >= today)
  const strip = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const el = strip.current?.children[Math.max(0, next - 1)] as HTMLElement | undefined
    if (strip.current && el) strip.current.scrollLeft = el.offsetLeft - strip.current.offsetLeft
  }, [next])
  if (!marks.length) return null
  return (
    <section className="season">
      <h2>The season</h2>
      <ol className="season-strip" ref={strip}>
        {marks.map((i, n) => {
          const past = next === -1 || n < next
          const now = i.date <= today && (i.end || i.date) >= today
          return (
            <li key={i.title} className={past ? 'past' : n === next ? 'next' : ''}>
              <span className="season-dot" aria-hidden>{past ? '✓' : ''}</span>
              <strong>{i.title}</strong>
              <small>
                {fmtDate(i.date)}
                {i.end ? `–${fmtDate(i.end)}` : ''}
                {!past && ` · ${now ? 'now' : inDays(daysUntil(i.date, today))}`}
              </small>
            </li>
          )
        })}
      </ol>
    </section>
  )
}

function StartFork() {
  return (
    <section className="fork">
      <h2>Where are you in recruiting?</h2>
      <div className="fork-choices">
        <a className="fork-choice" href="#/start">
          <span className="fork-emoji" aria-hidden>🌱</span>
          <strong>I'm just getting started</strong>
          <span>How banking recruiting works, step by step, and your first outreach email.</span>
        </a>
        <a className="fork-choice" href="#/catch-up">
          <span className="fork-emoji" aria-hidden>📇</span>
          <strong>I've already been networking</strong>
          <span>Refresh from Outlook brings in your chats and contacts from your email. Add anything that isn't in your email here, one bank at a time.</span>
        </a>
      </div>
    </section>
  )
}

function summary(d: HomeData) {
  const today = d.upcoming.filter((u) => u.date === d.today).length
  const tomorrow = d.upcoming.filter((u) => daysUntil(u.date, d.today) === 1).length
  const todo = d.thank_yous_due.length + (d.todos?.length ?? 0)
  return [
    today ? `${today} on today` : tomorrow ? `${tomorrow} on tomorrow` : 'Nothing on tomorrow',
    todo ? `${todo} to do` : 'all caught up',
  ].join(' · ')
}

/** Today in the student's own time zone. The server runs on UTC, which is already tomorrow by 8 PM in New Haven. */
function localToday() {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export default function HomeNext({ name }: { name: string }) {
  const api = useApi<HomeData>('/api/home')
  const { error } = api
  const data = api.data && { ...api.data, today: localToday() }
  const banks = useApi<BankSummary[]>('/api/banks')
  const ai = useApi<AiSettings>('/api/settings/ai')
  const cal = useApi<CalendarItem[]>('/api/calendar')
  const school = useSchool()
  const first = name.split(' ')[0]
  const newcomer = data?.totals.people === 0
  // banks the student is no longer in the process with: their deadlines no longer matter
  const out = new Set((banks.data ?? []).filter((b) => b.application.status === 'out').map((b) => b.bank))
  const now = new Date()
  const [adding, setAdding] = useState(false)
  const [added, setAdded] = useState('')

  return (
    <div className="home next">
      <header className="home-hero compact">
        <div className="home-hero-text">
          <p className="hero-date">
            {DAYS[now.getDay()]}, {MONTHS[now.getMonth()]} {now.getDate()}
          </p>
          <h1>
            {greeting()}
            {first ? `, ${first}` : ''}.
          </h1>
          <p className="hero-summary">{data ? (newcomer ? "Let's get your recruiting in one place." : summary(data)) : ' '}</p>
          <UpdateBar onAdd={() => { setAdding(true); setAdded('') }} added={added} />
        </div>
        <a className="photo-credit" href="https://commons.wikimedia.org/wiki/File:Manhattan_Skyline_2016.jpg" target="_blank" rel="noreferrer">
          Photo: Mike Sinko, CC BY 2.0
        </a>
      </header>

      <div className="dash">
        {adding && (
          <AddChat banks={(banks.data ?? []).map((b) => b.bank)} onClose={() => setAdding(false)}
            onAdded={(msg) => { setAdded(msg); setAdding(false); api.reload(); banks.reload() }} />
        )}
        <Refresh onDone={() => { api.reload(); banks.reload() }} />
        <FirstScanReview onChanged={() => { api.reload(); banks.reload() }} bankNames={(banks.data ?? []).map((b) => b.bank)} />
        <ReaderQuestions onChanged={() => { api.reload(); banks.reload() }} />
        {ai.data && !ai.data.ready && (
          <a className="notice key-callout" href="#/settings">
            <strong>One thing first:</strong> paste your Yale class (Portkey) key in Settings to turn on the assistant.
          </a>
        )}
        {newcomer && <StartFork />}
        {!data ? (
          <Loading error={error} />
        ) : (
          !newcomer && (
            <div className="dash-grid">
              <Agenda d={data} out={out} />
              <Todos d={data} out={out} onChanged={() => api.reload()} />
            </div>
          )
        )}
        <ClubFeed />
        {data && banks.data && banks.data.length > 0 && <Pipeline banks={banks.data} today={data.today} />}
        {data && cal.data && school.club && <Season items={cal.data} today={data.today} />}
      </div>
    </div>
  )
}

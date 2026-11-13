import { useEffect, useState } from 'react'
import { API_URL, del, get, post, uploadWith } from './api'
import type { BankSummary, Deal, DealDocument, DealPoint, DealsData } from './api'
import CapIQ from './CapIQ'
import RecommendedDeals from './RecommendedDeals'
import { Loading, Logo, useApi } from './ui'

const fileUrl = (docId: string | number, page?: string | null) =>
  `${API_URL}/api/deals/documents/${docId}/file${page ? `#page=${page}` : ''}`

/** Where a number came from: your document (with page), an official filing, the AI's web search, or your own notes. */
function Source({ p, deal }: { p: DealPoint; deal: Deal }) {
  if (!p.value) return null
  const doc = deal.documents.find((d) => String(d.id) === p.doc_id)
  if (p.source_kind === 'document')
    return doc ? (
      <a className="src src-doc" href={fileUrl(doc.id, p.page)} target="_blank" rel="noreferrer" title={p.quote ? `"${p.quote}"` : ''}>
        {doc.filename}, p. {p.page}
        {doc.scanned ? ' · scanned, read by AI' : ''}
      </a>
    ) : (
      <span className="src src-doc" title={p.quote ? `"${p.quote}"` : ''}>
        {p.source} (document removed)
      </span>
    )
  if (p.source_kind === 'official')
    return (
      <a className="src src-official" href={p.source} target="_blank" rel="noreferrer" title={p.quote ? `"${p.quote}"` : ''}>
        Official filing
      </a>
    )
  if (p.source_kind === 'web')
    return (
      <a className="src src-web" href={p.source} target="_blank" rel="noreferrer" title={p.quote ? `"${p.quote}"` : ''}>
        Found online by AI · verify
      </a>
    )
  return p.source ? <NotedSource source={p.source} deal={deal} /> : null
}

/** A source written as text ("Capital IQ, Oct 10, 2026", a web address, "My notes"). Capital IQ links to the deal's
 *  saved CapIQ summary (or its CapIQ page), and a web address links to itself. */
function NotedSource({ source, deal }: { source: string; deal: Deal }) {
  const url = /https?:\/\/[^\s;,)]+/.exec(source)?.[0]
  const capiqDoc = deal.documents.find((d) => d.kind === 'Capital IQ transaction summary')
  const href = url ?? (/capital ?iq|capiq/i.test(source) ? (capiqDoc ? fileUrl(capiqDoc.id) : deal.capiq_url) : '')
  if (!href) return <span className="src">{source}</span>
  return (
    <a className="src src-doc" href={href} target="_blank" rel="noreferrer"
      title={href === deal.capiq_url ? 'Opens the deal in Capital IQ (Yale Wi-Fi and Capital IQ sign-in needed)' : ''}>
      {(url && source.replace(url, '').replace(/[;,\s]+$/, '').trim()) || source}
    </a>
  )
}

/** One point of the pitch: its value and source, or "Still need this"; click to type it in yourself. */
function PointRow({ p, deal, onChanged }: { p: DealPoint; deal: Deal; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mine = p.section === '5. My take'

  async function save(e?: React.FormEvent) {
    e?.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    setError('')
    try {
      const out = await post<{ ok: boolean; reason?: string }>(`/api/deals/points/${p.id}`, { value: text, source: 'My notes' })
      if (!out.ok) return setError(out.reason ?? 'Not saved.')
      setEditing(false)
      onChanged()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function clear() {
    await post(`/api/deals/points/${p.id}/clear`, {})
    onChanged()
  }

  return (
    <div className={p.value ? '' : 'missing'}>
      <dt>{p.label}</dt>
      <dd>
        {editing ? (
          <form className="point-edit" onSubmit={save}>
            <textarea
              autoFocus
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={mine ? 'Your view, in a sentence or two' : 'The figure, with its units (e.g. $2.1bn, 32% premium)'}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setEditing(false)
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  void save()
                }
              }}
            />
            <span className="point-edit-actions">
              <button className="primary" disabled={busy || !text.trim()}>{busy ? 'Saving…' : 'Save'}</button>
              <button type="button" className="link muted" onClick={() => setEditing(false)}>Cancel</button>
              {error && <small className="danger-link">{error}</small>}
            </span>
          </form>
        ) : (
          <>
            {p.value || (mine ? 'Your call: type it in' : 'Still need this')}
            <span className="point-meta">
              {p.value && <Source p={p} deal={deal} />}
              <button className="link clear" onClick={() => { setText(p.value); setEditing(true) }}>{p.value ? 'Edit' : 'Type it in'}</button>
              {p.value && (
                <button className="link clear" title="Clear this point so it can be filled again" onClick={clear}>Clear</button>
              )}
            </span>
          </>
        )}
      </dd>
    </div>
  )
}

type StepState = { status: 'todo' | 'running' | 'done' | 'skipped' | 'failed'; note: string }
const BUILD_STEPS: [string, string, string][] = [
  ['gather', 'Gather the filings', "from the companies' own sites and SEC EDGAR"],
  ['fill', 'Pull the numbers into the pitch', 'each one with the page it came from'],
  ['web', 'Look up what the filings leave out', 'marked as found online, so you know what to double-check'],
  ['market', 'Add the share price reaction', 'from Yahoo Finance, no AI'],
  ['reading', 'Find analysis worth reading', 'a different angle in each piece'],
]

/** One button that runs the whole pitch build, step by step, with what each step did. */
function BuildPitch({ deal, onChanged }: { deal: Deal; onChanged: () => void }) {
  const [state, setState] = useState<Record<string, StepState>>({})
  const [running, setRunning] = useState(false)
  const set = (key: string, s: StepState) => setState((st) => ({ ...st, [key]: s }))

  async function run() {
    setRunning(true)
    setState(Object.fromEntries(BUILD_STEPS.map(([k]) => [k, { status: 'todo', note: '' }])))
    type Out = { ok: boolean; message?: string; reason?: string }
    const calls: Record<string, () => Promise<Out>> = {
      gather: () => post<Out>(`/api/deals/${deal.id}/gather`, {}),
      fill: () => post<Out>(`/api/deals/${deal.id}/fill-from-documents`, {}),
      web: () => post<Out>(`/api/deals/${deal.id}/find-online`, {}),
      market: async () => {
        const a = await get<{ announced: string }>(`/api/deals/${deal.id}/announced`)
        if (!a.announced) return { ok: false, reason: "The announcement date isn't in the pitch yet. Enter it under Market reaction and click Fill share prices." }
        return post<Out>(`/api/deals/${deal.id}/market`, { announced: a.announced })
      },
      reading: () => post<Out>(`/api/deals/${deal.id}/reading`, {}),
    }
    for (const [key] of BUILD_STEPS) {
      set(key, { status: 'running', note: '' })
      try {
        const out = await calls[key]()
        set(key, { status: out.ok ? 'done' : 'skipped', note: out.message ?? out.reason ?? '' })
      } catch (e) {
        set(key, { status: 'failed', note: (e as Error).message })
      }
      onChanged()
    }
    setRunning(false)
  }

  const started = Object.keys(state).length > 0
  const mark = { todo: '', running: '…', done: '✓', skipped: '–', failed: '!' }
  return (
    <section className="card build-pitch">
      <div className="deal-docs-head">
        <h3>{deal.filled ? `${deal.filled} of ${deal.total} points ready` : 'Build this pitch'}</h3>
        <button className="primary" disabled={running} onClick={run}>
          {running ? 'Working…' : deal.filled ? 'Fill in the rest for me' : 'Build this pitch for me'}
        </button>
      </div>
      <p className="fine">
        Five steps, about three to five minutes: it gathers the filings, pulls every number it can into the pitch with the page it came
        from, looks up the rest online (marked, so you know what to double-check), adds how the shares reacted, and finds the analysis
        worth reading. Your own view in "My take" is yours to write: click any point to type it in.
      </p>
      {started && (
        <ol className="build-steps">
          {BUILD_STEPS.map(([key, label, sub]) => {
            const s = state[key] ?? { status: 'todo', note: '' }
            return (
              <li key={key} className={`st-${s.status}`}>
                <b aria-hidden>{mark[s.status]}</b>
                <span>
                  <strong>{label}</strong>
                  <small>{s.status === 'running' ? 'Working…' : s.note || sub}</small>
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

/** Fill both companies' share price reaction from Yahoo Finance's daily prices (no AI). */
function SharePrices({ deal, onChanged }: { deal: Deal; onChanged: () => void }) {
  const [day, setDay] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    get<{ announced: string }>(`/api/deals/${deal.id}/announced`).then((r) => setDay((d) => d || r.announced), () => undefined)
  }, [deal.id])
  async function fill() {
    setBusy(true)
    setMessage('')
    try {
      const out = await post<{ ok: boolean; message?: string; reason?: string }>(`/api/deals/${deal.id}/market`, { announced: day })
      setMessage(out.message ?? out.reason ?? '')
      onChanged()
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="share-prices">
      <label>
        Announced <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
      </label>
      <button className="btn" disabled={busy || !day} onClick={fill}>{busy ? 'Reading Yahoo Finance…' : 'Fill share prices from Yahoo Finance'}</button>
      <small className="muted">The move on announcement day, 1 month and 6 months later, and today.</small>
      {message && <p className="notice">{message}</p>}
    </div>
  )
}

/** Save a document to your computer, and open the page it was found on (the filing on EDGAR, or the
 *  company's investor relations page). Shown only once that page is known, never the raw file link. */
function DocLinks({ d }: { d: DealDocument }) {
  const page = d.source_page
  return (
    <>
      <a className="link" href={`${API_URL}/api/deals/documents/${d.id}/file?download=1`}>
        {d.filename.toLowerCase().endsWith('.pdf') ? 'Download PDF' : 'Download'}
      </a>
      {page && (
        <a className="link" href={page} target="_blank" rel="noreferrer">
          {page.includes('sec.gov') ? 'Source: SEC EDGAR filing' : `Source: ${new URL(page).hostname.replace(/^www\./, '')}`}
        </a>
      )}
    </>
  )
}

/** Analysis of the deal worth reading, each piece with its own angle. */
function Reading({ deal, onChanged }: { deal: Deal; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const items = deal.reading ?? []
  async function find() {
    setBusy(true)
    setMessage('')
    try {
      const out = await post<{ ok: boolean; message?: string; reason?: string }>(`/api/deals/${deal.id}/reading`, {})
      setMessage(out.message ?? out.reason ?? '')
      onChanged()
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="card deal-reading">
      <div className="deal-docs-head">
        <h3>Worth reading</h3>
        <button className="ghost" disabled={busy} onClick={find}>
          {busy ? 'Searching…' : items.length ? 'Find more' : 'Find analysis of this deal'}
        </button>
      </div>
      <p className="fine">Pieces that each add a different angle (rationale, valuation, financing, regulators, market reaction), not the announcement repeated. Found by AI web search, so open each one before you quote it.</p>
      <ul className="reading-list">
        {items.map((a) => (
          <li key={a.id}>
            <span className="reading-angle">{a.angle}</span>
            <a href={a.url} target="_blank" rel="noreferrer"><strong>{a.title}</strong></a>
            <small>{[a.outlet, a.published].filter(Boolean).join(' · ')}</small>
            <p>{a.takeaway}</p>
            <button className="link danger-link" onClick={async () => { await del(`/api/deals/reading/${a.id}`); onChanged() }}>Remove</button>
          </li>
        ))}
      </ul>
      {message && <p className="notice">{message}</p>}
    </section>
  )
}

/** The documents behind the pitch: gather them, upload your own, pull from Capital IQ, read the numbers out of them.
 *  Folded away once there are documents, since the pitch above is what matters day to day. */
function Documents({ deal, data, onChanged }: { deal: Deal; data: DealsData; onChanged: () => void }) {
  const [open, setOpen] = useState(deal.documents.length === 0)
  const [kind, setKind] = useState(data.wanted[0]?.kind ?? 'Other')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  // SEC filings saved as web pages earlier are turned into PDFs as soon as the deal is opened.
  const webPages = deal.documents.filter((d) => /\.html?$/i.test(d.filename)).length
  useEffect(() => {
    if (!webPages) return
    setMessage(`Turning ${webPages} SEC web page${webPages > 1 ? 's' : ''} into PDF${webPages > 1 ? 's' : ''}…`)
    post(`/api/deals/${deal.id}/to-pdf`, {}).then(() => { setMessage(''); onChanged() }, (e) => setMessage((e as Error).message))
  }, [deal.id, webPages]) // eslint-disable-line react-hooks/exhaustive-deps

  async function send(file: File | undefined, docKind = kind) {
    if (!file) return
    setBusy('upload')
    setError('')
    setMessage('')
    try {
      const out = await uploadWith<{ scanned: boolean }>(`/api/deals/${deal.id}/documents`, file, { kind: docKind })
      setMessage(
        out.scanned
          ? `Added ${file.name}. It is a scanned or screenshot PDF, so the AI will read it page by page when you click "Fill from my documents".`
          : `Added ${file.name}. Click "Fill from my documents" to pull the numbers out of it.`,
      )
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  async function run(path: string, label: string) {
    setBusy(label)
    setError('')
    setMessage('')
    try {
      const out = await post<{ ok: boolean; message?: string; reason?: string }>(path, {})
      if (out.ok) setMessage(out.message ?? 'Done.')
      else setError(out.reason ?? out.message ?? 'That did not work.')
      onChanged()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy('')
    }
  }

  async function remove(id: number) {
    await del(`/api/deals/documents/${id}`)
    onChanged()
  }

  const edgar = `https://www.sec.gov/edgar/search/#/q=${encodeURIComponent(deal.title.replace(/\b(acquiring|acquires|acquisition of|merger with)\b/gi, ' '))}`
  const n = deal.documents.length
  return (
    <details className="card deal-docs fold" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <strong>Source documents</strong>
        <small>
          {n
            ? `${n} on file. Open to add more, pull from Capital IQ, or read the numbers out of them again.`
            : 'The filings the pitch is built from: gather them, or upload your own.'}
        </small>
      </summary>
      <div className="gather">
        <button className="primary" disabled={busy !== ''} onClick={() => run(`/api/deals/${deal.id}/gather`, 'gather')}>
          {busy === 'gather' ? 'Gathering from SEC EDGAR and the companies’ sites…' : 'Gather the documents for me'}
        </button>
        <p className="fine">
          Pulls the announcement, agreement, presentation, proxy and annual reports as PDFs from the companies' own investor relations pages, and from
          SEC EDGAR for anything they don't post. Run it again to replace older SEC web-page copies with PDFs. Takes up to a minute.{' '}
          <a className="link" href={edgar} target="_blank" rel="noreferrer">Find filings on SEC EDGAR yourself</a>
        </p>
      </div>
      <ul className="doc-checklist">
        {data.wanted.map((w) => {
          const docs = deal.documents.filter((d) => d.kind === w.kind)
          return (
            <li key={w.kind} className={docs.length ? 'have' : ''}>
              <b aria-hidden>{docs.length ? '✓' : ''}</b>
              <span className="doc-check-text">
                <strong>{w.kind}</strong>
                <small>{docs.length ? 'Uploaded' : 'Not uploaded yet'} · {w.why}</small>
                {!docs.length && <small className="doc-where">{w.where}</small>}
                {docs.map((d) => (
                  <span key={d.id} className="doc-file">
                    <a href={fileUrl(d.id)} target="_blank" rel="noreferrer">
                      {d.filename}
                    </a>
                    <small>
                      {d.pages} {d.pages === 1 ? 'page' : 'pages'}
                      {d.scanned === 'yes' ? ' · scanned, will be read by AI' : d.scanned === 'read' ? ' · scanned, read by AI' : ''}
                    </small>
                    <DocLinks d={d} />
                    <button className="link danger-link" onClick={() => remove(d.id)}>
                      Remove
                    </button>
                  </span>
                ))}
              </span>
              <label className={`ghost file-button small-btn ${busy === 'upload' && kind === w.kind ? 'busy' : ''}`}>
                <input
                  type="file"
                  accept=".pdf,.htm,.html,.txt"
                  onChange={(e) => {
                    setKind(w.kind)
                    send(e.target.files?.[0], w.kind)
                  }}
                  disabled={busy !== ''}
                />
                {busy === 'upload' && kind === w.kind ? 'Reading…' : docs.length ? 'Add another' : 'Upload'}
              </label>
            </li>
          )
        })}
        {(() => {
          const others = deal.documents.filter((d) => !data.wanted.some((w) => w.kind === d.kind))
          return (
            <li className={others.length ? 'have' : ''}>
              <b aria-hidden>{others.length ? '✓' : ''}</b>
              <span className="doc-check-text">
                <strong>Anything else</strong>
                <small>Earnings releases, analyst notes, Capital IQ exports…</small>
                {others.map((d) => (
                  <span key={d.id} className="doc-file">
                    <a href={fileUrl(d.id)} target="_blank" rel="noreferrer">
                      {d.filename}
                    </a>
                    <small>
                      {d.kind} · {d.pages} {d.pages === 1 ? 'page' : 'pages'}
                    </small>
                    <DocLinks d={d} />
                    <button className="link danger-link" onClick={() => remove(d.id)}>
                      Remove
                    </button>
                  </span>
                ))}
              </span>
              <label className="ghost file-button small-btn">
                <input type="file" accept=".pdf,.htm,.html,.txt" onChange={(e) => send(e.target.files?.[0], 'Other')} disabled={busy !== ''} />
                Upload
              </label>
            </li>
          )
        })()}
      </ul>
      <CapIQ deal={deal} onChanged={onChanged} />
      <div className="doc-actions">
        <button className="primary" disabled={busy !== '' || deal.documents.length === 0} onClick={() => run(`/api/deals/${deal.id}/fill-from-documents`, 'fill')}>
          {busy === 'fill' ? 'Reading your documents…' : 'Fill from my documents'}
        </button>
        <button className="ghost" disabled={busy !== ''} onClick={() => run(`/api/deals/${deal.id}/find-online`, 'web')}>
          {busy === 'web' ? 'Searching…' : 'Look up the rest online'}
        </button>
      </div>
      <p className="fine">
        Numbers from your documents are checked word for word against the page they cite (for a scanned PDF, against the AI's reading of that page). Anything found online is marked: SEC filings and the companies' own
        investor pages as official, everything else as "found online by AI", so you know what to double-check.
      </p>
      {message && <p className="notice ok">{message}</p>}
      {error && <p className="notice error">{error}</p>}
    </details>
  )
}

export default function Deals() {
  const { data, error, reload } = useApi<DealsData>('/api/deals')
  const banks = useApi<BankSummary[]>('/api/banks')
  const [open, setOpen] = useState(0)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [other, setOther] = useState('')
  const [addError, setAddError] = useState('')
  if (!data) return <Loading error={error} />
  const domains: Record<string, string> = Object.fromEntries((banks.data ?? []).map((b) => [b.bank, b.domain]))
  const myBanks = (banks.data ?? []).filter((b) => b.application.status !== 'out').map((b) => b.bank)

  async function addDeal(e: React.FormEvent) {
    e.preventDefault()
    setAddError('')
    const list = [...picked, ...other.split(',').map((b) => b.trim()).filter(Boolean)]
    const out = await post<{ ok: boolean; reason?: string }>('/api/deals', { title, banks: list }).catch((err) => ({ ok: false, reason: String(err.message) }))
    if (!out.ok) return setAddError(out.reason ?? 'Could not add it.')
    setAdding(false)
    setTitle('')
    setPicked([])
    setOther('')
    setOpen(data!.deals.length)
    reload()
  }

  const deal = data.deals[open]

  return (
    <div className="deals">
      <h1>My Deals</h1>
      <p className="lede">Each deal laid out as a 90-second pitch: background, the deal, market reaction, your take. Every number shows where it came from.</p>

      <RecommendedDeals mine={data.deals.map((d) => d.title)} onAdded={() => { setOpen(data.deals.length); reload() }} />

      <div className="deal-tabs">
        {data.deals.map((d, i) => (
          <button key={d.id} className={`deal-tab ${i === open ? 'on' : ''}`} onClick={() => setOpen(i)}>
            <strong>{d.title}</strong>
            <span className="deal-banks">
              {d.banks.map((b) => (
                <span key={b}>
                  <Logo bank={b} domain={domains[b] ?? ''} size={16} /> {b}
                </span>
              ))}
            </span>
            <span className="meter">
              <i style={{ width: `${(d.filled / d.total) * 100}%` }} />
            </span>
            <small>
              {d.filled} of {d.total} points ready
            </small>
          </button>
        ))}
        {!adding && (
          <button className="deal-tab add" onClick={() => setAdding(true)}>
            <strong>+ Add a deal</strong>
            <span className="muted">Start a new pitch checklist</span>
          </button>
        )}
      </div>

      {adding && (
        <form className="card add-deal" onSubmit={addDeal}>
          <label className="field">
            Deal name
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Buyer acquiring Target" autoFocus />
          </label>
          <div className="field">
            Banks you will pitch it to <small>(tap any; optional)</small>
            <div className="chips">
              {myBanks.map((b) => (
                <button key={b} type="button" className={`chip ${picked.includes(b) ? 'on' : ''}`}
                  onClick={() => setPicked((cur) => (cur.includes(b) ? cur.filter((x) => x !== b) : [...cur, b]))}>
                  <Logo bank={b} domain={domains[b] ?? ''} size={16} /> {b}
                </button>
              ))}
            </div>
            <input value={other} onChange={(e) => setOther(e.target.value)} placeholder="Another bank (comma separated)" />
          </div>
          {addError && <p className="notice error">{addError}</p>}
          <button className="primary" disabled={!title.trim()}>Add deal</button>
          <button type="button" className="ghost" onClick={() => setAdding(false)}>Cancel</button>
        </form>
      )}
      {data.deals.length === 0 && !adding && (
        <p className="muted">No deals yet. Let it find one above, or add the deal you plan to pitch and it will gather the filings and fill in the numbers.</p>
      )}

      {deal && (
        <>
          {deal.status && <p className="notice">{deal.status}</p>}
          {deal.notes && <p className="muted">{deal.notes}</p>}

          <BuildPitch key={`b${deal.id}`} deal={deal} onChanged={reload} />

          <section className="card deal-section">
            <h3>
              1. Introduction <small>5 seconds</small>
            </h3>
            <p className="script">"{data.intro}"</p>
          </section>

          {deal.sections.map((s) => (
            <section className="card deal-section" key={s.name}>
              <h3>
                {s.name} <small>{s.timing}</small>
              </h3>
              {s.name === '4. Market reaction' && <SharePrices deal={deal} onChanged={reload} />}
              <dl>
                {s.points.map((p) => (
                  <PointRow key={p.id} p={p} deal={deal} onChanged={reload} />
                ))}
              </dl>
            </section>
          ))}

          <section className="card deal-section">
            <h3>Follow-up questions to be ready for</h3>
            <ul>
              {data.follow_ups.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </section>

          <Documents key={deal.id} deal={deal} data={data} onChanged={reload} />
          <Reading key={`r${deal.id}`} deal={deal} onChanged={reload} />
          <p className="muted">
            You can also fill in a point by telling the assistant, for example: "For the {deal.title} deal, the termination fee is …"
          </p>
        </>
      )}
    </div>
  )
}

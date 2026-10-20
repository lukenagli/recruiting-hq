import { useState } from 'react'
import { API_URL, del, post, uploadWith } from './api'
import type { Deal, DealPoint, DealsData } from './api'
import { Loading, Logo, useApi } from './ui'

const DOMAINS: Record<string, string> = {
  'J.P. Morgan': 'jpmorgan.com',
  'Goldman Sachs': 'goldmansachs.com',
  Citi: 'citi.com',
  'Bank of America': 'bankofamerica.com',
  Barclays: 'barclays.com',
}

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
  return p.source ? <span className="src">{p.source}</span> : null
}

function Documents({ deal, data, onChanged }: { deal: Deal; data: DealsData; onChanged: () => void }) {
  const [kind, setKind] = useState(data.wanted[0]?.kind ?? 'Other')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [showWanted, setShowWanted] = useState(deal.documents.length === 0)
  const have = new Set(deal.documents.map((d) => d.kind))

  async function send(file: File | undefined) {
    if (!file) return
    setBusy('upload')
    setError('')
    setMessage('')
    try {
      const out = await uploadWith<{ scanned: boolean }>(`/api/deals/${deal.id}/documents`, file, { kind })
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
  return (
    <section className="card deal-docs">
      <div className="deal-docs-head">
        <h3>Source documents</h3>
        <button className="link" onClick={() => setShowWanted(!showWanted)}>
          {showWanted ? 'Hide what to upload' : 'What should I upload?'}
        </button>
      </div>
      {showWanted && (
        <div className="wanted">
          <p className="fine">
            These answer most of the checklist. Every number pulled from them links to the page it came from. Find filings on{' '}
            <a href={edgar} target="_blank" rel="noreferrer">
              SEC EDGAR
            </a>{' '}
            (download as PDF, or save the filing page as .htm).
          </p>
          <ul>
            {data.wanted.map((w) => (
              <li key={w.kind} className={have.has(w.kind) ? 'have' : ''}>
                <b aria-hidden>{have.has(w.kind) ? '✓' : '○'}</b>
                <span>
                  <strong>{w.kind}</strong> {w.why}
                  <small>{w.where}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {deal.documents.length > 0 && (
        <ul className="doc-list">
          {deal.documents.map((d) => (
            <li key={d.id}>
              <a href={fileUrl(d.id)} target="_blank" rel="noreferrer">
                {d.filename}
              </a>
              <small>
                {d.kind} · {d.pages} {d.pages === 1 ? 'page' : 'pages'}
                {d.scanned === 'yes' ? ' · scanned, will be read by AI' : d.scanned === 'read' ? ' · scanned, read by AI' : ''}
              </small>
              <button className="link danger-link" onClick={() => remove(d.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="doc-upload">
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="What this document is">
          {data.kinds.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
        <label className={`ghost file-button ${busy === 'upload' ? 'busy' : ''}`}>
          <input type="file" accept=".pdf,.htm,.html,.txt" onChange={(e) => send(e.target.files?.[0])} disabled={busy !== ''} />
          {busy === 'upload' ? 'Reading…' : 'Upload a document'}
        </label>
      </div>
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
    </section>
  )
}

export default function Deals() {
  const { data, error, reload } = useApi<DealsData>('/api/deals')
  const [open, setOpen] = useState(0)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [banks, setBanks] = useState('')
  const [addError, setAddError] = useState('')
  if (!data) return <Loading error={error} />

  async function addDeal(e: React.FormEvent) {
    e.preventDefault()
    setAddError('')
    const out = await post<{ ok: boolean; reason?: string }>('/api/deals', { title, banks: banks.split(',') }).catch((err) => ({ ok: false, reason: String(err.message) }))
    if (!out.ok) return setAddError(out.reason ?? 'Could not add it.')
    setAdding(false)
    setTitle('')
    setBanks('')
    setOpen(data!.deals.length)
    reload()
  }

  async function clear(id: number) {
    await post(`/api/deals/points/${id}/clear`, {})
    reload()
  }
  const deal = data.deals[open]

  return (
    <div className="deals">
      <h1>My Deals</h1>
      <p className="lede">Each deal laid out as a 90-second pitch: background, the deal, market reaction, your take. Every number shows where it came from.</p>

      <div className="deal-tabs">
        {data.deals.map((d, i) => (
          <button key={d.id} className={`deal-tab ${i === open ? 'on' : ''}`} onClick={() => setOpen(i)}>
            <strong>{d.title}</strong>
            <span className="deal-banks">
              {d.banks.map((b) => (
                <span key={b}>
                  <Logo bank={b} domain={DOMAINS[b] ?? ''} size={16} /> {b}
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
          <label className="field">
            Banks you will pitch it to <small>(comma separated)</small>
            <input value={banks} onChange={(e) => setBanks(e.target.value)} placeholder="e.g. Citi, Barclays" />
          </label>
          {addError && <p className="notice error">{addError}</p>}
          <button className="primary" disabled={!title.trim()}>Add deal</button>
          <button type="button" className="ghost" onClick={() => setAdding(false)}>Cancel</button>
        </form>
      )}
      {data.deals.length === 0 && !adding && <p className="muted">No deals yet. Add the deal you plan to pitch, then upload its filings to fill it in.</p>}

      {deal && (
        <>
          {deal.status && <p className="notice">{deal.status}</p>}
          {deal.notes && <p className="muted">{deal.notes}</p>}

          <Documents key={deal.id} deal={deal} data={data} onChanged={reload} />

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
              <dl>
                {s.points.map((p) => (
                  <div key={p.id} className={p.value ? '' : 'missing'}>
                    <dt>{p.label}</dt>
                    <dd>
                      {p.value || 'Still need this'}
                      {p.value && (
                        <span className="point-meta">
                          <Source p={p} deal={deal} />
                          <button className="link clear" title="Clear this point so it can be filled again" onClick={() => clear(p.id)}>
                            Clear
                          </button>
                        </span>
                      )}
                    </dd>
                  </div>
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
          <p className="muted">
            You can also fill in a point by telling the assistant, for example: "For the {deal.title} deal, the termination fee is …"
          </p>
        </>
      )}
    </div>
  )
}

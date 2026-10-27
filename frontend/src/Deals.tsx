import { useState } from 'react'
import { API_URL, del, post, uploadWith } from './api'
import type { Deal, DealDocument, DealPoint, DealsData } from './api'
import { Loading, Logo, useApi, usePreview } from './ui'

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

/** Preview: save a document to your computer, and open the original filing where it came from. */
function DocLinks({ d }: { d: DealDocument }) {
  if (!usePreview()) return null
  return (
    <>
      <a className="link" href={`${API_URL}/api/deals/documents/${d.id}/file?download=1`}>
        {d.filename.toLowerCase().endsWith('.pdf') ? 'Download PDF' : 'Download'}
      </a>
      {d.source_url && (
        <a className="link" href={d.source_url} target="_blank" rel="noreferrer">
          {d.source_url.includes('sec.gov') ? 'Source: SEC.gov' : `Source: ${new URL(d.source_url).hostname.replace(/^www\./, '')}`}
        </a>
      )}
    </>
  )
}

/** Preview: analysis of the deal worth reading, each piece with its own angle. */
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

function Documents({ deal, data, onChanged }: { deal: Deal; data: DealsData; onChanged: () => void }) {
  const preview = usePreview()
  const [kind, setKind] = useState(data.wanted[0]?.kind ?? 'Other')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

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
  return (
    <section className="card deal-docs">
      <div className="deal-docs-head">
        <h3>Source documents</h3>
        <a className="link" href={edgar} target="_blank" rel="noreferrer">
          Find filings on SEC EDGAR
        </a>
      </div>
      {preview ? (
        <div className="gather">
          <button className="primary" disabled={busy !== ''} onClick={() => run(`/api/deals/${deal.id}/gather`, 'gather')}>
            {busy === 'gather' ? 'Gathering from SEC EDGAR and the companies’ sites…' : 'Gather the documents for me'}
          </button>
          <p className="fine">Pulls the announcement, agreement, presentation, proxy and annual reports as PDFs from the companies' own investor relations pages, and from SEC EDGAR for anything they don't post. Run it again to replace older SEC web-page copies with PDFs. Takes up to a minute.</p>
        </div>
      ) : (
        <p className="fine">
          Upload these and the checklist fills itself, with every number linked to its page. Download filings from EDGAR as PDF, or save the
          filing page as .htm.
        </p>
      )}
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
  const preview = usePreview()
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
          {preview && <Reading key={`r${deal.id}`} deal={deal} onChanged={reload} />}

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

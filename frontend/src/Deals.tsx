import { useState } from 'react'
import { post } from './api'
import type { DealsData } from './api'
import { Loading, Logo, useApi } from './ui'

const DOMAINS: Record<string, string> = {
  'J.P. Morgan': 'jpmorgan.com',
  'Goldman Sachs': 'goldmansachs.com',
  Citi: 'citi.com',
  'Bank of America': 'bankofamerica.com',
  Barclays: 'barclays.com',
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
  const deal = data.deals[open]

  return (
    <div className="deals">
      <h1>My Deals</h1>
      <p className="lede">Each deal laid out as the Finance Club's 90-second pitch: background, the deal, market reaction, my take.</p>

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
          <button type="button" className="btn" onClick={() => setAdding(false)}>Cancel</button>
        </form>
      )}
      {data.deals.length === 0 && !adding && <p className="muted">No deals yet. Add the deal you plan to pitch, then fill it in by telling the assistant below.</p>}

      {deal && (
        <>
          {deal.status && <p className="notice">{deal.status}</p>}
          {deal.notes && <p className="muted">{deal.notes}</p>}

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
                      {p.value && p.source && <small> · {p.source}</small>}
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
            To fill in a point, tell the assistant below, for example: "For the Tate &amp; Lyle deal, the termination fee is …"
          </p>
        </>
      )}
    </div>
  )
}

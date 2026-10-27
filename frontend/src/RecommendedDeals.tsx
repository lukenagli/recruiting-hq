import { useState } from 'react'
import { post } from './api'
import type { RecommendedDeal, Recommendations } from './api'
import { fmtDate, useApi } from './ui'

/** Preview: deals to pitch, picked by the Finance Club's rules, either across all the student's banks or for one bank. */
export default function RecommendedDeals({ bank = '', mine = [], onAdded }: { bank?: string; mine?: string[]; onAdded?: () => void }) {
  const path = `/api/deals/recommended${bank ? `?bank=${encodeURIComponent(bank)}` : ''}`
  const { data, reload } = useApi<Recommendations>(path)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [added, setAdded] = useState<string[]>([])
  if (!data) return null

  async function find() {
    setBusy(true)
    setMessage('')
    try {
      const out = await post<{ message: string }>(path, {})
      setMessage(out.message)
      reload()
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function add(d: RecommendedDeal) {
    const banks = bank ? [bank] : d.covers
    const out = await post<{ ok: boolean; reason?: string }>('/api/deals', { title: d.title, banks }).catch((e) => ({ ok: false, reason: String(e.message) }))
    if (!out.ok) return setMessage(out.reason ?? 'Could not add it.')
    setAdded([...added, d.title])
    onAdded?.()
  }

  const have = new Set([...mine, ...added].map((t) => t.toLowerCase()))
  return (
    <section className="card deal-recs">
      <div className="deal-docs-head">
        <h3>{bank ? `Deals to pitch to ${bank}` : 'Recommended deals'}</h3>
        <button className="ghost" disabled={busy} onClick={find}>
          {busy ? 'Searching recent deals…' : data.deals.length ? 'Search again' : 'Find deals for me'}
        </button>
      </div>
      <p className="fine">
        Every deal here is an M&amp;A deal (or a restructuring) in your groups with at least one public company. Then the Finance Club's
        preferences, in order: all cash, $1–10bn, closed in the last 12 months (up to 2.5 years if nothing newer fits).{' '}
        {bank
          ? `${bank} advised on each one, so it is a deal they know well.`
          : `Deals your banks advised on come first${data.banks.length ? ` (${data.banks.join(', ')})` : ''}.`}{' '}
        Details come from Capital IQ once the reader has checked a deal; until then they are from a web search.
        {data.found_at && ` Last searched ${fmtDate(data.found_at.slice(0, 10))}.`}
      </p>
      {data.capiq_pending > 0 && (
        <p className="notice">
          {data.capiq_pending} deal{data.capiq_pending > 1 ? 's' : ''} still to check on Capital IQ. Sign in to Capital IQ in Chrome, then press
          Refresh on the home page: the reader opens each deal's CapIQ page in a background tab, copies its figures here and closes the tab.
        </p>
      )}
      <ul className="reading-list">
        {data.deals.map((d) => (
          <li key={d.key}>
            <span className="reading-angle">{d.industry_group}</span>
            <strong>{d.title}</strong>
            <small>
              ${d.value_usd_bn}bn · {d.consideration} · closed {fmtDate(d.closed)}, {d.closed.slice(0, 4)}
            </small>
            <p>{d.why}</p>
            <ul className="rec-reasons">
              {d.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
              {d.gaps.map((r) => (
                <li key={r} className="gap">{r}</li>
              ))}
            </ul>
            <small className="muted">
              Advisors: {d.buyer} ({d.advisors_buyer.join(', ') || 'not found'}); {d.target} ({d.advisors_target.join(', ') || 'not found'})
            </small>
            <span className="rec-actions">
              {d.capiq_url ? (
                <a href={d.capiq_url} target="_blank" rel="noreferrer"><strong>Capital IQ transaction summary</strong></a>
              ) : (
                <span className="muted">{d.capiq ? 'Not found on Capital IQ' : 'Not checked on Capital IQ yet'}</span>
              )}
              {d.sources.filter((s) => /^https?:\/\//.test(s)).slice(0, 3).map((s) => (
                <a key={s} href={s} target="_blank" rel="noreferrer">
                  Source: {s.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}
                </a>
              ))}
              {have.has(d.title.toLowerCase()) ? (
                <span className="muted">In My Deals</span>
              ) : (
                <button className="link" onClick={() => add(d)}>
                  Add to My Deals
                </button>
              )}
            </span>
          </li>
        ))}
      </ul>
      {message && <p className="notice">{message}</p>}
    </section>
  )
}

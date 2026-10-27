import { useEffect, useState } from 'react'
import { post } from './api'
import type { Deal } from './api'
import { useReader } from './Refresh'
import { fmtDate } from './ui'

/**
 * Preview: Capital IQ for one deal. Capital IQ only opens on the Yale network for a signed-in student, so the
 * Recruiting HQ Reader reads it from their own Chrome, after they confirm they are on Yale Wi-Fi and signed in.
 */
export default function CapIQ({ deal, onChanged }: { deal: Deal; onChanged: () => void }) {
  const reader = useReader()
  const [link, setLink] = useState(deal.capiq_url ?? '')
  const [asking, setAsking] = useState(false)
  const [started, setStarted] = useState(false)
  const [message, setMessage] = useState('')
  const busy = !!reader.status?.busy
  useEffect(() => {
    if (started && !busy && reader.status?.last) {
      setStarted(false)
      setMessage(reader.status.last.lines.filter((l) => l.startsWith('Capital IQ')).join(' ') || 'Done.')
      onChanged()
    }
  }, [busy, started]) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveLink() {
    setMessage('')
    try {
      const out = await post<{ ok: boolean; reason?: string }>(`/api/deals/${deal.id}/capiq-link`, { url: link })
      if (!out.ok) return setMessage(out.reason ?? 'Could not save that link.')
      onChanged()
    } catch (e) {
      setMessage((e as Error).message)
    }
  }

  async function pull() {
    setAsking(false)
    await post(`/api/deals/${deal.id}/capiq-want`, {})
    setStarted(true)
    setMessage('')
    reader.capiq()
  }

  const saved = !!deal.capiq_url && deal.capiq_url === link
  return (
    <div className="capiq">
      <h4>Capital IQ</h4>
      <p className="fine">
        Capital IQ has the cleanest numbers: enterprise value, EV/EBITDA and other multiples, premiums, advisors and comparable transactions.
        Open the deal in Capital IQ, copy the address of its Transaction Details page, and paste it here.
      </p>
      <div className="capiq-link">
        <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.capitaliq.com/CIQDotNet/Transactions/transactionDetail.aspx?transactionId=…" />
        {!saved && <button className="btn" onClick={saveLink} disabled={!link.trim()}>Save link</button>}
      </div>
      {saved && !asking && (
        <button className="primary" disabled={busy || !reader.installed} onClick={() => setAsking(true)}>
          {busy && started ? 'Reading Capital IQ…' : deal.capiq_at ? 'Pull from Capital IQ again' : 'Pull from Capital IQ'}
        </button>
      )}
      {saved && asking && (
        <div className="refresh-warning">
          <p>
            <strong>Are you on campus, on Yale Wi-Fi, and signed in to Capital IQ in Chrome?</strong> Capital IQ only opens on the Yale
            network. The reader reads this deal's pages in the background (no tabs open) and only reads; it changes nothing in Capital IQ.
          </p>
          <button className="primary" onClick={pull}>Yes, pull it</button>
          <button className="ghost" onClick={() => setAsking(false)}>Not right now</button>
        </div>
      )}
      {saved && !reader.installed && reader.checked && (
        <p className="fine">This uses the Recruiting HQ Reader. <a href="#/settings">Set it up in Settings</a>.</p>
      )}
      {deal.capiq_at && <small className="muted">Last pulled {fmtDate(deal.capiq_at.slice(0, 10))}. The summary PDF is in the documents above.</small>}
      {message && <p className="notice">{message}</p>}
    </div>
  )
}

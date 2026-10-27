import { useEffect, useState } from 'react'
import { post, uploadWith } from './api'
import type { Deal } from './api'
import { ReaderProgress, useReader } from './Refresh'
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
  const [uploading, setUploading] = useState(false)
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
      setMessage(link.trim() ? 'Saved. Pull from Capital IQ to read that deal.' : '')
      onChanged()
    } catch (e) {
      setMessage((e as Error).message)
    }
  }

  async function uploadPdf(file: File | undefined) {
    if (!file) return
    setUploading(true)
    setMessage('')
    try {
      await uploadWith(`/api/deals/${deal.id}/documents`, file, { kind: 'Capital IQ transaction summary' })
      setMessage('Saved with the documents above. Click "Fill from my documents" to read its numbers into the pitch.')
      onChanged()
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  async function pull() {
    setAsking(false)
    await post(`/api/deals/${deal.id}/capiq-want`, {})
    setStarted(true)
    setMessage('')
    reader.capiq()
  }

  const changed = link.trim() !== (deal.capiq_url ?? '')
  return (
    <div className="capiq">
      <h4>Capital IQ</h4>
      <p className="fine">
        Capital IQ has the cleanest numbers: enterprise value, EV/EBITDA and other multiples, premiums, advisors and comparable
        transactions. The reader finds this deal in Capital IQ and saves its transaction summary, consideration details, deal timeline and
        quick comps as PDFs here, each linked to its Capital IQ page.
      </p>
      {!asking && (
        <button className="primary" disabled={busy || !reader.installed} onClick={() => setAsking(true)}>
          {busy && started ? 'Reading Capital IQ…' : deal.capiq_at ? 'Pull from Capital IQ again' : 'Pull from Capital IQ'}
        </button>
      )}
      {started && <ReaderProgress status={reader.status} />}
      {asking && (
        <div className="refresh-warning">
          <p>
            <strong>Are you on campus, on Yale Wi-Fi, and signed in to Capital IQ in Chrome?</strong> Capital IQ only opens on the Yale
            network. The reader looks the deal up and reads its pages in the background (no tabs open). It only reads; it changes nothing in
            Capital IQ.
          </p>
          <button className="primary" onClick={pull}>Yes, pull it</button>
          <button className="ghost" onClick={() => setAsking(false)}>Not right now</button>
        </div>
      )}
      {!reader.installed && reader.checked && (
        <p className="fine">This uses the Recruiting HQ Reader. <a href="#/settings">Set it up in Settings</a>.</p>
      )}
      <details className="capiq-manual" open={changed}>
        <summary>{deal.capiq_url ? 'Capital IQ page for this deal' : 'Picked the wrong deal, or none? Paste its Capital IQ link'}</summary>
        <div className="capiq-link">
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://www.capitaliq.com/CIQDotNet/Transactions/transactionDetail.aspx?transactionId=…" />
          {changed && <button className="btn" onClick={saveLink}>Save link</button>}
          {!changed && deal.capiq_url && <a className="btn" href={deal.capiq_url} target="_blank" rel="noreferrer">Open</a>}
        </div>
      </details>
      {deal.capiq_at && <small className="muted">Last pulled {fmtDate(deal.capiq_at.slice(0, 10))}. The Capital IQ PDFs are with the documents above.</small>}
      <label className="link file-link capiq-upload">
        <input type="file" accept=".pdf" onChange={(e) => uploadPdf(e.target.files?.[0])} disabled={uploading} />
        {uploading ? 'Reading…' : 'Off campus? Upload a Capital IQ page you saved as a PDF'}
      </label>
      {message && <p className="notice">{message}</p>}
    </div>
  )
}

import { useState } from 'react'
import { API_URL, post } from './api'
import Refresh from './Refresh'
import { fmtDate, useApi } from './ui'

type SyncState = {
  has_key: boolean
  checkpoints: Record<string, Record<string, string>>
  log: { at: string; source: string; conversation: string; received: number; new: number; filed: number; note: string }[]
}

/** Preview: the Recruiting HQ Reader extension, which keeps the tracker up to date from email, Slack and WhatsApp. */
export default function ReaderSettings() {
  const { data, reload } = useApi<SyncState>('/api/sync/state')
  const [key, setKey] = useState('')
  const [copied, setCopied] = useState(false)
  if (!data) return null

  async function make() {
    const out = await post<{ key: string }>('/api/sync/key', {})
    setKey(out.key)
    reload()
  }
  async function turnOff() {
    await post('/api/sync/key/revoke', {})
    setKey('')
    reload()
  }

  return (
    <section className="card setup-card reader-card">
      <h2>Email, Slack and WhatsApp reader</h2>
      <p>
        The Recruiting HQ Reader is a Chrome extension. When you press Refresh, it reads what's new in your Outlook, Slack and WhatsApp and
        files it here. It never runs on its own. <strong>It can only read: it cannot send, reply, react or type anywhere.</strong>
      </p>
      <ol className="reader-steps">
        <li>
          <a className="btn" href={`${API_URL}/api/reader.zip`}>Download the Reader</a> and unzip it into a folder you'll keep (for example
          Documents\Recruiting HQ Reader).
        </li>
        <li>In Chrome, open <code>chrome://extensions</code>, turn on <strong>Developer mode</strong> (top right), click <strong>Load unpacked</strong> and choose that folder.</li>
        <li>Click the puzzle-piece icon in Chrome's toolbar, then the pin next to Recruiting HQ Reader.</li>
        <li>Create a reader key below, click the Reader's icon, paste the key and click <strong>Save key</strong>.</li>
        <li>Stay signed in to Outlook and Slack in Chrome. For WhatsApp, open web.whatsapp.com once and link your phone; after that it doesn't need to stay open.</li>
      </ol>
      {key ? (
        <div className="reader-key">
          <input readOnly value={key} onFocus={(e) => e.currentTarget.select()} aria-label="Reader key" />
          <button
            className="btn"
            onClick={async () => {
              await navigator.clipboard.writeText(key).catch(() => undefined)
              setCopied(true)
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
          <p className="fine">Shown once. Paste it into the extension now; making a new key turns this one off.</p>
        </div>
      ) : (
        <button className="btn" onClick={make}>{data.has_key ? 'Make a new reader key' : 'Create a reader key'}</button>
      )}
      {data.has_key && (
        <button className="link danger-link" onClick={turnOff}>Turn the reader off</button>
      )}
      {data.has_key && <Refresh onDone={reload} />}
      {data.log.length > 0 && (
        <>
          <h4>Recent syncs</h4>
          <ul className="reader-log">
            {data.log.slice(0, 8).map((l, i) => (
              <li key={i}>
                <span>{fmtDate(l.at.slice(0, 10))} {l.at.slice(11, 16)}</span> {l.source} · {l.conversation}: {l.new} new, {l.filed} filed
                {l.note && <small> {l.note}</small>}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

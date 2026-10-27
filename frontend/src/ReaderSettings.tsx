import { useState } from 'react'
import { post } from './api'
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
        The Recruiting HQ Reader is a Chrome extension. Every 30 minutes it reads what's new in your Outlook, Slack and WhatsApp and files it
        here. <strong>It can only read: it cannot send, reply, react or type anywhere.</strong>
      </p>
      <ol className="reader-steps">
        <li>In Chrome, open <code>chrome://extensions</code>, turn on Developer mode, click "Load unpacked" and pick the <code>reader-extension</code> folder.</li>
        <li>Create a reader key below and paste it into the extension's window (click its icon in the toolbar).</li>
        <li>Stay signed in to Outlook and Slack in Chrome, and keep web.whatsapp.com open in a tab.</li>
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

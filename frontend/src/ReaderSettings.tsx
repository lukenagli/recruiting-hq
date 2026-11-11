import { useState } from 'react'
import { API_URL, post } from './api'
import OutlookFolders from './OutlookFolders'
import Refresh, { ConnectButton, canConnect, useReader } from './Refresh'
import { fmtDate, useApi } from './ui'

type SyncState = {
  has_key: boolean
  checkpoints: Record<string, Record<string, string>>
  log: { at: string; source: string; conversation: string; received: number; new: number; filed: number; note: string }[]
}

/** The Recruiting HQ Reader extension, which keeps the tracker up to date from Outlook email and calendar.
 *  It shows only the one thing to do next: install the reader, connect it (one click), or nothing (it's connected). */
export default function ReaderSettings({ bare = false, onChange }: { bare?: boolean; onChange?: () => void }) {
  const { data, reload } = useApi<SyncState>('/api/sync/state')
  const reader = useReader()
  if (!data) return null
  const connected = !!reader.status?.has_key && data.has_key
  const installed = reader.installed && !reader.stale

  async function turnOff() {
    await post('/api/sync/key/revoke', {})
    reload()
    onChange?.()
  }
  const done = () => {
    reload()
    onChange?.()
  }

  return (
    <section className={bare ? 'reader-card' : 'card setup-card reader-card'}>
      {!bare && <h2>Outlook reader</h2>}
      <ol className="connect-steps">
        <li className={installed ? 'ok' : 'now'}>
          <b aria-hidden>{installed ? '✓' : '1'}</b>
          <div>
            <strong>Add the Recruiting HQ Reader to Chrome</strong>
            {installed ? (
              <small>Added{reader.status?.version ? ` (version ${reader.status.version})` : ''}.</small>
            ) : reader.stale ? (
              <>
                <small>The reader was just updated.</small>
                <button className="primary" onClick={() => window.location.reload()}>Reload this page</button>
              </>
            ) : (
              <InstallSteps />
            )}
          </div>
        </li>
        <li className={connected ? 'ok' : installed ? 'now' : ''}>
          <b aria-hidden>{connected ? '✓' : '2'}</b>
          <div>
            <strong>Connect it to your account</strong>
            {connected ? (
              <small>Connected. Press Refresh on your homepage whenever you want your tracker updated.</small>
            ) : installed && canConnect(reader.status?.version) ? (
              <ConnectButton onDone={done} />
            ) : installed ? (
              <PasteKey onMade={done} />
            ) : (
              <small>Once the reader is added, a Connect button appears here.</small>
            )}
          </div>
        </li>
        <li className={connected ? 'ok' : ''}>
          <b aria-hidden>{connected ? '✓' : '3'}</b>
          <div>
            <strong>Stay signed in to Outlook in Chrome</strong>
            <small>
              The reader uses the Outlook you're signed in to at{' '}
              <a href="https://outlook.cloud.microsoft/mail/" target="_blank" rel="noreferrer">outlook.cloud.microsoft</a>.
            </small>
          </div>
        </li>
      </ol>
      <p className="fine">
        It only reads, and only when you press Refresh. It can't send, reply, react or type anywhere: while it reads, Chrome blocks anything
        in Outlook that would.
      </p>
      {!bare && connected && <Refresh onDone={reload} />}
      {!bare && connected && <OutlookFolders key={data.log[0]?.at ?? ''} />}
      {!bare && data.log.length > 0 && (
        <details className="reader-log-box">
          <summary>Recent refreshes</summary>
          <ul className="reader-log">
            {data.log.slice(0, 8).map((l, i) => (
              <li key={i}>
                <span>{fmtDate(l.at.slice(0, 10))} {l.at.slice(11, 16)}</span> {l.source} · {l.conversation}: {l.new} new, {l.filed} filed
                {l.note && <small> {l.note}</small>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {data.has_key && (
        <button className="link danger-link" onClick={turnOff}>Disconnect the reader</button>
      )}
    </section>
  )
}

/** Adding an extension from a folder is the one step Chrome makes people do by hand. */
function InstallSteps() {
  return (
    <ol className="install-steps">
      <li>
        <a className="btn" href={`${API_URL}/api/reader.zip`}>Download the reader</a> and unzip it into a folder you'll keep, for example
        Documents\Recruiting HQ Reader. (Don't move that folder later: Chrome loads the reader from it.)
      </li>
      <li>
        In Chrome, open <code>chrome://extensions</code> (type it in the address bar), switch on <strong>Developer mode</strong> at the top
        right, click <strong>Load unpacked</strong> and choose that folder.
      </li>
      <li>Come back here and reload this page. This step turns green when Chrome has the reader.</li>
    </ol>
  )
}

/** Readers before 1.23 can't take their key from the page: make one and paste it into the reader's own window. */
function PasteKey({ onMade }: { onMade: () => void }) {
  const [key, setKey] = useState('')
  const [copied, setCopied] = useState(false)
  if (!key)
    return (
      <>
        <small>This copy of the reader is older, so the key is pasted by hand.</small>
        <button className="primary" onClick={async () => setKey((await post<{ key: string }>('/api/sync/key', {})).key)}>Make my key</button>
      </>
    )
  return (
    <div className="reader-key">
      <input readOnly value={key} onFocus={(e) => e.currentTarget.select()} aria-label="Reader key" />
      <button
        className="btn"
        onClick={async () => {
          await navigator.clipboard.writeText(key).catch(() => undefined)
          setCopied(true)
          onMade()
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <p className="fine">Click the reader's icon in Chrome's toolbar, paste the key, click Save key, then reload this page.</p>
    </div>
  )
}

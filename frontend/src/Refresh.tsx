import { useEffect, useState } from 'react'

/**
 * The Refresh button: asks the Recruiting HQ Reader (Chrome extension) to read what's new in the student's Outlook,
 * Slack and WhatsApp. The extension's bridge script answers on window.postMessage; with no extension, nothing answers.
 */

export type ReaderStatus = { version: string; busy: boolean; has_key: boolean; last: { at: string; lines: string[] } | null }

function send(type: 'ping' | 'sync' | 'capiq') {
  window.postMessage({ source: 'rhq-page', type }, window.origin)
}

export function useReader() {
  const [status, setStatus] = useState<ReaderStatus | null>(null)
  const [checked, setChecked] = useState(false)
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== window || e.data?.source !== 'rhq-reader') return
      setStatus(e.data as ReaderStatus)
    }
    window.addEventListener('message', onMessage)
    send('ping')
    const t = setTimeout(() => setChecked(true), 1200)
    return () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(t)
    }
  }, [])
  return { status, installed: !!status, checked, sync: () => send('sync'), capiq: () => send('capiq') }
}

export default function Refresh({ onDone }: { onDone?: () => void }) {
  const { status, installed, checked, sync } = useReader()
  const [confirming, setConfirming] = useState(false)
  const [wasBusy, setWasBusy] = useState(false)
  const busy = !!status?.busy
  useEffect(() => {
    if (busy) setWasBusy(true)
    if (!busy && wasBusy) {
      setWasBusy(false)
      onDone?.()
    }
  }, [busy, wasBusy, onDone])

  if (!checked && !installed) return null
  if (!installed)
    return (
      <div className="refresh">
        <a className="btn" href="#/settings">Set up the reader to refresh from your email</a>
      </div>
    )
  if (!status!.has_key)
    return (
      <div className="refresh">
        <a className="btn" href="#/settings">Finish setting up the reader (paste your key)</a>
      </div>
    )
  return (
    <div className="refresh">
      {busy ? (
        <p className="refresh-warning working">
          <strong>Refreshing…</strong> A minimized Chrome window is reading your Outlook, Slack and WhatsApp (or your own WhatsApp tab, if
          it's open). Please don't open or close that window, or click in WhatsApp; it closes on its own when it's done, usually in a few
          minutes.
        </p>
      ) : confirming ? (
        <div className="refresh-warning">
          <p>
            <strong>Before you refresh:</strong> the reader opens a minimized Chrome window (you'll see it in your taskbar) to read your
            Outlook, Slack and WhatsApp. WhatsApp only runs in one tab at a time, so if you already have WhatsApp open, it reads that tab
            instead. Leave them alone while it works (a few minutes); the window closes itself when it's done. It only reads: it never
            sends, replies or reacts.
          </p>
          <button className="primary" onClick={() => { setConfirming(false); sync() }}>Refresh now</button>
          <button className="ghost" onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      ) : (
        <button className="btn" onClick={() => setConfirming(true)}>
          ↻ Refresh from email, Slack and WhatsApp
        </button>
      )}
      {!busy && !confirming && status!.last && <small className="muted refresh-last">Last refreshed {status!.last.at}</small>}
    </div>
  )
}

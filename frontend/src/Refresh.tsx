import { useEffect, useState } from 'react'
import { useApi } from './ui'

/**
 * The Refresh button: asks the Recruiting HQ Reader (Chrome extension) to read what's new in the student's Outlook,
 * Slack and WhatsApp. The extension's bridge script answers on window.postMessage; with no extension, nothing answers.
 */

export type ReaderStatus = {
  version: string
  busy: boolean
  has_key: boolean
  last: { at: string; lines: string[] } | null
  progress?: { pct: number; label: string } | null // from Reader 1.4
  type?: 'status' | 'stale' // stale: the reader was updated after this page opened (from Reader 1.5.3)
}

/** How far along the reader is, while it works. */
export function ReaderProgress({ status }: { status: ReaderStatus | null }) {
  const p = status?.progress
  if (!status?.busy || !p) return null
  return (
    <div className="reader-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.pct} aria-label="Reader progress">
      <div className="reader-progress-track">
        <i style={{ width: `${Math.max(3, p.pct)}%` }} />
      </div>
      <small>
        {p.label} · {p.pct}%
      </small>
    </div>
  )
}

function send(type: 'ping' | 'sync' | 'capiq' | 'thanks') {
  window.postMessage({ source: 'rhq-page', type }, window.origin)
}

export function useReader() {
  const [status, setStatus] = useState<ReaderStatus | null>(null)
  const [checked, setChecked] = useState(false)
  const [stale, setStale] = useState(false)
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.source !== window || e.data?.source !== 'rhq-reader') return
      if (e.data.type === 'stale') setStale(true)
      else setStatus(e.data as ReaderStatus)
    }
    window.addEventListener('message', onMessage)
    send('ping')
    const t = setTimeout(() => setChecked(true), 1200)
    return () => {
      window.removeEventListener('message', onMessage)
      clearTimeout(t)
    }
  }, [])
  return { status, installed: !!status || stale, stale, checked, sync: () => send('sync'), capiq: () => send('capiq'), thanks: () => send('thanks') }
}

/** The one-time catch-up for someone already recruiting: the thank-you emails they already sent, each filed on the
 *  person it thanks, so it shows on their page. Uses the reader; no AI. */
export function ThanksCatchUp({ onDone }: { onDone?: () => void }) {
  const { status, installed, checked, thanks } = useReader()
  const [asking, setAsking] = useState(false)
  const [started, setStarted] = useState(false)
  const busy = !!status?.busy
  useEffect(() => {
    if (started && !busy && status?.last) onDone?.()
  }, [busy, started]) // eslint-disable-line react-hooks/exhaustive-deps
  const result = started && !busy ? status?.last?.lines.find((l) => l.startsWith('Thank-you')) : ''
  return (
    <section className="card cu-card thanks-catch-up">
      <h2>Bring in the thank-you emails you've already sent</h2>
      <p className="muted">
        The reader goes back through your Outlook to August 1, finds each thank-you you sent after a coffee chat or event, and saves it on
        that person's page, so you can see exactly what you wrote. It only reads, and it uses no AI.
      </p>
      {checked && !installed ? (
        <p className="fine">This uses the Recruiting HQ Reader. <a href="#/settings">Set it up in Settings</a> first, then come back here.</p>
      ) : busy && started ? (
        <div className="refresh-warning working">
          <p>
            <strong>Bringing in your thank-you emails…</strong> This can take 10 to 20 minutes for a full season. Outlook is open in a
            Chrome window in front of this one; leave it in front and it closes itself when it's done.
          </p>
          <ReaderProgress status={status} />
        </div>
      ) : asking ? (
        <div className="refresh-warning">
          <p>
            <strong>This may take a while.</strong> For a full season of recruiting it usually takes 10 to 20 minutes, with a progress bar
            here the whole time. Outlook opens in a Chrome window in front of this one (Chrome only reads what's on screen); leave it in front
            until it closes itself. It only reads: it never sends, replies or changes anything.
          </p>
          <button className="primary" onClick={() => { setAsking(false); setStarted(true); thanks() }}>Start</button>
          <button className="ghost" onClick={() => setAsking(false)}>Not now</button>
        </div>
      ) : (
        <button className="btn" disabled={busy} onClick={() => setAsking(true)}>Bring in my thank-you emails</button>
      )}
      {result && <p className="notice">{result}</p>}
    </section>
  )
}

export default function Refresh({ onDone }: { onDone?: () => void }) {
  const { status, installed, stale, checked, sync } = useReader()
  const allowance = useApi<{ ai_left: number }>('/api/sync/state') // the reader can't file anything once it's used up
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
  // A first look at the reader for someone who hasn't set it up, until they set it up or say not now.
  const [welcomed, setWelcomed] = useState(() => {
    try {
      return localStorage.getItem('rhq-reader-welcomed') === '1'
    } catch {
      return false
    }
  })
  const notNow = () => {
    setWelcomed(true)
    try {
      localStorage.setItem('rhq-reader-welcomed', '1')
    } catch {
      /* the plain set-up button shows from now on this visit */
    }
  }
  // What the last refresh couldn't read, so one that missed something doesn't look like it worked. (One Outlook
  // window that couldn't start doesn't count when the other read every folder.)
  const lines = status?.last?.lines ?? []
  const foldersRead = lines.some((l) => l.startsWith('Outlook read '))
  const unread = [...new Set(lines.flatMap((l) => {
    const stuck = (l.match(/didn't load/g) ?? []).length
    if (l.startsWith('Outlook read ')) return stuck ? [`${stuck} Outlook folder${stuck > 1 ? 's' : ''}`] : []
    if (l.startsWith('Outlook: ')) return foldersRead ? [] : ['your Outlook email']
    if (l.startsWith('Outlook calendar: ') && !/^Outlook calendar: \d+ events/.test(l)) return ['your Outlook calendar']
    if (l.startsWith('Outlook scheduled: ')) return ['your scheduled emails']
    if (l.startsWith('Slack: ')) return ['Slack']
    if (l.startsWith('WhatsApp ')) return ['WhatsApp']
    if (/allowance used|allowance is used up/.test(l)) return ["filing what was read (the day's AI allowance ran out; it's filed after midnight)"]
    return []
  }))]

  if (stale)
    return (
      <div className="refresh">
        <button className="btn" onClick={() => window.location.reload()}>The reader was just updated: reload this page to refresh</button>
      </div>
    )
  if (!checked && !installed) return null
  if (!installed)
    return (
      <div className="refresh">
        {welcomed ? (
          <a className="btn" href="#/settings">Set up the reader to refresh from your email</a>
        ) : (
          <div className="refresh-warning reader-welcome">
            <p>
              <strong>New: your tracker can keep itself up to date.</strong> The Recruiting HQ Reader is a Chrome extension: when you
              press Refresh, it reads what's new in your Outlook email and calendar, Slack and WhatsApp, and files your chats, invites,
              thank-yous and next steps here. It only reads; it never sends anything. Setting it up takes about five minutes.
            </p>
            <a className="btn primary" href="#/settings">Set it up</a>
            <button className="ghost" onClick={notNow}>Not now</button>
          </div>
        )}
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
        <div className="refresh-warning working">
          <p>
            <strong>Refreshing…</strong> The reader's Chrome windows, tiled across your screen, are reading your Outlook calendar and
            email, Slack and WhatsApp at the same time (your own WhatsApp tab moves into one for a moment and goes back). Leave them in front
            and don't click in them; they close on their own when they're done, usually within a minute.
          </p>
          <ReaderProgress status={status} />
        </div>
      ) : confirming ? (
        <div className="refresh-warning">
          <p>
            <strong>Before you refresh:</strong> the reader opens four Chrome windows tiled across your screen to read your Outlook
            calendar and email, Slack and WhatsApp at the same time. Chrome only reads what's on screen, so leave them in front while they
            work (usually under a minute); they close themselves when they're done. WhatsApp only runs in one tab at a time, so if you have
            WhatsApp open, that tab moves into one of the windows for a moment and goes back. It only reads: it never sends, replies or
            reacts.
          </p>
          {allowance.data?.ai_left === 0 && (
            <p className="refresh-out">
              You've used today's AI allowance, so a refresh now couldn't file anything. It resets at midnight; refresh after that.
            </p>
          )}
          <button className="primary" disabled={allowance.data?.ai_left === 0} onClick={() => { setConfirming(false); sync() }}>Refresh now</button>
          <button className="ghost" onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      ) : (
        <button className="btn" onClick={() => setConfirming(true)}>
          ↻ Refresh from email, Slack and WhatsApp
        </button>
      )}
      {!busy && !confirming && status!.last && <small className="muted refresh-last">Last refreshed {status!.last.at}</small>}
      {!busy && !confirming && unread.length > 0 && (
        <p className="notice error refresh-unread">
          <strong>Not read last time:</strong> {unread.join('; ')}. Refresh again, and leave the reader's windows in front until they close.
        </p>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { get, post } from './api'
import FolderSetup from './FolderSetup'
import { useApi } from './ui'

/**
 * The Refresh button: asks the Recruiting HQ Reader (Chrome extension) to read what's new in the student's Outlook
 * email and calendar. The extension's bridge script answers on window.postMessage; with no extension, nothing answers.
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

/** A phone or tablet (touch, no mouse): the reader, a Chrome extension, only runs on a computer. */
const phone = () => {
  try {
    return window.matchMedia('(hover: none) and (pointer: coarse)').matches
  } catch {
    return false
  }
}

function send(type: 'ping' | 'sync' | 'capiq' | 'thanks' | 'folders') {
  window.postMessage({ source: 'rhq-page', type }, window.origin)
}

/** Readers from 1.23 take their key from the page, so connecting is one click. */
export const canConnect = (version?: string) => {
  const [a, b] = (version || '0.0').split('.').map(Number)
  return a > 1 || (a === 1 && b >= 23)
}

/** Make a reader key and hand it straight to the reader. Resolves true once the reader says it has it. */
export async function connectReader(): Promise<boolean> {
  const { key } = await post<{ key: string }>('/api/sync/key', {})
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      window.removeEventListener('message', onMessage)
      clearTimeout(timer)
      resolve(ok)
    }
    function onMessage(e: MessageEvent) {
      if (e.source === window && e.data?.source === 'rhq-reader' && e.data.has_key) done(true)
    }
    window.addEventListener('message', onMessage)
    const timer = setTimeout(() => done(false), 5000)
    window.postMessage({ source: 'rhq-page', type: 'connect', key }, window.origin)
  })
}

/** One button: connects the reader on this computer to this account. */
export function ConnectButton({ onDone, label = 'Connect Outlook' }: { onDone?: () => void; label?: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle')
  return (
    <>
      <button
        className="primary"
        disabled={state === 'busy'}
        onClick={async () => {
          setState('busy')
          const ok = await connectReader().catch(() => false)
          setState(ok ? 'idle' : 'failed')
          if (ok) onDone?.()
        }}
      >
        {state === 'busy' ? 'Connecting…' : label}
      </button>
      {state === 'failed' && <p className="notice error">The reader didn't answer. Reload this page and try again.</p>}
    </>
  )
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
  return { status, installed: !!status || stale, stale, checked, sync: () => send('sync'), capiq: () => send('capiq'), thanks: () => send('thanks'),
           folders: () => send('folders') }
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
        <p className="fine">This uses the Recruiting HQ Reader. <a href="#/settings/outlook">Set it up in Settings</a> first, then come back here.</p>
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

type Filing = { waiting: number; running: number; done: number; failed: number; busy: boolean }

/** Recruiting HQ files what the reader read in the background; this follows it until it's done. */
function useFiling(on: boolean, readerBusy: boolean, onDone?: () => void) {
  const [filing, setFiling] = useState<Filing | null>(null)
  useEffect(() => {
    if (!on || readerBusy) return
    let stop = false
    let wasBusy = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const look = async () => {
      try {
        const f = await get<Filing>('/api/sync/filing')
        if (stop) return
        setFiling(f)
        if (f.busy) wasBusy = true
        else if (wasBusy) {
          wasBusy = false
          onDone?.()
        }
        if (f.busy) timer = setTimeout(look, 4000)
      } catch {
        if (!stop) timer = setTimeout(look, 10000)
      }
    }
    look()
    return () => {
      stop = true
      if (timer) clearTimeout(timer)
    }
  }, [on, readerBusy]) // eslint-disable-line react-hooks/exhaustive-deps
  return filing
}

export default function Refresh({ onDone }: { onDone?: () => void }) {
  const { status, installed, stale, checked, sync, folders } = useReader()
  // ai_left: the reader can't file anything once it's used up;
  // start_from: the account's first sync, which reaches back to the start of the season
  const allowance = useApi<{ ai_left: number; outlook_only?: boolean; start_from?: string; folders_confirmed?: boolean; folders_known?: number }>('/api/sync/state')
  const firstSync = !!allowance.data?.start_from
  const [confirming, setConfirming] = useState(false)
  const [wasBusy, setWasBusy] = useState(false)
  const busy = !!status?.busy
  const filing = useFiling(!!status?.has_key, busy, onDone)
  const filingBusy = !!filing?.busy
  useEffect(() => {
    if (busy) setWasBusy(true)
    if (!busy && wasBusy) {
      setWasBusy(false)
      allowance.reload() // a look at the folders before a first scan: the folder screen comes next
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
    // "Outlook read 41 folders: Inbox (2 new ...); MGT 410: Competitor (its 7 emails didn't load (second try)); ..."
    const stuck = l.replace(/^Outlook read \d+ folders: /, '').split('; ').filter((f) => /didn't load/.test(f))
      .map((f) => f.replace(/ \(its [\d,]+ emails didn't load.*$/, ''))
    if (l.startsWith('Outlook read ')) return stuck.length ? [`the Outlook folder${stuck.length > 1 ? 's' : ''} ${stuck.join(', ')}`] : []
    if (l.startsWith('Outlook: ')) return foldersRead ? [] : ['your Outlook email']
    if (l.startsWith('Outlook calendar: ') && !/^Outlook calendar: \d+ events/.test(l)) return ['your Outlook calendar']
    if (l.startsWith('Outlook scheduled: ')) return ['your scheduled emails']
    if (/allowance used|allowance is used up/.test(l)) return ["filing what was read (the day's AI allowance ran out; it's filed after midnight)"]
    return []
  }))]

  // What the last refresh looked through and what it skipped, so a missed email can be traced to its folder.
  const readNames = [...new Set(lines.filter((l) => l.startsWith('Outlook read ')).flatMap((l) =>
    l.replace(/^Outlook read \d+ folders: /, '').split('; ').map((f) => f.replace(/ \(.*$/, ''))))]
  const skippedNames = [...new Set(lines.filter((l) => l.startsWith('Outlook skipped ')).flatMap((l) =>
    l.replace(/^Outlook skipped .*?: /, '').replace(/\.$/, '').split(', ')))]
  const list = (names: string[]) => (names.length > 6 ? `${names.slice(0, 6).join(', ')} and ${names.length - 6} more` : names.join(', '))

  if (stale)
    return (
      <div className="refresh">
        <button className="btn" onClick={() => window.location.reload()}>The reader was just updated: reload this page to refresh</button>
      </div>
    )
  if (!checked && !installed) return null
  if (!installed && phone()) return null
  if (!installed)
    return (
      <div className="refresh">
        {welcomed ? (
          <a className="btn" href="#/settings/outlook">Set up the reader to refresh from your email</a>
        ) : (
          <div className="refresh-warning reader-welcome">
            <p>
              <strong>New: your tracker can keep itself up to date.</strong> The Recruiting HQ Reader is a Chrome extension: when you
              press Refresh, it reads what's new in your Outlook email and calendar, and files your chats, invites,
              thank-yous and next steps here. It only reads; it never sends anything. Setting it up takes about five minutes.
            </p>
            <a className="btn primary" href="#/settings/outlook">Set it up</a>
            <button className="ghost" onClick={notNow}>Not now</button>
          </div>
        )}
      </div>
    )
  if (!status!.has_key)
    return (
      <div className="refresh">
        {canConnect(status!.version) ? (
          <ConnectButton onDone={() => onDone?.()} label="Connect the reader to your account" />
        ) : (
          <a className="btn" href="#/settings/outlook">Finish setting up the reader (paste your key)</a>
        )}
      </div>
    )
  // An account's first scan starts with a 20-second look at the Outlook folders, then the student says which
  // hold recruiting email (FolderSetup), then the scan itself.
  const needsFolders = firstSync && allowance.data?.folders_confirmed === false && !busy && !filingBusy
  if (needsFolders && (allowance.data?.folders_known ?? 0) > 0)
    return (
      <div className="refresh">
        <FolderSetup onStart={() => { allowance.reload(); sync() }} />
      </div>
    )
  if (needsFolders)
    return (
      <div className="refresh">
        <div className="refresh-warning">
          <p>
            <strong>Your first refresh brings in everything since September 1.</strong> First, the reader takes a 20-second look at your
            Outlook folder list (it opens no email) so you can tell it which folders hold recruiting email. A Chrome window opens and
            closes on its own; leave it in front.
          </p>
          <button className="primary" onClick={folders}>Look at my folders</button>
        </div>
      </div>
    )
  return (
    <div className="refresh">
      {!busy && filingBusy ? (
        <div className="refresh-warning working">
          <p>
            <strong>Reading is done; filing it now.</strong> Recruiting HQ is going through what the reader found and logging your chats,
            events, people and thank-yous. You can close Chrome or the laptop: it carries on without you, and your tracker fills in as it goes.
          </p>
          {filing && (
            <div className="reader-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-label="Filing progress"
              aria-valuenow={Math.round((100 * filing.done) / Math.max(1, filing.done + filing.waiting + filing.running))}>
              <div className="reader-progress-track">
                <i style={{ width: `${Math.max(3, Math.round((100 * filing.done) / Math.max(1, filing.done + filing.waiting + filing.running)))}%` }} />
              </div>
              <small>Filed {filing.done} of {filing.done + filing.waiting + filing.running} batches</small>
            </div>
          )}
        </div>
      ) : busy && status?.progress?.label?.startsWith('Looking at your Outlook folders') ? (
        <div className="refresh-warning working">
          <p>
            <strong>Looking at your Outlook folders…</strong> Only the folder list, no email is opened. It takes about 20 seconds; leave the
            Chrome window in front until it closes.
          </p>
        </div>
      ) : busy ? (
        <div className="refresh-warning working">
          <p>
            <strong>Refreshing…</strong>{' '}
            A Chrome window is reading your Outlook calendar and email. Leave it in front and don't click in it; it closes on its own when it's done
            {firstSync
              ? '. This first one reaches back to September 1: reading takes about 10 to 15 minutes, then the window closes and the rest happens without you.'
              : ', usually within a minute or two.'}
          </p>
          <ReaderProgress status={status} />
        </div>
      ) : confirming ? (
        <div className="refresh-warning">
          <p>
            <strong>Before you refresh:</strong>{' '}
            the reader opens a Chrome window over yours to read your Outlook calendar and email. Chrome only reads what's on screen, so
            leave it in front while it works; it closes itself when it's done.{' '}
            {firstSync
              ? 'This first refresh reads everything since September 1 (every folder, however you organize them). Reading takes about 10 to 15 minutes; after that the window closes, you can close the laptop, and Recruiting HQ files it in the background. Later refreshes take a minute or two.'
              : 'It usually takes a minute or two.'}{' '}
            It only reads: it never sends, replies or reacts.
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
          ↻ Refresh from Outlook
        </button>
      )}
      {!busy && !confirming && status!.last && <small className="muted refresh-last">Last refreshed {status!.last.at}</small>}
      {!busy && !confirming && readNames.length > 0 && (
        <p className="muted refresh-folders">
          Last refresh looked through {readNames.length} folder{readNames.length > 1 ? 's' : ''} ({list(readNames)})
          {skippedNames.length > 0 && <> and skipped {skippedNames.length} where no recruiting email has turned up ({list(skippedNames)})</>}.{' '}
          <a href="#/settings/outlook">See or change which folders it reads</a>
        </p>
      )}
      {!busy && !confirming && unread.length > 0 && (
        <p className="notice error refresh-unread">
          <strong>Not read last time:</strong> {unread.join('; ')}. Refresh again, and leave the reader's windows in front until they close.
        </p>
      )}
    </div>
  )
}

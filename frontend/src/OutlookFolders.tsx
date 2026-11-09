import { useEffect, useRef, useState } from 'react'
import { post } from './api'
import { Loading, fmtDate, useApi } from './ui'

/**
 * Preview: what the reader has learned about how you file your Outlook mail. Each folder is read in full, checked
 * (only emails that look like recruiting are opened) or skipped, with the reason. Your own setting wins over what it
 * learned, and a folder can be read again from a date if something in it was missed.
 */

export type FolderInfo = { name: string; plan: 'full' | 'screen' | 'skip'; reason: string; mode: 'auto' | 'always' | 'skip'; last_read: string }

const PLAN_LABEL = { full: 'Read', screen: 'Checked', skip: 'Skipped' }
const ORDER = { full: 0, screen: 1, skip: 2 }

function Folder({ f, onChanged }: { f: FolderInfo; onChanged: () => void }) {
  const fixed = f.name === 'Inbox' || f.name === 'Sent Items'
  const [rereading, setRereading] = useState(false)
  const [since, setSince] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState('')
  async function run(fn: () => Promise<unknown>, ok = '') {
    setError('')
    try {
      await fn()
      setDone(ok)
      onChanged()
    } catch (e) {
      setError(String((e as Error).message || e))
    }
  }
  return (
    <li className={`folder-row plan-${f.plan}`}>
      <div className="folder-main">
        <strong>{f.name}</strong>
        <span className={`folder-plan plan-${f.plan}`}>{PLAN_LABEL[f.plan]}</span>
        <small className="muted">{f.reason}{f.last_read ? ` · last opened ${fmtDate(f.last_read.slice(0, 10))}` : ''}</small>
      </div>
      {!fixed && (
        <div className="folder-actions">
          <select aria-label={`How to treat ${f.name}`} value={f.mode}
            onChange={(e) => run(() => post('/api/sync/folders/mode', { folder: f.name, mode: e.target.value }))}>
            <option value="auto">Let it decide</option>
            <option value="always">Always read</option>
            <option value="skip">Skip</option>
          </select>
          {rereading ? (
            <span className="folder-reread">
              <input type="date" value={since} onChange={(e) => setSince(e.target.value)} aria-label={`Read ${f.name} again from`} />
              <button className="link" disabled={!since}
                onClick={() => run(() => post('/api/sync/folders/reread', { folder: f.name, since }), `Read again from ${fmtDate(since)} on the next refresh.`)
                  .then(() => setRereading(false))}>
                Read again from this date
              </button>
              <button className="link" onClick={() => setRereading(false)}>Cancel</button>
            </span>
          ) : (
            <button className="link" onClick={() => { setRereading(true); setDone('') }}>Missed something? Read it again</button>
          )}
        </div>
      )}
      {done && <small className="folder-done">{done}</small>}
      {error && <small className="danger-link">{error}</small>}
    </li>
  )
}

export default function OutlookFolders() {
  const { data, error, reload } = useApi<{ folders: FolderInfo[] }>('/api/sync/folders')
  const box = useRef<HTMLElement>(null)
  const loaded = !!data
  useEffect(() => {
    if (!loaded || !/folders/.test(window.location.hash)) return
    // once, after the sections above it have loaded, so it isn't pushed back down (not again after each change)
    const t = setTimeout(() => box.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 600)
    return () => clearTimeout(t)
  }, [loaded])
  // The order is set when the list first loads and kept while you change folders: a folder that moved to another
  // group on each change would jump away, and the page would follow it.
  const order = useRef<string[]>([])
  if (!data) return <Loading error={error} />
  const top = (name: string) => ['Inbox', 'Sent Items'].indexOf(name) + 1 || 9 // Inbox and Sent Items lead the list
  if (!order.current.length)
    order.current = [...data.folders].sort((a, b) => top(a.name) - top(b.name) || ORDER[a.plan] - ORDER[b.plan] || a.name.localeCompare(b.name)).map((f) => f.name)
  const rank = (name: string) => (order.current.includes(name) ? order.current.indexOf(name) : order.current.length)
  const folders = [...data.folders].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
  const n = (p: FolderInfo['plan']) => folders.filter((f) => f.plan === p).length
  return (
    <section className="outlook-folders" ref={box} id="outlook-folders">
      <h4>Your Outlook folders</h4>
      {folders.length === 0 ? (
        <p className="fine">These show after your next refresh. The reader then learns which folders hold your recruiting email.</p>
      ) : (
        <>
          <p className="fine">
            On the next refresh: {n('full')} read in full, {n('screen')} checked (only emails that look like recruiting are opened),{' '}
            {n('skip')} skipped. A folder is skipped once three weeks of its email have had no recruiting in it, and is still
            checked about once a week. Change any folder below; your setting wins.
          </p>
          <ul className="folder-list">
            {folders.map((f) => <Folder key={f.name} f={f} onChanged={reload} />)}
          </ul>
        </>
      )}
    </section>
  )
}

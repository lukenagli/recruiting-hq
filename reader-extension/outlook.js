// Recruiting HQ Reader, Outlook page script. READ ONLY: it opens folders and emails by clicking them in the
// folder tree and message list (through rhqSafeClick) and reads the text Outlook shows. It never types, never
// presses keys, never opens a reply or compose box, and never clicks anything in an email.

const PANE_DATE = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{1,2}\/\d{1,2}\/\d{4}) (\d{1,2}:\d{2} [AP]M)/g
const MAX_OPEN = 60 // conversations opened per folder per refresh

function folderNode(name) {
  return [...document.querySelectorAll('[role="tree"] [role="treeitem"]')].find((t) => (t.getAttribute('title') || '').startsWith(`${name} - `))
}

// Never read: unsent or thrown-away mail, and Outlook's own system folders.
const SKIP_FOLDERS = new Set(['Drafts', 'Deleted Items', 'Junk Email', 'Archive', 'Outbox', 'Conversation History', 'Notes', 'RSS Feeds',
  'RSS Subscriptions', 'Sync Issues', 'Conflicts', 'Local Failures', 'Server Failures', 'Clutter', 'Scheduled'])

/** Unfold every collapsed folder (and the folders inside those), so subfolders like Recruiting > Goldman Sachs are read too. */
async function expandAll() {
  for (let pass = 0; pass < 4; pass++) {
    const closed = [...document.querySelectorAll('[role="tree"] [role="treeitem"][aria-expanded="false"]')]
      .filter((t) => !SKIP_FOLDERS.has((t.getAttribute('title') || '').replace(/ - [\d,]+ items?.*$/, '').trim()))
    if (!closed.length) return
    for (const t of closed) {
      if (rhqSafeExpand(t)) await rhqSleep(700)
    }
  }
}

/** Every mail folder shown in the folder list (everyone files mail differently), Inbox and Sent Items first.
 *  What isn't about banking recruiting or the finance club is dropped later, before anything is filed. */
function folders() {
  const names = [...document.querySelectorAll('[role="tree"] [role="treeitem"]')]
    .map((t) => (t.getAttribute('title') || '').replace(/ - [\d,]+ items?.*$/, '').trim())
    .filter((n) => n && !SKIP_FOLDERS.has(n))
  return [...new Set(['Inbox', 'Sent Items', ...names])]
}

/** Rough day of a list row ("11:14 AM" today, "Fri" this week, "Fri 10/16", "9/24/2026"), for skipping old rows fast. */
function rowDay(row) {
  const label = row.getAttribute('aria-label') || ''
  const now = new Date()
  let m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(label)
  if (m) return new Date(+m[3], +m[1] - 1, +m[2])
  m = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{1,2})\/(\d{1,2})\b/.exec(label)
  if (m) return new Date(now.getFullYear(), +m[1] - 1, +m[2])
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7) // today or this week: always open it
}

/** Exact time of a row's newest email, from the stamp Outlook puts on it ("Wed 10/28/2026 8:53 AM"), or '' (pinned rows). */
function rowTime(row) {
  const stamp = [...row.querySelectorAll('[title]')].map((t) => t.getAttribute('title') || '')
    .map((t) => /(\d{1,2}\/\d{1,2}\/\d{4}) (\d{1,2}:\d{2}\s*[AP]M)/i.exec(t)).find(Boolean)
  return stamp ? rhqIso(rhqParse(stamp[1], stamp[2])) : ''
}

/** The conversations in the open folder with mail newer than `since`, oldest first: the list (newest first) is
 *  scrolled down until it reaches mail from before the last refresh. Scrolling only; nothing is opened. */
async function newRows(since, sinceDay) {
  const found = new Map()
  const sc = listScroller()
  if (sc && sc.scrollTop) {
    sc.scrollTop = 0
    await rhqSleep(300)
  }
  for (let k = 0, stale = 0; k < 200 && stale < 3; k++) {
    let old = 0
    for (const row of document.querySelectorAll('[role="listbox"] [role="option"]')) {
      const id = row.getAttribute('data-convid')
      const label = row.getAttribute('aria-label') || ''
      const at = rowTime(row)
      if (!id || /\[draft\]/i.test(label)) continue // never open a draft: Outlook opens it for editing
      if (at ? at <= since : rowDay(row) < sinceDay) {
        if (!/^(?:\S+\s+)*?Pinned\b/.test(label)) old++ // a pinned email sits on top whatever its date
        continue
      }
      found.set(id, { at, label })
    }
    if (old >= 3 || !sc) break // newest first: everything further down is older
    if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 5) break // the whole folder is on screen
    const before = sc.scrollTop
    sc.scrollTop += sc.clientHeight * 0.8
    await rhqSleep(450)
    stale = sc.scrollTop === before ? stale + 1 : 0
  }
  return [...found].map(([id, r]) => ({ id, ...r })).sort((a, b) => a.at.localeCompare(b.at))
}

/** New mail in one folder, oldest first. At most MAX_OPEN conversations are opened per refresh; the rest are newer
 *  than everything filed this time, so the next refresh starts with them and nothing is skipped.
 *  `screen` (a regex) is for folders the student doesn't keep recruiting mail in: there an email is only opened when
 *  the sender, subject and preview Outlook shows mention a bank, the process or someone in their tracker. */
async function readFolder(name, since, patience = 10000, screen = null) {
  const node = folderNode(name)
  if (!node) return { items: [], more: 0, note: 'not in the folder list' }
  const firstId = () => document.querySelector('[role="listbox"] [role="option"]')?.getAttribute('data-convid') || ''
  const title = document.title
  const prev = firstId()
  const open = node.getAttribute('aria-selected') === 'true' // already showing (Inbox, when Outlook opens)
  const count = Number(((/ - ([\d,]+) items?/.exec(node.getAttribute('title') || '') || [])[1] || '0').replace(/,/g, '')) // as the folder list says
  if (!rhqSafeClick(node, 'outlook-folders')) return { items: [], more: 0, note: 'refused by the click guard' }
  // As long as Outlook takes to show the folder, and no longer: the tab title changes, then the list empties and
  // loads (about 1.5 s; much longer for the first folders while Outlook is still starting up).
  if (!open) await rhqWaitFor(() => document.title !== title || firstId() !== prev, 5000)
  await rhqWaitFor(() => firstId() && (open || firstId() !== prev), count ? patience : 2500)
  await rhqSleep(250)
  if (!firstId()) return { items: [], more: 0, note: count ? `its ${count} emails didn't load` : 'empty' }
  since = since || rhqIso(new Date(Date.now() - 14 * 864e5)) // no starting line: the last two weeks
  const all = await newRows(since, new Date(since.slice(0, 10) + 'T00:00:00'))
  const rows = screen ? all.filter((r) => screen.test(r.label)) : all
  const out = []
  for (const { id, at } of rows.slice(0, MAX_OPEN)) {
    const text = ((await openConversation(id)) || '').trim()
    if (!document.querySelector('[role="listbox"] [role="option"]')) {
      throw new Error("Outlook's reading pane is turned off, so emails open over the list. In Outlook, choose View > Layout > " +
                      'Reading pane > Show on the right, then refresh again.')
    }
    const dates = [...text.matchAll(PANE_DATE)].map((d) => rhqIso(rhqParse(d[1], d[2])))
    const when = at || dates.sort().slice(-1)[0]
    if (!when || when <= since) continue
    out.push({ key: `${id}|${when}`, at: when, author: '', text: text.slice(0, 8000) })
  }
  const more = Math.max(0, rows.length - MAX_OPEN)
  // A screened folder whose matching emails were all opened: everything up to its newest email has been looked at.
  const seenUntil = screen && !more ? all.map((r) => r.at).filter(Boolean).sort().slice(-1)[0] || '' : ''
  const note = `${all.length} new since ${since.slice(5, 16).replace('T', ' ')}` + (screen && all.length ? `, ${rows.length} about recruiting` : '')
  return { items: out, more, note, seen_until: seenUntil }
}

/** Emails scheduled to send, read from the Drafts list WITHOUT opening them (Outlook opens a draft for editing).
 *  Only rows Outlook marks [Scheduled]; unfinished drafts are left alone. The background opens Drafts by address. */
async function scheduled(since) {
  await rhqWaitFor(() => document.querySelector('[role="listbox"]'), 30000)
  await rhqSleep(2000)
  const out = []
  for (const row of document.querySelectorAll('[role="listbox"] [role="option"]')) {
    if (!/\[Scheduled\]/i.test(row.textContent)) continue // the marker is in the text, though not in the visible-text copy
    const text = row.innerText.replace(/\s+/g, ' ').replace(/\[Scheduled\]\s*/i, '').trim()
    const stamp = [...row.querySelectorAll('[title]')].map((t) => t.getAttribute('title') || '').find((t) => /\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2} [AP]M/.test(t))
    const m = stamp && /(\d{1,2}\/\d{1,2}\/\d{4}) (\d{1,2}:\d{2} [AP]M)/.exec(stamp)
    const at = m ? rhqIso(rhqParse(m[1], m[2])) : ''
    if (!at || (since && at <= since)) continue
    out.push({ key: `${row.getAttribute('data-convid') || text.slice(0, 80)}|scheduled|${at}`, at, author: '',
               text: `SCHEDULED EMAIL I wrote (it will send automatically; it is already taken care of): ${text}` })
  }
  return out
}

// ---- The one-time catch-up: thank-you emails the student already sent ----

const THANKS = /thank you again for (meeting|speaking)|thank you for (meeting|taking|speaking)|wanted to thank|want to thank|thanks again for/i

function listScroller() {
  const row = document.querySelector('[role="listbox"] [role="option"]')
  return row && row.closest('.customScrollBar')
}

function paneText() {
  const pane = document.querySelector('[aria-label="Reading Pane"], #ReadingPaneContainerId, [data-app-section="ReadingPane"]') || document.querySelector('[role="main"]')
  return pane ? pane.innerText : ''
}

/** Rows in the open folder that look like thank-yous, newest first, down to `sinceDay`. Scrolling only. */
async function thankYouRows(sinceDay) {
  const found = new Map()
  let stale = 0
  const sc = listScroller()
  if (!sc) return []
  sc.scrollTop = 0
  await rhqSleep(600)
  for (let k = 0; k < 300 && stale < 5; k++) {
    let older = false
    for (const row of document.querySelectorAll('[role="listbox"] [role="option"]')) {
      const label = (row.getAttribute('aria-label') || '').replace(/\s+/g, ' ')
      const id = row.getAttribute('data-convid')
      if (rowDay(row) < sinceDay) older = true
      if (id && THANKS.test(label) && !/draft/i.test(label) && rowDay(row) >= sinceDay) found.set(id, label)
    }
    if (older) break // newest first: everything below is from before the season
    const s = listScroller()
    const before = s.scrollTop
    s.scrollTop += s.clientHeight * 0.6
    await rhqSleep(450)
    stale = s.scrollTop === before ? stale + 1 : 0
  }
  return [...found]
}

/** Open one conversation from the list (the list is redrawn after each one, so it is found again from the top). */
async function openConversation(id) {
  const sc = listScroller()
  if (!sc) return null
  sc.scrollTop = 0
  await rhqSleep(500)
  for (let k = 0; k < 300; k++) {
    const row = [...document.querySelectorAll('[role="listbox"] [role="option"]')].find((r) => r.getAttribute('data-convid') === id)
    if (row) {
      const before = paneText()
      if (!rhqSafeClick(row, 'outlook-messages')) return null
      for (let w = 0; w < 20; w++) { // until the reading pane shows this conversation, not the last one
        await rhqSleep(400)
        if (paneText() !== before && paneText().length > 40) break
      }
      await rhqSleep(600)
      return paneText()
    }
    const s = listScroller()
    const top = s.scrollTop
    s.scrollTop += s.clientHeight * 0.6
    await rhqSleep(350)
    if (s.scrollTop === top) return null
  }
  return null
}

async function thankYous(since) {
  await rhqWaitFor(() => document.querySelector('[role="tree"] [role="treeitem"]'), 30000)
  const sinceDay = new Date(since.slice(0, 10) + 'T00:00:00')
  const list = folders()
  const rows = []
  for (const [i, name] of list.entries()) {
    chrome.runtime.sendMessage({ type: 'outlook-progress', i, n: list.length, name: `looking through ${name}` }).catch(() => undefined)
    const node = folderNode(name)
    if (!node || !rhqSafeClick(node, 'outlook-folders')) continue
    await rhqSleep(2500)
    for (const [id, label] of await thankYouRows(sinceDay)) rows.push([name, id, label])
  }
  const emails = []
  for (const [i, [name, id, label]] of rows.entries()) {
    chrome.runtime.sendMessage({ type: 'thanks-progress', i, n: rows.length }).catch(() => undefined)
    if (folderNode(name) && !document.title.startsWith(name)) {
      rhqSafeClick(folderNode(name), 'outlook-folders')
      await rhqSleep(2500)
    }
    const text = await openConversation(id)
    if (text) emails.push({ label, text: text.slice(0, 60000) })
  }
  return emails
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'outlook-thanks') {
    thankYous(msg.since).then((emails) => reply({ ok: true, emails })).catch((e) => reply({ ok: false, error: String(e) }))
    return true
  }
  if (msg.type === 'outlook-scheduled') {
    scheduled(msg.since).then((items) => reply({ ok: true, items })).catch((e) => reply({ ok: false, error: String(e) }))
    return true
  }
  if (msg.type !== 'outlook-collect') return
  ;(async () => {
    if (!(await rhqWaitFor(() => document.querySelector('[role="tree"] [role="treeitem"]'), 30000))) {
      throw new Error(`Outlook's folder list didn't show (window ${window.innerWidth}×${window.innerHeight}, ${document.visibilityState}), so nothing was read.`)
    }
    // While Outlook starts in a minimized window it is slow to draw its lists: wait until the folder it opened on
    // shows its emails (when it has any), so the first folders aren't read before Outlook is ready.
    const current = document.querySelector('[role="tree"] [role="treeitem"][aria-selected="true"]')
    if (/ - [1-9][\d,]* items?/.test((current && current.getAttribute('title')) || '')) {
      await rhqWaitFor(() => document.querySelector('[role="listbox"] [role="option"]'), 60000)
    }
    await expandAll()
    const batches = []
    const list = folders()
    // Read in full: Inbox, Sent Items, folders named after a bank or recruiting, and folders where recruiting news
    // was found before (msg.watch, from Recruiting HQ). Every other folder is still checked, but screened.
    let screen = null
    try {
      screen = msg.screen ? new RegExp(msg.screen, 'i') : null
    } catch {
      screen = null // an unreadable pattern: read everything in full, as before
    }
    const full = (name) => !screen || ['Inbox', 'Sent Items'].includes(name) || (msg.watch || []).includes(name) || screen.test(name)
    const screenFor = (name) => (full(name) ? null : screen)
    for (const name of list) {
      // Several Outlook tabs read side by side; each folder is read by whichever claims it first.
      // (With no answer from the background, as when this is the only tab, every folder is read here.)
      if (!(await chrome.runtime.sendMessage({ type: 'outlook-claim', name, n: list.length }).catch(() => true))) continue
      const since = msg.checkpoints[name] || msg.baseline
      const r = await readFolder(name, since, 10000, screenFor(name))
      batches.push({ source: 'outlook', conversation: name, group_chat: false, ...r })
    }
    // A folder whose list still didn't show gets one second, more patient try at the end.
    for (const b of batches.filter((b) => /didn't load/.test(b.note || ''))) {
      const again = await readFolder(b.conversation, msg.checkpoints[b.conversation] || msg.baseline, 45000, screenFor(b.conversation))
      b.items = again.items
      b.more = again.more
      b.seen_until = again.seen_until
      b.note = `${again.note} (second try)`
    }
    reply({ ok: true, batches })
  })().catch((e) => reply({ ok: false, error: String(e) }))
  return true
})

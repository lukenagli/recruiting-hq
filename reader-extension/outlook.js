// Recruiting HQ Reader, Outlook page script. READ ONLY: it opens folders and emails by clicking them in the
// folder tree and message list (through rhqSafeClick) and reads the text Outlook shows. It never types, never
// presses keys, never opens a reply or compose box, and never clicks anything in an email.

const PANE_DATE = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{1,2}\/\d{1,2}\/\d{4}) (\d{1,2}:\d{2} [AP]M)/g
const MAX_PER_FOLDER = 25

function folderNode(name) {
  return [...document.querySelectorAll('[role="tree"] [role="treeitem"]')].find((t) => (t.getAttribute('title') || '').startsWith(`${name} - `))
}

// Never read: unsent or thrown-away mail, and Outlook's own system folders.
const SKIP_FOLDERS = new Set(['Drafts', 'Deleted Items', 'Junk Email', 'Archive', 'Outbox', 'Conversation History', 'Notes', 'RSS Feeds',
  'RSS Subscriptions', 'Sync Issues', 'Conflicts', 'Local Failures', 'Server Failures', 'Clutter', 'Scheduled'])

/** Every mail folder shown in the folder list (everyone files mail differently), Inbox and Sent Items first.
 *  What isn't about banking recruiting or the finance club is dropped later, before anything is filed. */
function folders() {
  const names = [...document.querySelectorAll('[role="tree"] [role="treeitem"]')]
    .map((t) => (t.getAttribute('title') || '').replace(/ - \d+ items?.*$/, '').trim())
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

async function readFolder(name, since) {
  const node = folderNode(name)
  if (!node || !rhqSafeClick(node, 'outlook-folders')) return []
  await rhqSleep(2500)
  await rhqWaitFor(() => document.querySelector('[role="listbox"] [role="option"]'))
  const sinceDay = since ? new Date(since.slice(0, 10) + 'T00:00:00') : null
  const out = []
  const rows = [...document.querySelectorAll('[role="listbox"] [role="option"]')].slice(0, MAX_PER_FOLDER)
  for (const row of rows) {
    if (sinceDay && rowDay(row) < sinceDay) break // newest first: everything below is older
    if (/\bdraft\b/i.test(row.getAttribute('aria-label') || '')) continue // never open a draft: Outlook opens it for editing
    if (!rhqSafeClick(row, 'outlook-messages')) continue
    await rhqSleep(1800)
    const pane = document.querySelector('[aria-label="Reading Pane"], #ReadingPaneContainerId, [data-app-section="ReadingPane"]') || document.querySelector('[role="main"]')
    const text = (pane ? pane.innerText : '').trim()
    const dates = [...text.matchAll(PANE_DATE)].map((d) => rhqIso(rhqParse(d[1], d[2])))
    if (!dates.length) continue
    const latest = dates.sort().slice(-1)[0]
    if (since && latest <= since) continue
    const subject = (text.split('\n').find((l) => l.trim()) || '').slice(0, 200)
    out.push({ key: `${row.getAttribute('data-convid') || subject}|${latest}`, at: latest, author: '', text: text.slice(0, 8000) })
  }
  return out
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
    await rhqWaitFor(() => document.querySelector('[role="tree"] [role="treeitem"]'), 30000)
    const batches = []
    const list = folders()
    for (const [i, name] of list.entries()) {
      chrome.runtime.sendMessage({ type: 'outlook-progress', i, n: list.length, name }).catch(() => undefined)
      const since = msg.checkpoints[name] || msg.baseline
      const items = await readFolder(name, since)
      batches.push({ source: 'outlook', conversation: name, group_chat: false, items })
    }
    reply({ ok: true, batches })
  })().catch((e) => reply({ ok: false, error: String(e) }))
  return true
})

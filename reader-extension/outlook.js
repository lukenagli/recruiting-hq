// Recruiting HQ Reader, Outlook page script. READ ONLY: it opens folders and emails by clicking them in the
// folder tree and message list (through rhqSafeClick) and reads the text Outlook shows. It never types, never
// presses keys, never opens a reply or compose box, and never clicks anything in an email.

const PANE_DATE = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\d{1,2}\/\d{1,2}\/\d{4}) (\d{1,2}:\d{2} [AP]M)/g
const MAX_PER_FOLDER = 25

function folderNode(name) {
  return [...document.querySelectorAll('[role="tree"] [role="treeitem"]')].find((t) => (t.getAttribute('title') || '').startsWith(`${name} - `))
}

/** The folders to read: Inbox, Sent Items, Recruiting and everything listed under it. */
function folders() {
  const names = [...document.querySelectorAll('[role="tree"] [role="treeitem"]')].map((t) => (t.getAttribute('title') || '').replace(/ - \d+ items?.*$/, ''))
  const start = names.indexOf('Recruiting')
  const under = []
  for (let i = start + 1; start >= 0 && i < names.length; i++) {
    if (['Personal', 'Drafts', 'Sent Items', 'Deleted Items', 'Archive', 'Junk Email', 'Conversation History', 'Notes', 'Other'].includes(names[i])) break
    under.push(names[i])
  }
  return ['Inbox', 'Sent Items', ...(start >= 0 ? ['Recruiting', ...under] : [])]
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
    if (/draft/i.test(row.getAttribute('aria-label') || '')) continue // never open a draft: Outlook opens it for editing
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

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type !== 'outlook-collect') return
  ;(async () => {
    await rhqWaitFor(() => document.querySelector('[role="tree"] [role="treeitem"]'), 30000)
    const batches = []
    for (const name of folders()) {
      const since = msg.checkpoints[name] || msg.baseline
      const items = await readFolder(name, since)
      batches.push({ source: 'outlook', conversation: name, group_chat: false, items })
    }
    reply({ ok: true, batches })
  })().catch((e) => reply({ ok: false, error: String(e) }))
  return true
})

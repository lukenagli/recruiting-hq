// Recruiting HQ Reader, background. Only when the student asks (Refresh on the site, or Sync now in this window) it
// collects what's new in Outlook (email and calendar) through the read-only page scripts, and hands it to the
// student's Recruiting HQ account. It never runs on a timer, so tabs only open while the student is waiting for them.
// It only ever talks to recruiting-hq.onrender.com. Nothing here can send, reply to or react to an email.

const API = 'https://recruiting-hq.onrender.com'
// The network lock, the second guard behind the page scripts (which can't type, press keys or click anything but a
// folder, an email in the list or the calendar's week arrows): while the reader works, Chrome blocks every request
// that could send, reply, forward, respond to an invite, react, send a read receipt, or change, move or delete mail.
// It covers the reader's own tabs, and Outlook's service worker too (it fetches for Outlook's pages but belongs to no
// tab), so a request can't get out that way either. Rules only ever block.
const OUTLOOK_LOCK = ['action=CreateItem', 'action=SendItem', 'action=UpdateItem', 'action=DeleteItem', 'action=MoveItem', 'action=CopyItem',
  'action=CreateResponse', 'action=ApplyConversationAction', 'action=Send', 'action=Respond', 'action=Reply', 'action=Forward',
  'action=React', 'action=Like', 'action=Mark', 'action=SetFlag', 'action=Post', 'action=Update', 'action=Delete', 'action=Move',
  'reaction', 'readreceipt', 'meetingresponse', '/send', '/reply', '/forward', 'sendmail', 'createreply', 'createforward']
const OUTLOOK_SITES = ['outlook.cloud.microsoft', 'outlook.office.com', 'outlook.office365.com']
const WORKER_RULES = 20000000 // rule ids for the service worker's lock, above every tab's (tab ids map below 10,000,000)

async function lockTab(tabId, filters) {
  const base = (tabId % 100000) * 100
  const ids = filters.map((_, i) => base + i + 1)
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: ids,
    addRules: filters.map((urlFilter, i) => ({
      id: ids[i],
      priority: 1,
      action: { type: 'block' },
      condition: { tabIds: [tabId], urlFilter, isUrlFilterCaseSensitive: false },
    })),
  })
  await lockIsOn(ids)
}

/** Fail closed: the tab is only given its address once Chrome confirms every rule is in place. */
async function lockIsOn(ids) {
  const on = new Set((await chrome.declarativeNetRequest.getSessionRules()).map((r) => r.id))
  if (!ids.every((id) => on.has(id))) throw new Error("the network lock couldn't be turned on, so nothing was opened or read.")
}

/** The lock for requests that belong to no tab (tab id -1) and come from Outlook: its service worker's. On for the
 *  whole refresh; while it is on, your own Outlook tabs in Chrome can't send either. */
async function lockWorkers() {
  const ids = OUTLOOK_LOCK.map((_, i) => WORKER_RULES + i + 1)
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: ids,
    addRules: OUTLOOK_LOCK.map((urlFilter, i) => ({
      id: ids[i],
      priority: 1,
      action: { type: 'block' },
      condition: { tabIds: [-1], initiatorDomains: OUTLOOK_SITES, urlFilter, isUrlFilterCaseSensitive: false },
    })),
  })
  await lockIsOn(ids)
}

async function unlockWorkers() {
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: OUTLOOK_LOCK.map((_, i) => WORKER_RULES + i + 1) })
}

// Every request the lock stops during a refresh, counted by rule (Chrome tells an installed-from-folder extension of
// each one as it happens; its own record only keeps the last five minutes).
const lockName = (id) => OUTLOOK_LOCK[id >= WORKER_RULES ? id - WORKER_RULES - 1 : (id % 100) - 1] || 'a request'
let caught = null
chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener((info) => {
  if (!caught) return
  const name = lockName(info.rule.ruleId)
  caught[name] = (caught[name] || 0) + 1
})

/** What the lock stopped since `since` (ms), as a line for the report: proof it was on, and of anything it caught. */
async function lockReport(since) {
  let seen = caught
  if (!chrome.declarativeNetRequest.onRuleMatchedDebug) {
    const out = await chrome.declarativeNetRequest.getMatchedRules({ minTimeStamp: since }).catch(() => null)
    if (!out) return 'Network lock: on the whole time.'
    seen = {}
    for (const m of out.rulesMatchedInfo) seen[lockName(m.rule.ruleId)] = (seen[lockName(m.rule.ruleId)] || 0) + 1
  }
  const n = Object.values(seen || {}).reduce((a, b) => a + b, 0)
  if (!n) return 'Network lock: on the whole time; nothing tried to send, reply, react or change any email.'
  return `Network lock: on the whole time, and it stopped ${n} request${n > 1 ? 's' : ''} Outlook made on its own while emails ` +
         `were opened (${Object.entries(seen).map(([k, c]) => `${k} ×${c}`).join(', ')}).`
}

async function unlockTab(tabId, filters) {
  const base = (tabId % 100000) * 100
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: filters.map((_, i) => base + i + 1) })
}

// The reader works in one ordinary Chrome window of its own, opened only when the student presses Refresh and closed
// when it's done. Chrome only draws windows that are on screen, and Outlook only fills in its lists as it draws them:
// minimized windows, small windows and windows left behind others each left things unread before, and two Outlook
// windows starting at once often left one of them without its folder list. So a refresh opens one window, as large as
// the student's own (more of each list shows at a time), in front, and reads everything in it.
let reader = null // { windows: [the window's id] }

async function openReader() {
  const all = await chrome.windows.getAll({ windowTypes: ['normal'] }).catch(() => [])
  const base = all.filter((w) => w.state !== 'minimized').sort((a, b) => b.width * b.height - a.width * a.height)[0]
  const width = Math.max(1100, (base && base.width) || 1440), height = Math.max(700, (base && base.height) || 900)
  const win = await chrome.windows.create({ url: 'about:blank', focused: true, state: 'normal', width, height,
                                            left: (base && base.left) || 0, top: (base && base.top) || 0 })
  const { readerWindows = [] } = await chrome.storage.session.get('readerWindows')
  await chrome.storage.session.set({ readerWindows: [...readerWindows, win.id] }) // see `ready` below
  // A window opened while another app is in front can land behind it: bring it forward once more.
  await chrome.windows.update(win.id, { focused: true, drawAttention: false }).catch(() => undefined)
  reader = { windows: [win.id] }
  return reader
}

async function closeReader() {
  const { readerWindows = [] } = await chrome.storage.session.get('readerWindows')
  for (const id of new Set([...((reader && reader.windows) || []), ...readerWindows])) await chrome.windows.remove(id).catch(() => undefined)
  await chrome.storage.session.set({ readerWindows: [] })
  reader = null
}

/** A page laid out for a narrow screen hides Outlook's folder list. Zoom that tab out (this tab only, per-tab zoom,
 *  which a page load resets) so it has a desktop-sized page again. Called after each page load, and whenever a page
 *  script reports it is narrower than that. */
async function fitPage(tabId) {
  const tab = await chrome.tabs.get(tabId)
  await chrome.tabs.setZoomSettings(tabId, { mode: 'automatic', scope: 'per-tab' })
  await chrome.tabs.setZoom(tabId, Math.max(0.5, Math.min(1, (tab.width || 1200) / 1200)))
}

// If a reader window ends up behind other windows it stops drawing too (the page scripts say so with each pause):
// it is brought back to the front, at most every 15 seconds. A page that reports itself narrow is zoomed out again.
const raisedAt = {}
async function keepInView(windowId) {
  if (Date.now() - (raisedAt[windowId] || 0) < 15000) return
  raisedAt[windowId] = Date.now()
  const { readerWindows = [] } = await chrome.storage.session.get('readerWindows')
  if (readerWindows.includes(windowId)) await chrome.windows.update(windowId, { focused: true }).catch(() => undefined)
}
const fittedAt = {}
async function keepWide(tabId) {
  if (Date.now() - (fittedAt[tabId] || 0) < 5000) return
  fittedAt[tabId] = Date.now()
  await fitPage(tabId).catch(() => undefined)
}

chrome.windows.onRemoved.addListener(async (id) => {
  const { readerWindows = [] } = await chrome.storage.session.get('readerWindows')
  if (readerWindows.includes(id)) await chrome.storage.session.set({ readerWindows: readerWindows.filter((w) => w !== id) })
})

// Each time Chrome starts this background, no refresh is running in it. So if Chrome stopped the last one partway,
// its windows are closed here and it no longer counts as running. Runs wait for this before they start.
const ready = (async () => {
  await unlockWorkers() // a refresh Chrome stopped partway never leaves your own Outlook tabs unable to send
  const { readerWindows = [] } = await chrome.storage.session.get('readerWindows')
  for (const id of readerWindows) await chrome.windows.remove(id).catch(() => undefined)
  await chrome.storage.session.set({ readerWindows: [] })
  const { running } = await chrome.storage.local.get('running')
  if (running) {
    await chrome.storage.local.set({ running: 0, progress: { pct: 100, label: 'Done' }, last: { at: new Date().toLocaleString(),
      lines: ['Chrome stopped the last refresh partway through. What it filed is kept; refresh again to read the rest.'] } })
  }
})().catch(() => undefined)

/** A tab in the reader's window with the network lock on before it loads anything. */
async function lockedTab(url, filters) {
  if (!reader) await openReader()
  const tab = await chrome.tabs.create({ windowId: reader.windows[0], url: 'about:blank', active: true })
  await lockTab(tab.id, filters)
  await chrome.tabs.update(tab.id, { url })
  return tab
}



// Earlier versions synced every 30 minutes; clear that timer if it is still set.
chrome.runtime.onInstalled.addListener(() => chrome.alarms?.clearAll())
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !['sync-now', 'capiq-now', 'thanks-now'].includes(msg.type)) return
  ;({ 'capiq-now': capiqAll, 'thanks-now': thanksAll }[msg.type] || syncAll)().then(() => reply({ ok: true }))
  return true
})

// Pauses for the page scripts (see rhqSleep in safe.js): timed here, where Chrome doesn't slow timers down.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || msg.type !== 'rhq-sleep') return
  if (msg.hidden && sender.tab) keepInView(sender.tab.windowId)
  if (msg.width && msg.width < 1000 && sender.tab) keepWide(sender.tab.id)
  setTimeout(() => reply(true), Math.max(0, Math.min(Number(msg.ms) || 0, 60000)))
  return true
})

async function api(path, body) {
  const { key } = await chrome.storage.local.get('key')
  if (!key) throw new Error('No reader key yet. Paste it in the extension window.')
  const res = await fetch(API + path, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`${path}: ${res.status} ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function loaded(tabId) {
  for (let i = 0; i < 120; i++) {
    const tab = await chrome.tabs.get(tabId)
    if (tab.status === 'complete') return
    await sleep(500)
  }
}

/** Ask a page script for something, retrying while it starts up. */
async function ask(tabId, msg) {
  for (let i = 0; i < 20; i++) {
    try {
      const out = await chrome.tabs.sendMessage(tabId, msg)
      if (out) return out
    } catch {
      /* page script not ready yet */
    }
    await sleep(1500)
  }
  return { ok: false, error: 'The page did not answer.' }
}

// Long jobs (reading all of Outlook) answer at once and send their result later in an 'rhq-result' message: Chrome
// stops this background when one request waits more than five minutes, which closed nothing and lost the run.
const waiting = new Map() // id -> { resolve, tabId }
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== chrome.runtime.id || msg.type !== 'rhq-result' || !waiting.has(msg.id)) return
  waiting.get(msg.id).resolve(msg.out)
  waiting.delete(msg.id)
})
// The reader's tab closed (the student closed the window, or Chrome did): stop waiting for it. What it read so far
// was handed over folder by folder and is filed as usual.
chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [id, w] of waiting) {
    if (w.tabId !== tabId) continue
    w.resolve({ ok: false, error: 'the reader window was closed before it finished; what it had read is filed.' })
    waiting.delete(id)
  }
})

async function askLong(tabId, msg) {
  const id = crypto.randomUUID()
  const result = new Promise((resolve) => waiting.set(id, { resolve, tabId }))
  const started = await ask(tabId, { ...msg, id })
  if (!started.started) {
    waiting.delete(id)
    return started.ok === false ? started : { ok: false, error: 'The page did not start reading.' }
  }
  const stop = sleep(20 * 60 * 1000).then(() => ({ ok: false, error: 'stopped answering after 20 minutes.' }))
  const out = await Promise.race([result, stop])
  waiting.delete(id)
  return out
}

/** How far along the run is, for the progress bar on the site: { pct: 0-100, label: what it is doing }. */
async function progress(pct, label) {
  await chrome.storage.local.set({ progress: { pct: Math.max(0, Math.min(100, Math.round(pct))), label } })
}

// The one-time thank-you catch-up reports each folder it looks through; the run maps that onto its share of the bar.
let outlookShare = null
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== chrome.runtime.id || msg.type !== 'outlook-progress' || !outlookShare) return
  const [from, to] = outlookShare
  progress(from + ((to - from) * msg.i) / Math.max(1, msg.n), `Reading Outlook: ${msg.name} (${msg.i + 1} of ${msg.n})`)
})

// How far the refresh has got, for the bar (Outlook is all it reads).
const WEIGHT = { outlook: 1 }
let share = {}
async function report(source, frac, label) {
  share[source] = frac
  await progress(100 * Object.entries(WEIGHT).reduce((s, [k, w]) => s + w * (share[k] || 0), 0), label)
}

// The Outlook page script claims each folder before reading it, so a refresh that has ended (outlookRun gone)
// stops it reading on.
let outlookRun = null // { claimed: Set of folder names, n: folders in the list }
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || msg.type !== 'outlook-claim') return
  if (!outlookRun) return reply(false) // no refresh running here any more: the tab stops reading
  const take = !outlookRun.claimed.has(msg.name)
  if (take) {
    outlookRun.claimed.add(msg.name)
    outlookRun.n = Math.max(outlookRun.n, Number(msg.n) || 1)
    report('outlook', (0.7 * (outlookRun.claimed.size - 1)) / outlookRun.n,
           `Reading Outlook: ${msg.name} (${outlookRun.claimed.size} of ${outlookRun.n} folders)`)
  }
  reply(take)
})

// Each folder as soon as a page has read it: filed in turn with everything else, so filing goes on while the other
// folders are still being read. Once the round is over (outlookRun gone) it is filed with the rest instead.
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || msg.type !== 'outlook-read') return
  if (!outlookRun) return reply(false)
  const { more, note, filing, ...batch } = msg.batch
  if (batch.items.length || batch.seen_until) fileSoon(outlookRun.filings, batch, outlookRun.lines)
  reply(true)
})

// Reading runs side by side, but what was read is still filed one batch at a time, so two batches never change
// the tracker at once. Once the day's AI allowance runs out, nothing more is sent: it is read again next time.
let filing = Promise.resolve()
let outOfAI = false
function file(batch, lines) {
  const run = filing.then(() => fileNow(batch, lines))
  filing = run.catch(() => undefined)
  return run
}

async function fileNow(batch, lines) {
  if (outOfAI || (!batch.items.length && !batch.seen_until)) return
  const { baseline } = await chrome.storage.local.get('baseline')
  try {
    const out = await api('/api/sync/ingest', { ...batch, baseline })
    if (batch.items.length) lines.push(`${batch.source} · ${batch.conversation}: ${out.new} new, ${out.filed} filed. ${out.note || ''}`.trim())
    return true
  } catch (e) {
    if (/ 429 /.test(String(e.message))) outOfAI = true
    throw e
  }
}

/** File a batch without waiting for it (it's added to `filings`, to wait for later); a failure is a line in the report.
 *  `then` runs only if it was filed (not when the AI allowance had already run out). */
function fileSoon(filings, batch, lines, then = () => undefined) {
  filings.push(file(batch, lines).then((filed) => filed && then()).catch((e) => {
    if (!/ 429 /.test(String(e.message))) lines.push(`Outlook ${batch.conversation}: ${e.message || e}`)
  }))
}

/** "2m 05s" */
function took(ms) {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

/** Now as a local timestamp like the page scripts give ("2026-11-02T13:05:00"). */
function localNow() {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19)
}

// Most students' calendars also hold classes, homework, personal plans and blocks of prep time. Only events that look
// like recruiting leave the browser: ones naming a bank, someone in the tracker or the process (the same screen the
// email folders use, from Recruiting HQ), recruiting words, or two people's names joined ("Luke Nagli / Sami
// Moufarrij", "Jane Lee <> John Kim"). Everything else is read on screen and dropped here.
const CALENDAR_WORDS = /coffee|\bchat\b|interview|super ?day|super ?week|networking|recruit|info(rmation)? session|first round|second round|hirevue|\bscreen(er|ing)?\b/i
const TWO_NAMES = /[A-Z][a-z'’-]+ [A-Z][a-z'’-]+\s*(\/|<>|<->|\||&|\+| x | and | - )\s*[A-Z][a-z'’-]+ [A-Z][a-z'’-]+/
// Holds are not chats. When asking a banker for a coffee chat, students offer three 90-minute windows and block them on
// their own calendar so nothing double-books; the chat itself is a separate, usually 30-minute meeting. A hold word in
// the title, or anything that runs 75 minutes or more without saying it is an event that runs long (a dinner, a
// superday, an interview, an info session...), is a hold and is never sent.
const HOLD_WORDS = /\b(holds?|on hold|block(ed|s)?|tentative|avail(able|ability)?|placeholder|offered|options?|tbd|tbc)\b/i
const LONG_BY_NATURE = /dinner|lunch|breakfast|brunch|super ?(day|week)|interview|assessment|info(rmation)? session|session|event|night|happy hour|mixer|reception|panel|presentation|workshop|networking|trek|conference|open house|fair|social|gala|summit|forum|case/i

/** "Title, 4:30 PM to 5:00 PM, Monday, ..." -> { title, minutes } (minutes 1440 for an all-day event). */
function eventShape(label) {
  const m = /(\d{1,2})[:.](\d{2})\s*([AP])?\.?M?\.?\s*(?:to|–|-)\s*(\d{1,2})[:.](\d{2})\s*([AP])?/i.exec(label)
  const title = label.split(/,\s*(?:\d{1,2}[:.]\d{2}|all[ -]day)/i)[0].trim()
  if (!m) return { title, minutes: /all[ -]day/i.test(label) ? 1440 : 0 }
  const clock = (h, mm, ap, fallback) => {
    let hour = Number(h) % 12
    if ((ap || fallback || '').toUpperCase() === 'P') hour += 12
    if (!ap && !fallback) hour = Number(h) // a 24-hour clock
    return hour * 60 + Number(mm)
  }
  const start = clock(m[1], m[2], m[3], m[6]), end = clock(m[4], m[5], m[6], m[3])
  return { title, minutes: (end - start + 1440) % 1440 || 1440 }
}

function isHold({ title, minutes }) {
  if (HOLD_WORDS.test(title)) return true
  return minutes >= 75 && !LONG_BY_NATURE.test(title)
}

const DAY = 864e5
const AHEAD_DAYS = 7 // upcoming chats: only the next week's (later invites come in when they're near)

/** The day an event is on, from its label ("..., Monday, November 2, 2026, ..."), as YYYY-MM-DD, or ''. */
function eventDay(label) {
  const m = /\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (20\d\d)\b/.exec(label)
  if (!m) return ''
  const month = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'].indexOf(m[1]) + 1
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

/** The calendar in the week view, which shows every event ("Luke Nagli / Sami Moufarrij - Coffee Chat, 4:30 PM to 5:00
 *  PM, Monday, November 2, 2026, place"): back to where this account's reading starts (its first sync: the start of
 *  the season) for the chats that already happened, and after that back to a week before the last read; ahead only
 *  AHEAD_DAYS for the chats coming up. Events already filed are remembered here, so only new or changed ones are sent
 *  (a rescheduled chat is a changed event). Returns once the calendar is read; its filing is added to `filings`, so the
 *  window goes on to the email folders without waiting for it. */
async function readCalendar(tab, screenSource, lines, baseline, filings) {
  const { calendarReadOn } = await chrome.storage.local.get('calendarReadOn')
  const today = localNow().slice(0, 10)
  const lastWeek = calendarReadOn && new Date(new Date(calendarReadOn).getTime() - 7 * DAY).toISOString().slice(0, 10)
  const from = [String(baseline || '').slice(0, 10), lastWeek || ''].sort().pop() || today // the later of the two
  const until = new Date(new Date(today).getTime() + AHEAD_DAYS * DAY).toISOString().slice(0, 10)
  const back = Math.max(0, Math.ceil((new Date(today) - new Date(from)) / (7 * DAY)))
  const out = await ask(tab.id, { type: 'outlook-calendar', back, ahead: 1 })
  if (!out.ok) return lines.push(`Outlook calendar: ${out.error}`)
  out.events = out.events.filter((e) => { const day = eventDay(e); return day && day >= from && day <= until })
  let screen = null
  try {
    screen = screenSource ? new RegExp(screenSource, 'i') : null
  } catch {
    screen = null
  }
  const looksLike = out.events.filter((e) => CALENDAR_WORDS.test(e) || TWO_NAMES.test(e) || (screen && screen.test(e)))
  const holds = looksLike.filter((e) => isHold(eventShape(e)))
  const recruiting = looksLike.filter((e) => !holds.includes(e))
  const { calendarSeen = [] } = await chrome.storage.local.get('calendarSeen')
  const fresh = recruiting.filter((e) => !calendarSeen.includes(e))
  lines.push(`Outlook calendar: ${out.events.length} events from ${from.slice(5)} to ${until.slice(5)}, ${recruiting.length} about recruiting` +
             (holds.length ? ` (and ${holds.length} time block${holds.length > 1 ? 's' : ''} held for offered times, left out)` : '') +
             `, ${fresh.length} new or changed.`)
  if (!fresh.length) return chrome.storage.local.set({ calendarReadOn: today })
  const at = localNow()
  fileSoon(filings, { source: 'outlook', conversation: 'Calendar', group_chat: false,
                      items: fresh.map((e) => {
                        const { minutes } = eventShape(e)
                        const length = minutes >= 1440 ? 'all day' : minutes ? `${minutes} minutes` : 'length not shown'
                        return { key: `calendar|${e}`, at, author: '', text: `CALENDAR EVENT on my Outlook calendar (${length}): ${e}` }
                      }) }, lines,
           () => chrome.storage.local.set({ calendarSeen: [...calendarSeen, ...fresh].slice(-1500), calendarReadOn: today })) // only once filed
}

/** Move the reader's tab to another Outlook page, by address. */
async function goTo(tab, url) {
  await chrome.tabs.update(tab.id, { url })
  await loaded(tab.id)
  await fitPage(tab.id)
}

/** One round of reading Outlook, in one tab: the calendar and the scheduled emails (first round only), then every
 *  folder's new mail, up to MAX_OPEN conversations a folder (oldest first), each folder filed as soon as it is read.
 *  Returns how many new conversations are still waiting (a long backlog, as on a student's first sync): the next round
 *  carries on from where this one filed to. */
async function syncOutlook(state, lines, first = true, last = true) {
  const filings = [] // filed one at a time (see file), while the tab goes on reading
  outlookRun = { claimed: new Set(), n: 1, filings, lines }
  const msg = { type: 'outlook-collect', checkpoints: state.checkpoints.outlook || {}, baseline: state.baseline,
                watch: (state.outlook || {}).watch || [], screen: (state.outlook || {}).screen || '' }
  const started = Date.now()
  let tab = null
  let result = null
  try {
    await report('outlook', 0, 'Opening Outlook')
    tab = await lockedTab(`https://outlook.cloud.microsoft/${first ? 'calendar/view/week' : 'mail/'}`, OUTLOOK_LOCK)
    await loaded(tab.id)
    await fitPage(tab.id)
    if (first) {
      try {
        await readCalendar(tab, (state.outlook || {}).screen || '', lines, state.baseline, filings)
      } catch (e) {
        lines.push(`Outlook calendar: ${e.message || e}`)
      }
      await goTo(tab, 'https://outlook.cloud.microsoft/mail/drafts')
      const conversation = 'Scheduled to send (Drafts)' // read from the Drafts list without opening them
      const sched = await ask(tab.id, { type: 'outlook-scheduled', since: (state.checkpoints.outlook || {})[conversation] || state.baseline })
      if (sched.ok) fileSoon(filings, { source: 'outlook', conversation, group_chat: false, items: sched.items }, lines)
      else lines.push(`Outlook scheduled: ${sched.error}`)
      await goTo(tab, 'https://outlook.cloud.microsoft/mail/')
    }
    await report('outlook', 0.05, 'Reading your Outlook folders')
    result = await askLong(tab.id, msg)
    if (!result.ok && /folder list didn't show|did not answer|did not start/.test(result.error || '')) {
      // Outlook now and then opens without its folder list: load the page once more and read it again.
      lines.push(`(Outlook opened without its folder list, so it was loaded again: ${result.error})`)
      await chrome.tabs.reload(tab.id)
      await loaded(tab.id)
      await fitPage(tab.id)
      result = await askLong(tab.id, msg)
    }
  } catch (e) {
    result = { ok: false, error: String(e.message || e) }
  } finally {
    outlookRun = null
    if (tab) {
      await chrome.tabs.remove(tab.id).catch(() => undefined)
      await unlockTab(tab.id, OUTLOOK_LOCK)
    }
    await closeReader() // reading is over: the window goes now, and filing carries on without it (a next round opens a new one)
  }
  const readIn = Date.now() - started
  const read = result && result.ok ? result.batches : []
  const waiting = read.reduce((n, b) => n + (b.more || 0), 0)
  if (!result || !result.ok) lines.push(`Outlook: ${(result && result.error) || 'nothing was read.'}`)
  if (read.length) {
    // What each folder showed, so a refresh that files nothing still says why.
    lines.push(`Outlook read ${read.length} folders: ` + read.map((b) => `${b.conversation} (${b.note || 'nothing new'})`).join('; '))
  }
  // What wasn't handed over while reading (a folder on its second try, or an Outlook tab left from an older reader).
  for (const { more, note, filing, ...b } of read) {
    if (!filing && (b.items.length || b.seen_until)) fileSoon(filings, b, lines)
  }
  for (const b of read) {
    if (b.more && last) lines.push(`Outlook ${b.conversation}: ${b.more} more new email${b.more > 1 ? 's' : ''}, read on the next refresh.`)
  }
  await report('outlook', 0.9, 'Filing the last of what Outlook had')
  await Promise.allSettled(filings)
  lines.push(`Outlook${first ? '' : ' catch-up round'} timing: read ${read.length} folders${first ? ' and the calendar' : ''} in ` +
             `${took(readIn)}; filing finished ${took(Date.now() - started - readIn)} after reading did.`)
  return waiting
}

/** Outlook, in as many rounds as it takes to catch up (a student's first sync reaches back to September), up to
 *  OUTLOOK_ROUNDS; each round starts from the checkpoints the last one filed to. */
const OUTLOOK_ROUNDS = 10
async function syncOutlookFully(state, lines) {
  let current = state
  try {
    for (let round = 0; round < OUTLOOK_ROUNDS; round++) {
      const waiting = await syncOutlook(current, lines, round === 0, round === OUTLOOK_ROUNDS - 1)
      if (!waiting || outOfAI) break
      await report('outlook', 0.5, `Catching up on older email: ${waiting} more conversations (round ${round + 2})`)
      current = { ...(await api('/api/sync/state')), baseline: state.baseline }
    }
  } finally {
    await closeReader() // in case a round stopped before its own close
  }
}

/** A Capital IQ page, read with the student's own Capital IQ sign-in. Plain GET requests only: nothing is opened,
 *  clicked or changed in Capital IQ. CapIQ only answers on the Yale network. */
async function capiqGet(url) {
  if (!url.startsWith('https://www.capitaliq.com/')) throw new Error('not a Capital IQ address')
  const res = await fetch(url, { method: 'GET', credentials: 'include' }) // follows CapIQ's own hops to the page
  return { final_url: res.url, html: await res.text() }
}

/** For each deal waiting on Capital IQ: fetch the pages Recruiting HQ asks for (its search, the deal's overview,
 *  then its tabs), handing back everything fetched so far each round, until it says it's done. */
async function syncCapIQ(lines) {
  const jobs = await api('/api/capiq/jobs')
  if (!jobs.length) return lines.push('Capital IQ: nothing waiting. Press "Pull from Capital IQ" on a deal first.')
  for (const [j, job] of jobs.entries()) {
    const pages = []
    let next = job.fetch
    let out = null
    for (let round = 0; round < 5 && next && next.length; round++) {
      for (const url of next.slice(0, 4)) {
        await progress(((j + (round + 1) / 6) / jobs.length) * 100, `Reading Capital IQ for ${job.title}`)
        pages.push({ url, ...(await capiqGet(url)) })
        await sleep(1000)
      }
      out = await api('/api/capiq/pages', { deal_id: job.deal_id, pages })
      next = out.done ? [] : out.fetch
    }
    lines.push(`Capital IQ · ${job.title}: ${(out && out.message) || 'stopped before finishing; try again.'}`)
  }
}

async function capiqAll() {
  await ready
  const { running } = await chrome.storage.local.get('running')
  if (running && Date.now() - running < 20 * 60 * 1000) return
  await chrome.storage.local.set({ running: Date.now(), progress: { pct: 0, label: 'Starting' } })
  const lines = []
  try {
    await syncCapIQ(lines)
  } catch (e) {
    lines.push(`Capital IQ: ${e.message || e}`)
  } finally {
    await chrome.storage.local.set({ running: 0, progress: { pct: 100, label: 'Done' },
                                     last: { at: new Date().toLocaleString(), lines: lines.length ? lines : ['Nothing new.'] } })
  }
}

// Outlook reports each thank-you it opens during the catch-up.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== chrome.runtime.id || msg.type !== 'thanks-progress') return
  progress(30 + (55 * msg.i) / Math.max(1, msg.n), `Reading thank-you emails (${msg.i + 1} of ${msg.n})`)
})

/** The one-time catch-up: every thank-you email the student sent this season, filed on the person it thanks.
 *  Read only, like a refresh: Outlook opens in a minimized window with the network lock on. No AI is used. */
async function thanksAll() {
  await ready
  const { running } = await chrome.storage.local.get('running')
  if (running && Date.now() - running < 20 * 60 * 1000) return
  await chrome.storage.local.set({ running: Date.now(), progress: { pct: 0, label: 'Opening Outlook' } })
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000)
  const lines = []
  let tab = null
  try {
    const state = await api('/api/sync/state')
    await lockWorkers()
    tab = await lockedTab('https://outlook.cloud.microsoft/mail/', OUTLOOK_LOCK)
    await loaded(tab.id)
    await fitPage(tab.id)
    outlookShare = [2, 30]
    const out = await askLong(tab.id, { type: 'outlook-thanks', since: state.season_start })
    outlookShare = null
    if (!out.ok) throw new Error(out.error)
    let saved = 0, already = 0
    const unmatched = []
    for (let i = 0; i < out.emails.length; i += 10) {
      await progress(85 + (15 * i) / Math.max(1, out.emails.length), 'Filing them on each person')
      const r = await api('/api/sync/thank-yous', { emails: out.emails.slice(i, i + 10) })
      saved += r.saved
      already += r.already
      unmatched.push(...r.unmatched)
    }
    lines.push(`Thank-you emails: ${saved} filed, ${already} already on file.` +
      (unmatched.length ? ` Not matched to anyone in your tracker: ${unmatched.slice(0, 8).join(', ')}.` : ''))
  } catch (e) {
    lines.push(`Thank-you catch-up: ${e.message || e}`)
  } finally {
    clearInterval(keepAlive)
    outlookShare = null
    if (tab) {
      await chrome.tabs.remove(tab.id).catch(() => undefined)
      await unlockTab(tab.id, OUTLOOK_LOCK)
    }
    await closeReader()
    await unlockWorkers().catch(() => undefined)
    await chrome.storage.local.set({ running: 0, progress: { pct: 100, label: 'Done' },
                                     last: { at: new Date().toLocaleString(), lines } })
  }
}

async function syncAll() {
  await ready
  const { running } = await chrome.storage.local.get('running')
  if (running && Date.now() - running < 20 * 60 * 1000) return // a sync is already going
  await chrome.storage.local.set({ running: Date.now(), progress: { pct: 0, label: 'Starting' } })
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000) // keep the background awake while working
  const lines = []
  share = {}
  outOfAI = false
  const started = Date.now()
  try {
    const state = await api('/api/sync/state')
    if (state.ai_left === 0) {
      return lines.push("Not started: today's AI allowance is used up, so nothing could be filed. Refresh again after midnight.")
    }
    // Where reading starts for a folder with no checkpoint: set when the key was first saved, or, on an account's first
    // sync, the start of fall recruiting (start_from), so a new student's whole season comes in.
    if (state.start_from) await chrome.storage.local.set({ baseline: state.start_from })
    state.baseline = (await chrome.storage.local.get('baseline')).baseline
    // Outlook only, in one window. Slack and WhatsApp had too little news to be worth reading.
    caught = {}
    await lockWorkers()
    await openReader()
    try {
      await syncOutlookFully(state, lines)
    } catch (e) {
      if (!/ 429 /.test(String(e.message))) lines.push(`Outlook: ${e.message || e}`)
    } finally {
      await report('outlook', 1, 'Outlook done')
    }
    lines.push(`The whole refresh took ${took(Date.now() - started)}.`)
    lines.push(await lockReport(started))
    if (outOfAI) { // the AI allowance ran out partway: what wasn't filed is read again next time
      lines.push("Stopped filing partway: today's AI allowance is used up. What wasn't filed is picked up on the next refresh.")
    }
  } catch (e) {
    lines.push(String(e.message || e))
  } finally {
    await closeReader()
    await unlockWorkers().catch(() => undefined)
    clearInterval(keepAlive)
    outlookShare = null
    outlookRun = null
    await chrome.storage.local.set({ running: 0, progress: { pct: 100, label: 'Done' },
                                     last: { at: new Date().toLocaleString(), lines: lines.length ? lines : ['Nothing new.'] } })
  }
}

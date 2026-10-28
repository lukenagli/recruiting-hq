// Recruiting HQ Reader, background. Only when the student asks (Refresh on the site, or Sync now in this window) it
// collects what's new from Outlook, Slack and WhatsApp through the read-only page scripts, and hands it to the
// student's Recruiting HQ account. It never runs on a timer, so tabs only open while the student is waiting for them.
// It only ever talks to recruiting-hq.onrender.com. Nothing here can send an email or a chat message.

const API = 'https://recruiting-hq.onrender.com'
// What to read (the Slack workspace and channels, the WhatsApp groups) is kept in the student's Recruiting HQ account,
// not in this code: config = { slack_team, slack_channels: [{ id, name, group }], whatsapp_chats: [name] }.
// Channels marked group are busy group chats, filed only for messages about the process.
// The network lock: in the tabs the reader opens, Chrome blocks every request that could send, reply, forward,
// react, delete, move or mark as read. Rules only ever block, and apply to the reader's own tabs, never to yours.
const OUTLOOK_LOCK = ['action=CreateItem', 'action=SendItem', 'action=UpdateItem', 'action=DeleteItem', 'action=MoveItem', 'action=CopyItem',
  'action=CreateResponse', 'action=ApplyConversationAction', 'reaction', '/send', '/reply', '/forward', 'sendmail', 'createreply', 'createforward']
const SLACK_LOCK = ['/api/chat.', '/api/reactions.', '/api/files.upload', '/api/files.complete', '/api/files.share', '/api/conversations.mark',
  '/api/conversations.join', '/api/conversations.open', '/api/pins.', '/api/stars.', '/api/drafts.', '/api/bookmarks.', '/api/calls.']

async function lockTab(tabId, filters) {
  const base = (tabId % 100000) * 100
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: filters.map((_, i) => base + i + 1),
    addRules: filters.map((urlFilter, i) => ({
      id: base + i + 1,
      priority: 1,
      action: { type: 'block' },
      condition: { tabIds: [tabId], urlFilter, isUrlFilterCaseSensitive: false },
    })),
  })
}

async function unlockTab(tabId, filters) {
  const base = (tabId % 100000) * 100
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: filters.map((_, i) => base + i + 1) })
}

/** A minimized window at a full desktop size. Created minimized, a window is small, and Outlook then lays itself out
 *  for a narrow screen with the folder list hidden; so it is opened at desktop size first and minimized at once. */
async function minimizedWindow(url) {
  const win = await chrome.windows.create({ url, focused: false, state: 'normal', width: 1440, height: 900 })
  await chrome.windows.update(win.id, { state: 'minimized' })
  return win
}

/** A tab with the network lock on before it loads anything, in a minimized window of its own so the student's
 *  windows never fill with tabs. Closing its only tab closes the window. */
async function lockedTab(url, filters) {
  const win = await minimizedWindow('about:blank')
  const tab = win.tabs[0]
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

// A refresh reads Outlook, Slack and WhatsApp side by side, so the bar shows how far all three have got together.
const WEIGHT = { outlook: 0.6, slack: 0.2, whatsapp: 0.2 }
let share = {}
async function report(source, frac, label) {
  share[source] = frac
  await progress(100 * Object.entries(WEIGHT).reduce((s, [k, w]) => s + w * (share[k] || 0), 0), label)
}

// Outlook is read by several tabs at once. Each folder goes to the first tab that claims it, so none is read twice.
const OUTLOOK_READERS = 3
let outlookRun = null // { claimed: Set of folder names, n: folders in the list }
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || msg.type !== 'outlook-claim' || !outlookRun) return
  const take = !outlookRun.claimed.has(msg.name)
  if (take) {
    outlookRun.claimed.add(msg.name)
    outlookRun.n = Math.max(outlookRun.n, Number(msg.n) || 1)
    report('outlook', (0.7 * (outlookRun.claimed.size - 1)) / outlookRun.n,
           `Reading Outlook: ${msg.name} (${outlookRun.claimed.size} of ${outlookRun.n} folders)`)
  }
  reply(take)
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
  } catch (e) {
    if (/ 429 /.test(String(e.message))) outOfAI = true
    throw e
  }
}

async function syncOutlook(state, lines) {
  outlookRun = { claimed: new Set(), n: 1 }
  // The first tab opens on Drafts, for the scheduled emails; the others open on the Inbox. All are opened by address.
  const tabs = []
  const msg = { type: 'outlook-collect', checkpoints: state.checkpoints.outlook || {}, baseline: state.baseline,
                watch: (state.outlook || {}).watch || [], screen: (state.outlook || {}).screen || '' }
  const pending = []
  let results
  try {
    await report('outlook', 0, 'Opening Outlook')
    for (let i = 0; i < OUTLOOK_READERS; i++) {
      tabs.push(await lockedTab(`https://outlook.cloud.microsoft/mail/${i ? '' : 'drafts'}`, OUTLOOK_LOCK))
    }
    results = await Promise.allSettled(tabs.map(async (tab, i) => {
      await loaded(tab.id)
      if (!i) { // scheduled emails: read from the Drafts list without opening them
        const conversation = 'Scheduled to send (Drafts)'
        const sched = await ask(tab.id, { type: 'outlook-scheduled', since: (state.checkpoints.outlook || {})[conversation] || state.baseline })
        if (sched.ok) pending.push(file({ source: 'outlook', conversation, group_chat: false, items: sched.items }, lines))
        else lines.push(`Outlook scheduled: ${sched.error}`)
      }
      return ask(tab.id, msg)
    }))
    results = results.map((r) => (r.status === 'fulfilled' ? r.value : { ok: false, error: String((r.reason && r.reason.message) || r.reason) }))
  } finally {
    outlookRun = null
    for (const tab of tabs) {
      await chrome.tabs.remove(tab.id).catch(() => undefined)
      await unlockTab(tab.id, OUTLOOK_LOCK)
    }
  }
  const read = results.filter((r) => r.ok).flatMap((r) => r.batches)
  for (const error of new Set(results.filter((r) => !r.ok).map((r) => r.error))) {
    lines.push(`Outlook${read.length ? ' (one of the reading tabs)' : ''}: ${error}`)
  }
  await Promise.all(pending) // the scheduled emails
  if (!read.length) return
  // What each folder showed, so a refresh that files nothing still says why.
  lines.push(`Outlook read ${read.length} folders: ` + read.map((b) => `${b.conversation} (${b.note || 'nothing new'})`).join('; '))
  // Newest mail first, so today's news is filed even if the day's allowance runs out partway.
  const newest = (b) => b.items.reduce((m, i) => (i.at > m ? i.at : m), '')
  const batches = read.filter((b) => b.items.length || b.seen_until).sort((a, b) => newest(b).localeCompare(newest(a)))
  for (const [i, { more, note, ...b }] of batches.entries()) {
    await report('outlook', 0.7 + (0.3 * i) / batches.length, `Filing what's new in ${b.conversation} (${i + 1} of ${batches.length})`)
    await file(b, lines)
    if (more) lines.push(`Outlook ${b.conversation}: ${more} more new email${more > 1 ? 's' : ''}, read on the next refresh.`)
  }
}

async function syncSlack(state, lines) {
  const { slack_team: team, slack_channels: picked = [] } = state.config || {}
  // Opened by address: the club's workspace when it is known, otherwise the one Slack opens by default.
  const tab = await lockedTab(team ? `https://app.slack.com/client/${team}` : 'https://app.slack.com/client', SLACK_LOCK)
  const pending = [] // filed in turn while the next channel is read
  try {
    await loaded(tab.id)
    const at = /\/client\/([A-Z0-9]+)/.exec((await chrome.tabs.get(tab.id)).url || '')
    const workspace = team || (at && at[1])
    if (!workspace) return lines.push('Slack: not signed in to Slack in Chrome.')
    // Channels picked by name are matched to the sidebar; one the student hasn't joined can't be read.
    const listed = picked.some((c) => !c.id) ? await ask(tab.id, { type: 'slack-channels' }) : { ok: true, channels: [] }
    const channels = []
    for (const c of picked) {
      const found = c.id ? c : ((listed.ok && listed.channels) || []).find((s) => s.name.toLowerCase() === c.name.toLowerCase())
      if (found) channels.push({ ...c, id: found.id })
      else lines.push(`Slack #${c.name}: not in your sidebar (join the channel in Slack to include it).`)
    }
    for (const [i, c] of channels.entries()) { // the channels only: direct messages are never read
      await report('slack', i / channels.length, `Reading Slack #${c.name.replace(/^#/, "")} (${i + 1} of ${channels.length})`)
      await chrome.tabs.update(tab.id, { url: `https://app.slack.com/client/${workspace}/${c.id}` }) // opened by address, no clicks
      await loaded(tab.id)
      const since = (state.checkpoints.slack || {})[c.name] || state.baseline
      const out = await ask(tab.id, { type: 'slack-collect', since })
      if (!out.ok) {
        lines.push(`Slack ${c.name}: ${out.error}`)
        continue
      }
      pending.push(file({ source: 'slack', conversation: c.name, group_chat: c.group, items: out.items }, lines))
    }
  } finally {
    await chrome.tabs.remove(tab.id)
    await unlockTab(tab.id, SLACK_LOCK)
  }
  await Promise.all(pending)
}

async function syncWhatsApp(state, lines) {
  const chats = (state.config || {}).whatsapp_chats || []
  if (!chats.length) return
  // WhatsApp Web runs in one tab at a time, and opening a second one would knock the student's offline. So the reader
  // reads their WhatsApp tab when it is open, and otherwise opens WhatsApp in a minimized window of its own (signed in
  // the way theirs is) and closes it afterwards.
  let [tab] = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' })
  let own = null
  const pending = [] // filed in turn while the next chat is read
  if (!tab) {
    own = await minimizedWindow('https://web.whatsapp.com/')
    tab = own.tabs[0]
    await loaded(tab.id)
  }
  try {
    for (const [i, chat] of chats.entries()) {
      await report('whatsapp', i / chats.length, `Reading WhatsApp: ${chat} (${i + 1} of ${chats.length})`)
      const since = (state.checkpoints.whatsapp || {})[chat] || state.baseline
      const out = await ask(tab.id, { type: 'whatsapp-collect', chat, since })
      if (!out.ok) {
        lines.push(`WhatsApp ${chat}: ${out.error}` + (own
          ? ' (If WhatsApp isn\'t linked in this Chrome, open web.whatsapp.com once and link your phone.)'
          : ' (Your WhatsApp tab was open before the Reader was updated: reload that tab once, then refresh again.)'))
        continue
      }
      pending.push(file({ source: 'whatsapp', conversation: chat, group_chat: true, items: out.items }, lines))
    }
  } finally {
    if (own) await chrome.windows.remove(own.id)
  }
  await Promise.all(pending)
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
  const { running } = await chrome.storage.local.get('running')
  if (running && Date.now() - running < 20 * 60 * 1000) return
  await chrome.storage.local.set({ running: Date.now(), progress: { pct: 0, label: 'Opening Outlook' } })
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000)
  const lines = []
  let tab = null
  try {
    const state = await api('/api/sync/state')
    tab = await lockedTab('https://outlook.cloud.microsoft/mail/', OUTLOOK_LOCK)
    await loaded(tab.id)
    outlookShare = [2, 30]
    const out = await ask(tab.id, { type: 'outlook-thanks', since: state.season_start })
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
    await chrome.storage.local.set({ running: 0, progress: { pct: 100, label: 'Done' },
                                     last: { at: new Date().toLocaleString(), lines } })
  }
}

async function syncAll() {
  const { running } = await chrome.storage.local.get('running')
  if (running && Date.now() - running < 20 * 60 * 1000) return // a sync is already going
  await chrome.storage.local.set({ running: Date.now(), progress: { pct: 0, label: 'Starting' } })
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000) // keep the background awake while working
  let lines = []
  share = {}
  outOfAI = false
  try {
    const state = await api('/api/sync/state')
    if (state.ai_left === 0) {
      return lines.push("Not started: today's AI allowance is used up, so nothing could be filed. Refresh again after midnight.")
    }
    state.baseline = (await chrome.storage.local.get('baseline')).baseline // set when the key was first saved
    // All three at once, each in its own minimized window; each keeps its own lines so the report reads in order.
    const steps = [['Outlook', 'outlook', syncOutlook], ['Slack', 'slack', syncSlack], ['WhatsApp', 'whatsapp', syncWhatsApp]]
    const each = await Promise.all(steps.map(async ([name, key, step]) => {
      const own = []
      try {
        await step(state, own)
      } catch (e) {
        if (!/ 429 /.test(String(e.message))) own.push(`${name}: ${e.message || e}`)
      } finally {
        await report(key, 1, `${name} done`)
      }
      return own
    }))
    lines = each.flat()
    if (outOfAI) { // the AI allowance ran out partway: what wasn't filed is read again next time
      lines.push("Stopped filing partway: today's AI allowance is used up. What wasn't filed is picked up on the next refresh.")
    }
  } catch (e) {
    lines.push(String(e.message || e))
  } finally {
    clearInterval(keepAlive)
    outlookShare = null
    outlookRun = null
    await chrome.storage.local.set({ running: 0, progress: { pct: 100, label: 'Done' },
                                     last: { at: new Date().toLocaleString(), lines: lines.length ? lines : ['Nothing new.'] } })
  }
}

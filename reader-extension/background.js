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

/** A tab with the network lock on before it loads anything, in a minimized window of its own so the student's
 *  windows never fill with tabs. Closing its only tab closes the window. */
async function lockedTab(url, filters) {
  const win = await chrome.windows.create({ url: 'about:blank', state: 'minimized', focused: false })
  const tab = win.tabs[0]
  await lockTab(tab.id, filters)
  await chrome.tabs.update(tab.id, { url })
  return tab
}


// Earlier versions synced every 30 minutes; clear that timer if it is still set.
chrome.runtime.onInstalled.addListener(() => chrome.alarms?.clearAll())
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !['sync-now', 'capiq-now'].includes(msg.type)) return
  ;(msg.type === 'capiq-now' ? capiqAll() : syncAll()).then(() => reply({ ok: true }))
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

// Outlook reports each folder it opens; the run maps that onto its share of the bar.
let outlookShare = null
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== chrome.runtime.id || msg.type !== 'outlook-progress' || !outlookShare) return
  const [from, to] = outlookShare
  progress(from + ((to - from) * msg.i) / Math.max(1, msg.n), `Reading Outlook: ${msg.name} (${msg.i + 1} of ${msg.n})`)
})

async function file(batch, lines) {
  if (!batch.items.length) return
  const { baseline } = await chrome.storage.local.get('baseline')
  const out = await api('/api/sync/ingest', { ...batch, baseline })
  lines.push(`${batch.source} · ${batch.conversation}: ${out.new} new, ${out.filed} filed. ${out.note || ''}`.trim())
}

async function syncOutlook(state, lines) {
  const tab = await lockedTab('https://outlook.cloud.microsoft/mail/drafts', OUTLOOK_LOCK)
  try {
    // Scheduled emails first: read from the Drafts list without opening them.
    await progress(1, 'Opening Outlook')
    await loaded(tab.id)
    const conversation = 'Scheduled to send (Drafts)'
    const sched = await ask(tab.id, { type: 'outlook-scheduled', since: (state.checkpoints.outlook || {})[conversation] || state.baseline })
    if (sched.ok) await file({ source: 'outlook', conversation, group_chat: false, items: sched.items }, lines)
    else lines.push(`Outlook scheduled: ${sched.error}`)
    await chrome.tabs.update(tab.id, { url: 'https://outlook.cloud.microsoft/mail/' }) // opened by address, no clicks
    await progress(5, 'Reading Outlook')
    await loaded(tab.id)
    outlookShare = [5, 30]
    const out = await ask(tab.id, { type: 'outlook-collect', checkpoints: state.checkpoints.outlook || {}, baseline: state.baseline })
    outlookShare = null
    if (!out.ok) return lines.push(`Outlook: ${out.error}`)
    const batches = out.batches.filter((b) => b.items.length)
    for (const [i, b] of batches.entries()) {
      await progress(30 + (20 * i) / batches.length, `Filing what's new in ${b.conversation} (${i + 1} of ${batches.length})`)
      await file(b, lines)
    }
  } finally {
    await chrome.tabs.remove(tab.id)
    await unlockTab(tab.id, OUTLOOK_LOCK)
  }
}

async function syncSlack(state, lines) {
  const { slack_team: team, slack_channels: picked = [] } = state.config || {}
  // Opened by address: the club's workspace when it is known, otherwise the one Slack opens by default.
  const tab = await lockedTab(team ? `https://app.slack.com/client/${team}` : 'https://app.slack.com/client', SLACK_LOCK)
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
      await progress(50 + (25 * i) / channels.length, `Reading Slack #${c.name.replace(/^#/, "")} (${i + 1} of ${channels.length})`)
      await chrome.tabs.update(tab.id, { url: `https://app.slack.com/client/${workspace}/${c.id}` }) // opened by address, no clicks
      await loaded(tab.id)
      const since = (state.checkpoints.slack || {})[c.name] || state.baseline
      const out = await ask(tab.id, { type: 'slack-collect', since })
      if (!out.ok) {
        lines.push(`Slack ${c.name}: ${out.error}`)
        continue
      }
      await file({ source: 'slack', conversation: c.name, group_chat: c.group, items: out.items }, lines)
    }
  } finally {
    await chrome.tabs.remove(tab.id)
    await unlockTab(tab.id, SLACK_LOCK)
  }
}

async function syncWhatsApp(state, lines) {
  const chats = (state.config || {}).whatsapp_chats || []
  if (!chats.length) return
  // WhatsApp Web runs in one tab at a time, and opening a second one would knock the student's offline. So the reader
  // reads their WhatsApp tab when it is open, and otherwise opens WhatsApp in a minimized window of its own (signed in
  // the way theirs is) and closes it afterwards.
  let [tab] = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' })
  let own = null
  if (!tab) {
    own = await chrome.windows.create({ url: 'https://web.whatsapp.com/', state: 'minimized', focused: false })
    tab = own.tabs[0]
    await loaded(tab.id)
  }
  try {
    for (const [i, chat] of chats.entries()) {
      await progress(75 + (25 * i) / chats.length, `Reading WhatsApp: ${chat} (${i + 1} of ${chats.length})`)
      const since = (state.checkpoints.whatsapp || {})[chat] || state.baseline
      const out = await ask(tab.id, { type: 'whatsapp-collect', chat, since })
      if (!out.ok) {
        lines.push(`WhatsApp ${chat}: ${out.error}` + (own ? ' (If WhatsApp isn\'t linked in this Chrome, open web.whatsapp.com once and link your phone.)' : ''))
        continue
      }
      await file({ source: 'whatsapp', conversation: chat, group_chat: true, items: out.items }, lines)
    }
  } finally {
    if (own) await chrome.windows.remove(own.id)
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

async function syncAll() {
  const { running } = await chrome.storage.local.get('running')
  if (running && Date.now() - running < 20 * 60 * 1000) return // a sync is already going
  await chrome.storage.local.set({ running: Date.now(), progress: { pct: 0, label: 'Starting' } })
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000) // keep the background awake while working
  const lines = []
  try {
    const state = await api('/api/sync/state')
    state.baseline = (await chrome.storage.local.get('baseline')).baseline // set when the key was first saved
    for (const [name, step, start] of [['Outlook', syncOutlook, 0], ['Slack', syncSlack, 50], ['WhatsApp', syncWhatsApp, 75]]) {
      try {
        await progress(start, `Opening ${name}`)
        await step(state, lines)
      } catch (e) {
        lines.push(`${name}: ${e.message || e}`)
      }
    }
  } catch (e) {
    lines.push(String(e.message || e))
  } finally {
    clearInterval(keepAlive)
    outlookShare = null
    await chrome.storage.local.set({ running: 0, progress: { pct: 100, label: 'Done' },
                                     last: { at: new Date().toLocaleString(), lines: lines.length ? lines : ['Nothing new.'] } })
  }
}

// Recruiting HQ Reader, background. Every 30 minutes (and on "Sync now") it collects what's new from Outlook,
// Slack and WhatsApp through the read-only page scripts, and hands it to the student's Recruiting HQ account.
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

/** A background tab with the network lock on before it loads anything. */
async function lockedTab(url, filters) {
  const tab = await chrome.tabs.create({ url: 'about:blank', active: false })
  await lockTab(tab.id, filters)
  await chrome.tabs.update(tab.id, { url })
  return tab
}


chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('sync', { periodInMinutes: 30 }))
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('sync', { periodInMinutes: 30 }))
chrome.alarms.onAlarm.addListener((a) => a.name === 'sync' && syncAll())
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || msg.type !== 'sync-now') return
  syncAll().then(() => reply({ ok: true }))
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
    await loaded(tab.id)
    const conversation = 'Scheduled to send (Drafts)'
    const sched = await ask(tab.id, { type: 'outlook-scheduled', since: (state.checkpoints.outlook || {})[conversation] || state.baseline })
    if (sched.ok) await file({ source: 'outlook', conversation, group_chat: false, items: sched.items }, lines)
    else lines.push(`Outlook scheduled: ${sched.error}`)
    await chrome.tabs.update(tab.id, { url: 'https://outlook.cloud.microsoft/mail/' }) // opened by address, no clicks
    await loaded(tab.id)
    const out = await ask(tab.id, { type: 'outlook-collect', checkpoints: state.checkpoints.outlook || {}, baseline: state.baseline })
    if (!out.ok) return lines.push(`Outlook: ${out.error}`)
    for (const b of out.batches) await file(b, lines)
  } finally {
    await chrome.tabs.remove(tab.id)
    await unlockTab(tab.id, OUTLOOK_LOCK)
  }
}

async function syncSlack(state, lines) {
  const { slack_team: team, slack_channels: channels = [] } = state.config || {}
  if (!team || !channels.length) return lines.push('Slack: no channels set up yet.')
  const tab = await lockedTab(`https://app.slack.com/client/${team}/${channels[0].id}`, SLACK_LOCK)
  try {
    await loaded(tab.id)
    const dms = await ask(tab.id, { type: 'slack-dms' })
    const convos = [...channels, ...((dms.ok && dms.dms) || []).map((d) => ({ id: d.id, name: `DM with ${d.name}`, group: false }))]
    for (const c of convos) {
      await chrome.tabs.update(tab.id, { url: `https://app.slack.com/client/${team}/${c.id}` }) // opened by address, no clicks
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
  // WhatsApp Web only runs in one tab at a time, so the reader uses yours and skips WhatsApp if it isn't open.
  const [tab] = await chrome.tabs.query({ url: 'https://web.whatsapp.com/*' })
  if (!tab) return lines.push('WhatsApp: skipped (open web.whatsapp.com in Chrome to include it).')
  for (const chat of (state.config || {}).whatsapp_chats || []) {
    const since = (state.checkpoints.whatsapp || {})[chat] || state.baseline
    const out = await ask(tab.id, { type: 'whatsapp-collect', chat, since })
    if (!out.ok) {
      lines.push(`WhatsApp ${chat}: ${out.error}`)
      continue
    }
    await file({ source: 'whatsapp', conversation: chat, group_chat: true, items: out.items }, lines)
  }
}

async function syncAll() {
  const { running } = await chrome.storage.local.get('running')
  if (running && Date.now() - running < 20 * 60 * 1000) return // a sync is already going
  await chrome.storage.local.set({ running: Date.now() })
  const keepAlive = setInterval(() => chrome.runtime.getPlatformInfo(), 20000) // keep the background awake while working
  const lines = []
  try {
    const state = await api('/api/sync/state')
    state.baseline = (await chrome.storage.local.get('baseline')).baseline // set when the key was first saved
    for (const [name, step] of [['Outlook', syncOutlook], ['Slack', syncSlack], ['WhatsApp', syncWhatsApp]]) {
      try {
        await step(state, lines)
      } catch (e) {
        lines.push(`${name}: ${e.message || e}`)
      }
    }
  } catch (e) {
    lines.push(String(e.message || e))
  } finally {
    clearInterval(keepAlive)
    await chrome.storage.local.set({ running: 0, last: { at: new Date().toLocaleString(), lines: lines.length ? lines : ['Nothing new.'] } })
  }
}

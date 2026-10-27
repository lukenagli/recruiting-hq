// Recruiting HQ Reader, Slack page script. READ ONLY and click-free: the background opens each channel or DM by
// its web address, and this script reads the messages on screen and scrolls the message list up for older ones.
// It never types, never presses keys, never touches the message box, and never clicks anything.

function messages() {
  const out = []
  let author = ''
  for (const m of document.querySelectorAll('[data-qa="message_container"]')) {
    const item = m.closest('[data-qa="virtual-list-item"]')
    const ts = item && item.getAttribute('data-item-key')
    if (!ts || !/^\d+\.\d+$/.test(ts)) continue
    const sender = m.querySelector('[data-qa="message_sender_name"]')
    if (sender) author = sender.innerText.trim() // later messages in a run by the same person omit the name
    const body = m.querySelector('[data-qa="message-text"]')
    const files = [...m.querySelectorAll('[data-qa="file_name"], .c-file__title')].map((f) => `[file: ${f.innerText.trim()}]`)
    const text = [body ? body.innerText.trim() : '', ...files].filter(Boolean).join(' ')
    if (text) out.push({ key: ts, at: rhqIso(new Date(parseFloat(ts) * 1000)), author, text })
  }
  return out
}

/** Every message newer than `since` (ISO), scrolling up until the list reaches it. */
async function collect(since) {
  await rhqWaitFor(() => document.querySelector('[data-qa="message_container"]'), 30000)
  await rhqSleep(1500)
  const seen = new Map()
  let stale = 0
  for (let i = 0; i < 60 && stale < 6; i++) {
    const before = seen.size
    for (const m of messages()) seen.set(m.key, m)
    const oldest = [...seen.values()].reduce((a, m) => (m.at < a ? m.at : a), '9999')
    if (oldest <= since) break
    const first = document.querySelector('[data-qa="message_container"]')
    if (first) first.scrollIntoView({ block: 'start' }) // scrolling only; Slack loads older messages above
    await rhqSleep(1500)
    stale = seen.size === before ? stale + 1 : 0
  }
  return [...seen.values()].filter((m) => m.at > since).sort((a, b) => a.at.localeCompare(b.at))
}

/** The 1:1 direct messages listed in the sidebar (ids start with D), read from the page. */
function directMessages() {
  return [...document.querySelectorAll('[data-qa-channel-sidebar-channel-id^="D"]')].map((e) => ({
    id: e.getAttribute('data-qa-channel-sidebar-channel-id'),
    name: e.innerText.trim().split('\n')[0],
  }))
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type === 'slack-dms') {
    rhqWaitFor(() => document.querySelector('[data-qa-channel-sidebar-channel-id]'), 30000).then(() => reply({ ok: true, dms: directMessages() }))
    return true
  }
  if (msg.type !== 'slack-collect') return
  collect(msg.since).then((items) => reply({ ok: true, items, title: document.title })).catch((e) => reply({ ok: false, error: String(e) }))
  return true
})

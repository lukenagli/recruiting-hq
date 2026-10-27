// Recruiting HQ Reader, WhatsApp page script. READ ONLY: it opens a group by clicking its name in the chat list
// (through rhqSafeClick, which only allows clicks inside the chat list), then reads the messages shown and
// scrolls the conversation up for older ones. It never types, never presses keys, never touches the message box.

const WA_HEAD = /^\[(\d{1,2}:\d{2}\s*[AP]M), (\d{1,2}\/\d{1,2}\/\d{4})\] ([^:]*): $/i

function openChat(name) {
  const title = [...document.querySelectorAll('#pane-side span[title]')].find((s) => s.getAttribute('title') === name)
  const row = title && (title.closest('[role="listitem"]') || title.closest('[role="row"]'))
  return row ? rhqSafeClick(row, 'whatsapp-chats') : false
}

function messages() {
  const out = []
  for (const el of document.querySelectorAll('#main .copyable-text[data-pre-plain-text]')) {
    const m = WA_HEAD.exec(el.getAttribute('data-pre-plain-text') || '')
    if (!m) continue
    const text = el.innerText.trim()
    const at = rhqIso(rhqParse(m[2], m[1]))
    if (text) out.push({ key: `${at}|${m[3]}|${text.slice(0, 60)}`, at, author: m[3].replace(/^\+\d[\d ()-]+$/, 'a classmate'), text })
  }
  return out
}

function scroller() {
  let el = document.querySelector('#main [role="row"]')
  while (el && !(el.scrollHeight > el.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement
  return el
}

async function collect(name, since) {
  await rhqWaitFor(() => document.querySelector('#pane-side'), 30000)
  if (!openChat(name)) return { ok: false, error: `Couldn't find the chat "${name}" in the chat list.` }
  const header = await rhqWaitFor(() => {
    const h = document.querySelector('#main header')
    return h && h.innerText.split('\n')[0] === name ? h : null
  })
  if (!header) return { ok: false, error: `The chat "${name}" didn't open.` }
  await rhqSleep(1500)
  const seen = new Map()
  let stale = 0
  for (let i = 0; i < 80 && stale < 6; i++) {
    const before = seen.size
    for (const m of messages()) seen.set(m.key, m)
    const oldest = [...seen.values()].reduce((a, m) => (m.at < a ? m.at : a), '9999')
    if (oldest <= since) break
    const sc = scroller()
    if (sc) sc.scrollTop = 0 // scrolling only; WhatsApp loads older messages above
    await rhqSleep(1800)
    stale = seen.size === before ? stale + 1 : 0
  }
  return { ok: true, items: [...seen.values()].filter((m) => m.at > since).sort((a, b) => a.at.localeCompare(b.at)) }
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.type !== 'whatsapp-collect') return
  collect(msg.chat, msg.since).then(reply).catch((e) => reply({ ok: false, error: String(e) }))
  return true
})

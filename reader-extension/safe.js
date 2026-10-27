// Recruiting HQ Reader: the ONLY way any of its page scripts may click.
//
// The reader must never send, reply, react or type anything. Page scripts only read text, scroll, and open a
// conversation or email by clicking it in a list, the same as clicking it to read it. This guard makes sure a click
// can only ever land on such a list item:
//   - the element must sit inside one of the allowed lists (Outlook's folder tree or message list, WhatsApp's chat
//     list), never inside a compose box, toolbar or message area;
//   - it must not be, or contain, a button, link, text box or anything editable;
//   - anything that looks like send / reply / forward / react is refused outright.
// scripts/check_reader.py fails the build if any page script clicks, types or submits outside this file.

const RHQ_ALLOWED_LISTS = {
  'outlook-folders': '[role="tree"]',
  'outlook-messages': '[role="listbox"]',
  'whatsapp-chats': '#pane-side',
}

const RHQ_FORBIDDEN = /send|reply|forward|react|compose|new message|new mail|post|submit|delete|archive|flag|pin|mute|call/i

function rhqSafeClick(el, listName) {
  const listSelector = RHQ_ALLOWED_LISTS[listName]
  if (!el || !listSelector) return false
  const list = el.closest(listSelector)
  if (!list) return false
  if (el.closest('[contenteditable="true"], textarea, input, footer, [role="textbox"], [role="toolbar"], [role="dialog"], form')) return false
  if (el.matches('button, a[href], input, textarea, [role="button"], [role="textbox"], [contenteditable="true"]')) return false
  if (el.querySelector('input, textarea, [contenteditable="true"], [role="textbox"]')) return false
  const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.getAttribute('data-testid') || ''}`
  if (listName === 'whatsapp-chats' ? /\bsend\b|\breply\b/i.test(label) : RHQ_FORBIDDEN.test(label.replace(/Collapsed|Expanded/g, ''))) return false
  el.click()
  return true
}

/** Wait until `test()` returns something truthy, checking every 250 ms, for at most `ms`. */
async function rhqWaitFor(test, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = test()
    if (v) return v
    await new Promise((r) => setTimeout(r, 250))
  }
  return null
}

const rhqSleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** "2026-10-19T15:17:00" (local time) from a Date. */
function rhqIso(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** Date from "10/19/2026" and "3:17 PM". */
function rhqParse(mdy, hm) {
  const [m, d, y] = mdy.split('/').map(Number)
  const t = /(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(hm || '')
  let h = t ? Number(t[1]) % 12 : 0
  if (t && /pm/i.test(t[3])) h += 12
  return new Date(y, m - 1, d, h, t ? Number(t[2]) : 0)
}

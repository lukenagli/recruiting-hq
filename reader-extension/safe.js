// Recruiting HQ Reader: the ONLY way any of its page scripts may click.
//
// The reader must never send, reply, react or type anything. Page scripts only read text, scroll, open a
// conversation or email by clicking it in a list, the same as clicking it to read it, unfold the earlier emails of the
// open conversation by their date (rhqSafeShowMessage), and turn the calendar's week (rhqSafeWeek). This guard makes
// sure a list click can only ever land on such a list item:
//   - the element must sit inside one of the allowed lists (Outlook's folder tree or message list), never inside a
//     compose box, toolbar or message area;
//   - it must not be, or contain, a button, link, text box or anything editable;
//   - anything that looks like send / reply / forward / react is refused outright.
// scripts/check_reader.py fails the build if any page script clicks, types or submits outside this file.

const RHQ_ALLOWED_LISTS = {
  'outlook-folders': '[role="tree"]',
  'outlook-messages': '[role="listbox"]',
}

const RHQ_FORBIDDEN = /send|reply|forward|react|compose|new message|new mail|post|submit|delete|archive|flag|pin|mute|call|draft/i

/** Tripwire: true when anything that could send is on screen (a compose or reply box, or a Send button): any editable
 *  area outside the search box counts. */
function rhqComposeOpen() {
  const editors = [...document.querySelectorAll('[contenteditable="true"], textarea, [role="textbox"]')]
  const sendButton = [...document.querySelectorAll('button, [role="button"]')].some((b) => /^send\b/i.test((b.getAttribute('aria-label') || b.getAttribute('title') || '').trim()))
  return editors.some((e) => e.offsetParent !== null && !e.closest('[role="search"], [role="combobox"], header')) || sendButton
}

class RhqStop extends Error {}

function rhqSafeClick(el, listName) {
  if (rhqComposeOpen()) throw new RhqStop('Stopped: a compose or reply box was open, so the reader did nothing more.')
  const listSelector = RHQ_ALLOWED_LISTS[listName]
  if (!el || !listSelector) return false
  const list = el.closest(listSelector)
  if (!list) return false
  if (el.closest('[contenteditable="true"], textarea, input, footer, [role="textbox"], [role="toolbar"], [role="dialog"], form')) return false
  if (el.matches('button, a[href], input, textarea, [role="button"], [role="textbox"], [contenteditable="true"]')) return false
  const label = `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.getAttribute('data-testid') || ''}`
  if (listName === 'outlook-messages') {
    // A message row is the whole list item (Outlook gives it a conversation id). Its label is the email's own sender,
    // subject and preview, so words like "call" or "send" in it say nothing about the row; the only input a row
    // holds is Outlook's selection checkbox, which the click on the row itself doesn't touch. Drafts are never opened.
    if (!el.matches('[role="option"][data-convid]')) return false
    if (el.querySelector('textarea, [contenteditable="true"], [role="textbox"], input:not([type="checkbox"])')) return false
    if (/\[draft\]|^(?:(?:collapsed|expanded|unread|replied|forwarded|pinned|flagged|has attachments|important)\s+)*draft\b/i.test(label.trim())) return false
  } else {
    if (el.querySelector('input, textarea, [contenteditable="true"], [role="textbox"]')) return false
    if (RHQ_FORBIDDEN.test(label.replace(/Collapsed|Expanded/g, ''))) return false
  }
  el.click()
  return true
}

/** Move Outlook's calendar one week on ('next') or back ('previous'). The only thing it presses is the calendar's own
 *  "Go to next week" or "Go to previous week" arrow: an icon-only button outside any dialog, form or compose area.
 *  Changing which week is shown changes nothing. */
function rhqSafeWeek(direction) {
  if (rhqComposeOpen()) throw new RhqStop('Stopped: a compose or reply box was open, so the reader did nothing more.')
  const arrows = [...document.querySelectorAll('button, [role="button"]')]
    .filter((b) => new RegExp(`^go to ${direction === 'previous' ? 'previous' : 'next'} week\\b`, 'i').test((b.getAttribute('aria-label') || '').trim()))
  if (arrows.length !== 1) return false
  const arrow = arrows[0]
  if (arrow.closest('[role="dialog"], form, [contenteditable="true"], textarea, [role="textbox"]')) return false
  if (arrow.textContent.replace(/[-\s]/g, '')) return false // icon only (icon-font glyphs): any real text means it isn't the arrow
  if ([...arrow.querySelectorAll('*')].some((c) => !['SPAN', 'I', 'svg', 'path'].includes(c.tagName))) return false
  if (RHQ_FORBIDDEN.test(arrow.getAttribute('aria-label') || '')) return false
  arrow.click()
  return true
}

/** Open up a collapsed folder in Outlook's folder tree so its subfolders show (Outlook loads with them folded away).
 *  The only thing it presses is that folder's own expand arrow: the one icon-only button inside a collapsed tree item. */
function rhqSafeExpand(item) {
  if (rhqComposeOpen()) throw new RhqStop('Stopped: a compose or reply box was open, so the reader did nothing more.')
  if (!item || !item.matches('[role="tree"] [role="treeitem"][aria-expanded="false"]')) return false
  const arrows = item.querySelectorAll('button, [role="button"]')
  if (arrows.length !== 1) return false
  const arrow = arrows[0]
  // icon fonts draw the arrow with a private-use character; any real text means it isn't the arrow
  if (arrow.closest('[role="treeitem"]') !== item || arrow.textContent.replace(/[-\s]/g, '')) return false
  if ([...arrow.querySelectorAll('*')].some((c) => !['SPAN', 'I', 'svg', 'path'].includes(c.tagName))) return false
  if (RHQ_FORBIDDEN.test(`${arrow.getAttribute('aria-label') || ''} ${arrow.getAttribute('title') || ''}`)) return false
  arrow.click()
  return true
}

// The reading pane, where an opened conversation shows (never the message list or the folder tree).
const RHQ_READING_PANE = '#ReadingPaneContainerId, [aria-label="Reading Pane"]'
// An email's date as its header in a conversation shows it ("Wed 10/28/2026 9:03 AM"), and nothing else.
const RHQ_STAMP = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2}\/\d{1,2}\/\d{4}\s\d{1,2}:\d{2}\s?[AP]M$/i

/** Unfold one folded email in the open conversation so its whole text shows: Outlook shows only a thread's newest email
 *  in full and folds the earlier ones to a line or two. The only thing it presses is that email's date, plain text in
 *  its folded header (never a button, a link or the sender's name, which opens a contact card), which Outlook takes as
 *  "unfold". Unfolding an email changes nothing in it. */
function rhqSafeShowMessage(item) {
  if (rhqComposeOpen()) throw new RhqStop('Stopped: a compose or reply box was open, so the reader did nothing more.')
  if (!item || !item.matches('div[aria-expanded="false"]') || !item.closest(RHQ_READING_PANE)) return false
  if (item.closest('[role="listbox"], [role="tree"], [role="dialog"], [role="toolbar"], form, footer, [contenteditable="true"], textarea, [role="textbox"]')) return false
  if (item.querySelector('[contenteditable="true"], textarea, input, [role="textbox"]')) return false
  const dates = [...item.querySelectorAll('[role="heading"]')].filter((h) => !h.children.length && RHQ_STAMP.test(h.textContent.trim()))
  if (dates.length !== 1) return false
  const date = dates[0]
  if (date.closest('button, a[href], [role="button"], [role="link"], [role="menuitem"], [role="option"]')) return false
  date.click()
  return true
}

/** Wait until `test()` returns something truthy, checking every 250 ms, for at most `ms`. */
async function rhqWaitFor(test, ms = 15000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const v = test()
    if (v) return v
    await rhqSleep(250)
  }
  return null
}

/** Pause for `ms`. The reader's tabs sit in a minimized window, where Chrome slows a page's own timers to once a
 *  second (and later once a minute), so the pause is timed by the extension's background instead, which Chrome
 *  doesn't slow. Falls back to an ordinary timer if the background doesn't answer. */
function rhqSleep(ms) {
  // hidden: Chrome isn't drawing this page (its window is behind others), so the background brings it to the front;
  // width: a page narrower than a desktop one hides Outlook's folder list, so the background zooms it out
  return chrome.runtime.sendMessage({ type: 'rhq-sleep', ms, hidden: document.hidden, width: window.innerWidth }).catch(() => new Promise((r) => setTimeout(r, ms)))
}

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

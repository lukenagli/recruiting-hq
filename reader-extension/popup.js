// The extension's small window: save the reader key, start a sync, see what the last sync did.
const status = document.getElementById('status')

async function show() {
  const { last, running, key } = await chrome.storage.local.get(['last', 'running', 'key'])
  if (key) document.getElementById('key').placeholder = 'Key saved (paste a new one to replace it)'
  const busy = running && Date.now() - running < 20 * 60 * 1000
  status.textContent = (busy ? 'Syncing now…\n\n' : '') + (last ? `Last sync ${last.at}:\n${last.lines.join('\n')}` : 'No sync yet.')
}

document.getElementById('save').addEventListener('click', async () => {
  const field = document.getElementById('key')
  if (!field.value.trim()) return
  // The reader's starting line: everything before the first key was already filed by hand. Local time, like the messages.
  const { baseline } = await chrome.storage.local.get('baseline')
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const now = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  await chrome.storage.local.set({ key: field.value.trim(), baseline: baseline || now })
  field.value = ''
  show()
})

document.getElementById('sync').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'sync-now' })
  setTimeout(show, 300)
})

chrome.storage.onChanged.addListener(show)
show()

// Recruiting HQ Reader, on the Recruiting HQ site only. It lets the site's Refresh button start a read and show its
// progress: the page posts { source: 'rhq-page', type: 'ping' | 'sync' | 'status' } and gets back
// { source: 'rhq-reader', ... }. It reads nothing from the page and changes nothing on it.

function answer(body) {
  window.postMessage({ source: 'rhq-reader', ...body }, window.origin)
}

async function status() {
  const { last, running, key } = await chrome.storage.local.get(['last', 'running', 'key'])
  return { busy: !!(running && Date.now() - running < 20 * 60 * 1000), last: last || null, has_key: !!key }
}

window.addEventListener('message', async (e) => {
  if (e.source !== window || e.origin !== window.origin || !e.data || e.data.source !== 'rhq-page') return
  const { type } = e.data
  if (type === 'ping' || type === 'status') answer({ type: 'status', version: chrome.runtime.getManifest().version, ...(await status()) })
  if (type === 'sync') {
    chrome.runtime.sendMessage({ type: 'sync-now' })
    answer({ type: 'status', version: chrome.runtime.getManifest().version, ...(await status()), busy: true })
  }
})

chrome.storage.onChanged.addListener(async () => answer({ type: 'status', version: chrome.runtime.getManifest().version, ...(await status()) }))

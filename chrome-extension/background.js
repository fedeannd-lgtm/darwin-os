// ProspectOS background service worker
// All ProspectOS API calls are routed here from content scripts,
// so they run outside LinkedIn's page context (no CSP / mixed-content restrictions).

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== 'pos_fetch') return false;

  const { url, method = 'GET', body } = message;

  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  fetch(url, options)
    .then(async (res) => {
      let data = null;
      try { data = await res.json(); } catch {}
      sendResponse({ ok: res.ok, status: res.status, data });
    })
    .catch((err) => {
      sendResponse({ ok: false, status: 0, error: err.message });
    });

  return true; // keep channel open for async response
});

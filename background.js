chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !/^https:\/\/github\.com\/[^/]+\/[^/]+\/(issues|pull)\/\d+(?:[/?#]|$)/.test(tab.url || '')) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'toggle-gallery' });
  } catch {
    // Also works on GitHub tabs that were already open when the extension was installed/reloaded.
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['media-model.js', 'content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'toggle-gallery' });
  }
});

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'download-media' || sender.id !== chrome.runtime.id || !sender.tab?.url?.startsWith('https://github.com/')) return;
  let url;
  try { url = new URL(message.url); } catch { respond({ ok: false }); return; }
  if (!['https:', 'http:'].includes(url.protocol)) { respond({ ok: false }); return; }
  // Never pass page-owned paths to the downloads API as directories.
  const filename = String(message.filename || 'github-media').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/^\.+/, '').slice(0, 180) || 'github-media';
  chrome.downloads.download({ url: url.href, filename, conflictAction: 'uniquify' }).then(
    (id) => respond({ ok: true, id }),
    (error) => respond({ ok: false, error: error.message }),
  );
  return true;
});

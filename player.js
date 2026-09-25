// Plays gallery videos in an extension page. GitHub's page CSP limits media-src to a few hosts and
// omits release-assets.githubusercontent.com, where release downloads redirect, so an in-page <video> fails.
(() => {
  'use strict';
  const params = new URLSearchParams(location.hash.slice(1));
  const video = document.querySelector('video');
  const post = (type) => parent.postMessage({ source: 'ghmg-player', type }, 'https://github.com');
  let url;
  try { url = new URL(params.get('src')); } catch { post('error'); return; }
  if (url.protocol !== 'https:') { post('error'); return; }
  let resolved = false;
  // Matching the gallery's color scheme keeps the frame transparent instead of painting a white backdrop.
  document.documentElement.style.colorScheme = params.get('theme') === 'dark' ? 'dark' : 'light';
  video.setAttribute('aria-label', params.get('label') || 'Video');
  video.addEventListener('loadedmetadata', () => post('ready'));
  video.addEventListener('error', async () => {
    // Private repositories need the GitHub session to reach the signed asset URL; the background worker has it.
    if (!resolved) {
      resolved = true;
      try {
        const result = await chrome.runtime.sendMessage({ type: 'resolve-media', url: url.href });
        if (result?.ok && result.url !== url.href) { video.src = result.url; return; }
      } catch {}
    }
    post('error');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') post('close');
  });
  video.src = url.href;
})();

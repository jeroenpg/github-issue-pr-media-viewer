/* Shared DOM adapter. Loaded in the extension's isolated content-script world. */
(() => {
  'use strict';
  const BODY_SELECTOR = '.markdown-body';
  const clean = (value = '') => value.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const safeUrl = (value, base = location.href) => {
    if (!value || typeof value !== 'string') return '';
    try {
      const url = new URL(value, base);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  };
  const conversationPath = (path) => path.match(/^\/[^/]+\/[^/]+\/(issues|pull)\/\d+(?=\/|$)/)?.[0] || '';
  const mediaType = (url) => /\.(mp4|webm|mov|m4v|ogv)(?:[?#]|$)/i.test(url) ? 'video'
    : /\.(png|jpe?g|gif|webp|svg|avif|bmp)(?:[?#]|$)/i.test(url) ? 'image' : '';

  function captionFor(element) {
    const cell = element.closest('td,th');
    const table = cell?.closest('table');
    const column = cell && table ? table.querySelector('tr')?.children[cell.cellIndex]?.textContent : '';
    return clean(column || element.closest('figure')?.querySelector('figcaption')?.textContent || element.getAttribute('alt') || '');
  }

  function sourceFor(body, index, pagePath) {
    const container = body.closest('[data-testid="issue-body"]') || body.closest('.js-comment, .timeline-comment-group, [data-testid="issue-comment"], [data-testid^="comment-viewer-outer-box"], [data-testid="issue-body-viewer"], [id^="issuecomment-"], [id^="discussion_r"]') || body.parentElement;
    const anchor = [...container.querySelectorAll('a[href*="#issuecomment-"], a[href*="#discussion_r"], a[href*="#pullrequestreview-"], a[href*="#issue-"], .js-timestamp')].find((link) => !body.contains(link));
    const anchoredId = anchor?.hash?.slice(1);
    const id = anchoredId || container.id || container.dataset.testid || `source-${index}`;
    const bodyHint = body.closest('.js-command-palette-pull-body, .js-issue-body, [data-testid="issue-body"], [data-testid="issue-body-viewer"], [id^="issue-"], [id^="pullrequest-"]');
    const commentHint = /^(issuecomment-|discussion_r|pullrequestreview-)/.test(id) || body.closest('[data-testid="issue-comment"], [id^="issuecomment-"], [id^="discussion_r"], .review-comment');
    const isBody = Boolean(bodyHint) || (!commentHint && index === 0);
    const author = clean([...container.querySelectorAll('.author, a[data-hovercard-type="user"], [data-testid="issue-body-header-author"], [data-testid="avatar-link"]')].find((link) => !body.contains(link) && clean(link.textContent))?.textContent || '');
    const time = container.querySelector('relative-time, time');
    return {
      id, body, container, isBody,
      label: isBody ? (pagePath.includes('/pull/') ? 'PR body' : 'Issue body') : `Comment ${index}`,
      author: author.replace(/^@/, ''),
      time: time?.getAttribute('datetime') || '',
      href: `${location.origin}${pagePath}${id.startsWith('source-') ? '' : `#${id}`}`,
    };
  }

  function scan() {
    const pagePath = conversationPath(location.pathname);
    if (!pagePath) return [];
    const bodies = [...document.querySelectorAll(BODY_SELECTOR)].filter((body) =>
      !body.closest('#ghmg-root, .preview-content, .js-preview-body, [data-testid="markdown-preview"], [role="dialog"]') &&
      !body.parentElement?.closest(BODY_SELECTOR) &&
      Boolean(body.closest('main, .repository-content, #discussion_bucket')),
    );
    const items = [];
    bodies.forEach((body, index) => {
      const source = sourceFor(body, index, pagePath);
      const nodes = [...body.querySelectorAll('img, video, a[href]')];
      const seen = new Set();
      for (const node of nodes) {
        if (node.matches('a') && (node.querySelector('img,video') || node.closest('video'))) continue;
        if (node.matches('img') && node.matches('.emoji, .avatar, [data-view-component="true"].avatar')) continue;
        const href = node.closest('a[href]')?.href;
        const src = node.currentSrc || node.src || node.querySelector('source')?.src || node.getAttribute('data-src');
        const url = safeUrl(node.matches('a') ? node.href : (mediaType(href || '') === 'image' && node.matches('img') ? href : src || ''));
        const type = node.matches('video') ? 'video' : node.matches('img') ? 'image' : mediaType(url);
        if (!url || !type) continue;
        // Decoration and badges are excluded, but unloaded/lazy screenshots are still indexed.
        const canonical = node.getAttribute('data-canonical-src') || url;
        const width = Number(node.getAttribute('width')) || node.naturalWidth;
        const height = Number(node.getAttribute('height')) || node.naturalHeight;
        if (node.matches('img') && ((width && height && height <= 40) || /(?:shields\.io|badge\/|\/badge\/)/i.test(canonical))) continue;
        const key = `${type}:${url}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const caption = captionFor(node);
        let filename;
        try { filename = decodeURIComponent(new URL(url).pathname.split('/').pop()); } catch { filename = ''; }
        items.push({ key: `${source.id}:${key}`, element: node, url, type, source, caption, filename: filename || `github-media.${type === 'video' ? 'mp4' : 'png'}` });
      }
    });
    return items;
  }
  globalThis.GitHubGalleryModel = { scan, captionFor, sourceFor, conversationPath, safeUrl, mediaType };
})();

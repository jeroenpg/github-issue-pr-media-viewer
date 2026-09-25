(() => {
  'use strict';
  if (globalThis.__githubMediaGallery) return;
  globalThis.__githubMediaGallery = true;
  const model = globalThis.GitHubGalleryModel;
  const state = { open: false, all: [], items: [], key: '', filter: 'all', source: '', path: '', split: .44 };
  let host, ui, lastFocus, marked, scanTimer;
  const $ = (selector) => ui.querySelector(selector);
  const icons = {
    gallery: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="16" cy="8" r="1"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    left: '<path d="m14 6-6 6 6 6"/>', right: '<path d="m10 6 6 6-6 6"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
    locate: '<circle cx="12" cy="12" r="7"/><path d="M12 1v5m0 12v5M1 12h5m12 0h5"/>',
  };
  const icon = (name) => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
  const current = () => state.items.find((item) => item.key === state.key);
  const editable = (event) => event.composedPath().some((node) => node instanceof Element && node.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"]),video,[role="textbox"], [role="slider"]'));
  const pageTheme = () => {
    const root = document.documentElement;
    const explicit = root.getAttribute('data-color-mode') || root.getAttribute('data-theme') || document.body?.getAttribute('data-color-mode') || document.body?.getAttribute('data-theme');
    if (explicit === 'dark' || explicit === 'light') return explicit;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  };
  const syncTheme = () => { if (host) host.dataset.theme = pageTheme(); };

  function createUI() {
    host = document.createElement('aside');
    host.id = 'ghmg-root';
    host.setAttribute('aria-label', 'GitHub media gallery');
    host.hidden = true;
    ui = host.attachShadow({ mode: 'open' });
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = chrome.runtime.getURL('gallery.css');
    ui.append(style);
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.innerHTML = `
      <div class="resize" role="separator" tabindex="0" aria-label="Resize conversation" aria-orientation="vertical" aria-valuemin="28" aria-valuemax="65" aria-valuenow="44"></div>
      <header>
        <div class="brand">${icon('gallery')}<div><h2>Media gallery</h2><p class="repo"></p></div></div>
        <button class="icon-button" data-action="close" title="Close gallery (Esc)" aria-label="Close gallery">${icon('close')}</button>
      </header>
      <div class="filters">
        <div class="tabs" role="group" aria-label="Filter media">
          <button data-filter="all" aria-pressed="true">All media <span class="total"></span></button>
          <button data-filter="comments" aria-pressed="false">Comments only</button>
          <button data-filter="source" aria-pressed="false" title="Only media from the current body or comment">This comment</button>
        </div>
        <select aria-label="Choose a comment" class="source-select"><option value="">Choose a comment…</option></select>
      </div>
      <div class="viewer">
        <div class="media-column">
          <div class="asset-bar"><span class="kind">IMAGE</span><span class="filename"></span><button class="text-button fit" data-action="zoom" title="Toggle original image size">Fit</button></div>
          <div class="stage" tabindex="0" aria-label="Selected media"><div class="media"></div><div class="media-message" role="status"></div></div>
          <div class="navigation"><button class="location-button" data-action="locate" title="Show in conversation"></button>
            <button class="icon-button" data-action="previous" title="Previous media (←)" aria-label="Previous media">${icon('left')}</button>
            <div class="position" role="status" aria-live="polite"></div>
            <button class="icon-button" data-action="next" title="Next media (→)" aria-label="Next media">${icon('right')}</button>
          </div>
        </div>
      </div>
      <div class="empty" hidden>${icon('gallery')}<h3>No media here</h3><p></p><button class="button" data-filter="all">Show all media</button></div>
      <div class="thumbnails" aria-label="Media thumbnails"></div>
      <footer><span class="keyboard"><kbd>←</kbd><kbd>→</kbd> browse <span>·</span> <kbd>esc</kbd> close</span><div class="footer-actions"><a class="open-original" target="_blank" rel="noopener noreferrer" title="Open original media">${icon('external')} Original</a><button class="button" data-action="download">${icon('download')} Download</button></div></footer>
      <div class="toast" role="status" hidden></div>`;
    ui.append(panel);
    document.documentElement.append(host);
    syncTheme();
    ui.addEventListener('click', (event) => {
      const target = event.target.closest('button');
      if (!target) return;
      if (target.dataset.filter) return setFilter(target.dataset.filter);
      if (target.dataset.key) return select(target.dataset.key);
      const action = target.dataset.action;
      if (action === 'close') close();
      if (action === 'previous') move(-1);
      if (action === 'next') move(1);
      if (action === 'locate') reveal(current());
      if (action === 'download') download();
      if (action === 'zoom') {
        const zoomed = $('.stage').classList.toggle('zoomed');
        target.textContent = zoomed ? '100%' : 'Fit';
      }
    });
    $('.source-select').addEventListener('change', (event) => {
      if (!event.target.value) return;
      state.filter = 'source';
      state.source = event.target.value;
      filterItems();
      render();
      reveal(current());
    });
    const resize = $('.resize');
    resize.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      resize.setPointerCapture(event.pointerId);
      resize.classList.add('dragging');
    });
    resize.addEventListener('pointermove', (event) => {
      if (!resize.hasPointerCapture(event.pointerId)) return;
      state.split = Math.max(.28, Math.min(.65, event.clientX / innerWidth));
      layout();
    });
    resize.addEventListener('pointerup', (event) => {
      resize.releasePointerCapture(event.pointerId);
      resize.classList.remove('dragging');
    });
    resize.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      state.split = Math.max(.28, Math.min(.65, state.split + (event.key === 'ArrowLeft' ? -.02 : .02)));
      layout();
    });
  }

  function layout() {
    if (!state.open) return;
    const left = Math.round(Math.max(360, Math.min(innerWidth - 420, innerWidth * state.split)));
    document.documentElement.style.setProperty('--ghmg-left', `${left}px`);
    host.style.left = innerWidth < 800 ? '0px' : `${left}px`;
    $('.resize').setAttribute('aria-valuenow', String(Math.round(state.split * 100)));
  }

  function filterItems() {
    state.items = state.all.filter((item) => state.filter === 'comments' ? !item.source.isBody : state.filter === 'source' ? item.source.id === state.source : true);
    if (!state.items.some((item) => item.key === state.key)) state.key = state.items[0]?.key || '';
  }
  function setFilter(filter) {
    if (filter === 'source') state.source = current()?.source.id || state.source;
    state.filter = filter;
    filterItems();
    render();
    reveal(current());
  }
  function toast(message) {
    $('.toast').textContent = message;
    $('.toast').hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { $('.toast').hidden = true; }, 4000);
  }
  async function download() {
    const item = current();
    if (!item) return;
    try {
      const result = await chrome.runtime.sendMessage({ type: 'download-media', url: item.url, filename: item.filename });
      if (!result?.ok) throw new Error(result?.error);
      toast('Download started');
    } catch { toast('Download could not start. Use Original to open or save the media.'); }
  }

  function render() {
    const item = current();
    const oldVideo = $('.media video');
    if (oldVideo) oldVideo.pause();
    $('.repo').textContent = `${location.pathname.split('/').slice(1, 3).join(' / ')}  ·  #${state.path.split('/').pop()}`;
    $('.total').textContent = state.all.length;
    ui.querySelectorAll('.tabs button').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.filter === state.filter)));
    const sourceButton = $('[data-filter="source"]');
    sourceButton.textContent = item?.source.isBody ? 'This body' : 'This comment';
    sourceButton.disabled = !item;
    const sources = [...new Map(state.all.map((entry) => [entry.source.id, entry.source])).values()];
    const select = $('.source-select');
    select.replaceChildren(new Option('Choose a comment…', ''));
    for (const source of sources) select.append(new Option(`${source.label}${source.author ? ` · @${source.author}` : ''}`, source.id));
    select.value = state.filter === 'source' ? state.source : '';
    select.hidden = state.filter !== 'source';
    $('.viewer').hidden = !item;
    $('.empty').hidden = Boolean(item);
    $('.thumbnails').hidden = !item;
    $('.open-original').hidden = !item;
    $('[data-action="download"]').disabled = !item;
    if (!item) {
      $('.media').replaceChildren();
      $('.empty p').textContent = state.all.length ? 'No media matches this filter. Try all media or choose another comment.' : 'No images or videos in the loaded conversation. Expand hidden comments or load more, and the gallery will update.';
      return;
    }
    $('.kind').textContent = item.type.toUpperCase();
    $('.filename').textContent = item.caption || item.filename;
    $('.filename').title = item.filename;
    $('.fit').hidden = item.type === 'video';
    $('.fit').textContent = 'Fit';
    $('.stage').classList.remove('zoomed');
    $('.location-button').textContent = `${item.source.label}${item.source.author ? ` · @${item.source.author}` : ''}`;
    $('.open-original').href = item.url;
    const media = document.createElement(item.type === 'video' ? 'video' : 'img');
    if (item.type === 'video') {
      media.controls = true;
      media.playsInline = true;
      media.preload = 'metadata';
      media.setAttribute('aria-label', item.caption || item.filename);
    } else media.alt = item.caption || item.filename;
    const message = $('.media-message');
    message.textContent = 'Loading media…';
    message.hidden = false;
    const ready = () => { if (media.isConnected) message.hidden = true; };
    media.addEventListener(item.type === 'video' ? 'loadedmetadata' : 'load', ready);
    media.addEventListener('error', () => {
      if (media.isConnected) { message.textContent = 'Unable to display this file. Try opening the original.'; message.hidden = false; }
    });
    media.src = item.url;
    $('.media').replaceChildren(media);
    if (media.complete && media.naturalWidth) ready();
    const index = state.items.indexOf(item);
    $('.position').textContent = `${index + 1} / ${state.items.length}`;
    $('[data-action="previous"]').disabled = state.items.length < 2;
    $('[data-action="next"]').disabled = state.items.length < 2;
    const thumbnails = $('.thumbnails');
    thumbnails.replaceChildren(...state.items.map((entry, i) => {
      const button = document.createElement('button');
      button.dataset.key = entry.key;
      button.title = `${i + 1}. ${entry.caption || entry.filename} · ${entry.source.label}`;
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-current', String(entry.key === state.key));
      if (entry.type === 'image') {
        const img = document.createElement('img');
        img.src = entry.url;
        img.loading = 'lazy';
        img.alt = '';
        button.append(img);
      } else {
        const glyph = document.createElement('span');
        glyph.textContent = '▶';
        button.append(glyph);
      }
      const number = document.createElement('small');
      number.textContent = i + 1;
      button.append(number);
      return button;
    }));
    const activeThumb = thumbnails.querySelector('[aria-current="true"]');
    if (activeThumb) thumbnails.scrollLeft = activeThumb.offsetLeft - thumbnails.clientWidth / 2 + activeThumb.clientWidth / 2;
  }

  function reveal(item) {
    marked?.classList.remove('ghmg-selected');
    marked = null;
    if (!item?.element.isConnected) return;
    for (let parent = item.element.parentElement; parent; parent = parent.parentElement) {
      if (parent.matches('details')) parent.open = true;
    }
    marked = item.element;
    marked.classList.add('ghmg-selected');
    // Only move the page vertically, never the document sideways under the gallery.
    const rect = item.element.getBoundingClientRect();
    window.scrollTo({ top: Math.max(0, scrollY + rect.top - Math.max(90, (innerHeight - Math.min(rect.height, innerHeight - 180)) / 2)), left: 0, behavior: 'instant' });
  }
  function select(key) {
    state.key = key;
    render();
    reveal(current());
  }
  function move(delta) {
    if (!state.items.length) return;
    const index = state.items.findIndex((item) => item.key === state.key);
    select(state.items[(index + delta + state.items.length) % state.items.length].key);
  }
  function open(key) {
    state.path = model.conversationPath(location.pathname);
    if (!state.path) return;
    if (!host) createUI();
    state.all = model.scan();
    if (key && !state.items.some((item) => item.key === key)) state.filter = 'all';
    if (key) state.key = key;
    filterItems();
    lastFocus = document.activeElement;
    state.open = true;
    host.hidden = false;
    document.documentElement.classList.add('ghmg-open');
    layout();
    render();
    requestAnimationFrame(() => requestAnimationFrame(() => { reveal(current()); $('.stage').focus({ preventScroll: true }); }));
  }
  function close() {
    if (!state.open) return;
    state.open = false;
    $('.media video')?.pause();
    $('.media').replaceChildren();
    host.hidden = true;
    marked?.classList.remove('ghmg-selected');
    document.documentElement.classList.remove('ghmg-open');
    document.documentElement.style.removeProperty('--ghmg-left');
    if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
  }

  document.addEventListener('click', (event) => {
    if (event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.composedPath().includes(host)) return;
    if (!model.conversationPath(location.pathname)) return;
    const node = event.target.closest('img, video, a[href]');
    if (!node?.closest('.markdown-body')) return;
    const all = model.scan();
    const item = all.find((entry) => entry.element === node || node.contains(entry.element));
    if (!item) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    open(item.key);
  }, true);
  document.addEventListener('keydown', (event) => {
    if (!state.open || editable(event) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.composedPath().some((node) => node instanceof Element && node.matches('.resize'))) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      event.stopImmediatePropagation();
      move(event.key === 'ArrowRight' ? 1 : -1);
    }
  }, true);
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'toggle-gallery') state.open ? close() : open();
  });
  const fingerprint = (items) => JSON.stringify(items.map(({ key, caption }) => [key, caption]));
  function refresh() {
    if (state.path && state.path !== model.conversationPath(location.pathname)) {
      close();
      state.filter = 'all';
      state.key = '';
      state.path = '';
      return;
    }
    if (!state.open) return;
    const all = model.scan();
    const changed = fingerprint(all) !== fingerprint(state.all);
    state.all = all;
    filterItems();
    // Keep the active <video> intact across GitHub's background DOM updates.
    if (changed) render();
  }
  const observer = new MutationObserver((records) => {
    if (!records.some((record) => record.target !== host && !host?.contains(record.target))) return;
    clearTimeout(scanTimer);
    scanTimer = setTimeout(refresh, 250);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('popstate', refresh);
  document.addEventListener('turbo:load', refresh);
  document.addEventListener('pjax:end', refresh);
  window.addEventListener('resize', layout);
  new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-color-mode', 'data-theme', 'data-light-theme', 'data-dark-theme'] });
  new MutationObserver(syncTheme).observe(document.body, { attributes: true, attributeFilter: ['data-color-mode', 'data-theme', 'data-light-theme', 'data-dark-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', syncTheme);
})();

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:https';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

let context, profile;
const fixture = await readFile(new URL('./fixtures/conversation.html', import.meta.url), 'utf8');
const video = await readFile(new URL('./fixtures/sample.webm', import.meta.url));
const root = resolve(import.meta.dirname, '..');
const browserPath = process.env.BROWSER_PATH || (existsSync('/usr/bin/brave-browser') ? '/usr/bin/brave-browser' : chromium.executablePath());
const model = await readFile(resolve(root, 'media-model.js'), 'utf8');

// GitHub stand-in for the requests tests do not route: release downloads redirect to a signed
// release-assets URL, and private-repository downloads 404 without the session cookie.
const certs = await mkdtemp(`${tmpdir()}/ghmg-cert-`);
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=github.com', '-addext', 'subjectAltName=DNS:github.com,DNS:release-assets.githubusercontent.com', '-keyout', `${certs}/key.pem`, '-out', `${certs}/cert.pem`], { stdio: 'ignore' });
const assets = createServer({ key: await readFile(`${certs}/key.pem`), cert: await readFile(`${certs}/cert.pem`) }, (request, response) => {
  const url = new URL(request.url, `https://${request.headers.host}`);
  if (url.hostname === 'github.com' && url.pathname.includes('/releases/download/')) {
    if (url.pathname.startsWith('/private/') && !/user_session=signed-in/.test(request.headers.cookie || '')) return response.writeHead(404).end();
    return response.writeHead(302, { location: `https://release-assets.githubusercontent.com/signed${url.pathname}?sig=test` }).end();
  }
  if (url.hostname === 'release-assets.githubusercontent.com' && url.pathname.startsWith('/signed/')) {
    const [start, end = video.length - 1] = (/bytes=(\d+)-(\d*)/.exec(request.headers.range || '') || []).slice(1).map((value) => value && Number(value));
    const headers = { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment; filename=clip.mp4', 'accept-ranges': 'bytes' };
    if (start === undefined) return response.writeHead(200, { ...headers, 'content-length': video.length }).end(video);
    const last = Math.min(end || video.length - 1, video.length - 1);
    return response.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${last}/${video.length}`, 'content-length': last - start + 1 }).end(video.subarray(start, last + 1));
  }
  response.writeHead(404).end();
});
await new Promise((ready) => assets.listen(0, '127.0.0.1', ready));
before(async () => {
  profile = await mkdtemp(`${tmpdir()}/ghmg-test-`);
  context = await chromium.launchPersistentContext(profile, {
    executablePath: browserPath,
    headless: true,
    viewport: { width: 1440, height: 1000 },
    args: [
      `--disable-extensions-except=${root}`, `--load-extension=${root}`, '--ignore-certificate-errors',
      `--host-resolver-rules=MAP github.com 127.0.0.1:${assets.address().port}, MAP release-assets.githubusercontent.com 127.0.0.1:${assets.address().port}`,
    ],
  });
  await context.route('https://github.com/assets/**', (route) => {
    if (route.request().url().endsWith('.webm')) return route.fulfill({ contentType: 'video/webm', body: video });
    return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#0969da"/><text x="60" y="260" font-size="70" fill="white">Test screenshot</text></svg>' });
  });
});
after(async () => {
  await context?.close();
  assets.close();
  await rm(profile, { recursive: true, force: true });
  await rm(certs, { recursive: true, force: true });
});
async function pageFor(html = fixture, path = '/test/gallery/pull/42') {
  const page = await context.newPage();
  await page.route(`https://github.com${path}`, (route) => route.fulfill({ contentType: 'text/html', body: html }));
  await page.goto(`https://github.com${path}`);
  return page;
}
async function position(page, text) {
  await page.waitForFunction((value) => document.querySelector('#ghmg-root')?.shadowRoot.querySelector('.position')?.textContent === value, text);
}
async function scan(page) {
  return page.evaluate(`${model}\nGitHubGalleryModel.scan().map(({key,url,type,source,caption})=>({key,url,type,caption,source:{id:source.id,isBody:source.isBody,author:source.author}}))`);
}

test('installed extension: click, keyboard, page layout, filters, resizing, theme, focus, and close', async () => {
  const page = await pageFor();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('.markdown-body img[alt="After"]').click();
  await position(page, '2 / 5');
  assert.equal(new URL(page.url()).pathname, '/test/gallery/pull/42', 'image click stays on GitHub');
  assert.equal(await page.locator('#ghmg-root .context').count(), 0, 'no duplicate context panel');
  await page.keyboard.press('ArrowRight');
  await position(page, '3 / 5');
  assert.match(await page.locator('#ghmg-root .location-button').textContent(), /Comment 1.*reviewer/);
  const panel = await page.locator('#ghmg-root').boundingBox();
  const comment = await page.locator('#issuecomment-1').boundingBox();
  const sidebar = await page.locator('#pr-conversation-sidebar').boundingBox();
  assert.ok(comment.x + comment.width <= panel.x, 'conversation fits entirely left of panel');
  assert.ok(sidebar.x >= panel.x, 'gallery covers metadata sidebar');
  const selected = await page.locator('.ghmg-selected').boundingBox();
  assert.ok(selected.y >= 0 && selected.y < 1000, 'source scrolls into view');
  await page.getByRole('button', { name: 'This comment', exact: true }).click();
  await position(page, '1 / 2');
  await page.getByLabel('Choose a comment').selectOption('issuecomment-2');
  await position(page, '1 / 1');
  assert.match(await page.locator('#ghmg-root .location-button').textContent(), /another/);
  await page.getByRole('button', { name: 'Comments only', exact: true }).click();
  await position(page, '3 / 3');
  await page.getByRole('button', { name: /All media/, exact: false }).click();
  await position(page, '5 / 5');
  await page.keyboard.press('ArrowRight');
  await position(page, '1 / 5');
  await page.keyboard.press('ArrowLeft');
  await position(page, '5 / 5');
  await page.getByLabel('Write a comment').focus();
  await page.keyboard.press('ArrowLeft');
  await position(page, '5 / 5');
  assert.equal(await page.getByLabel('Write a comment').inputValue(), 'draft comment');
  const divider = page.getByRole('separator', { name: 'Resize conversation' });
  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  assert.ok((await page.locator('#ghmg-root').boundingBox()).x < panel.x, 'keyboard resizes split');
  await position(page, '5 / 5');
  assert.equal(await page.locator('#ghmg-root header').evaluate((el) => getComputedStyle(el).color), 'rgb(31, 35, 40)');
  await page.evaluate(() => { document.documentElement.dataset.colorMode = 'dark'; });
  await page.waitForFunction(() => document.querySelector('#ghmg-root').dataset.theme === 'dark');
  assert.equal(await page.locator('#ghmg-root .panel').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(13, 17, 23)');
  assert.equal(await page.locator('#ghmg-root .viewer').evaluate((el) => getComputedStyle(el).backgroundColor), 'rgb(21, 27, 35)');
  await page.getByRole('button', { name: 'Close gallery', exact: true }).click();
  assert.equal(await page.locator('#ghmg-root').isVisible(), false);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('ghmg-open')), false);
  assert.equal(await page.evaluate(() => document.body.getBoundingClientRect().width), 1440);
  assert.deepEqual(errors, []);
  await page.close();
});

test('video playback survives unrelated DOM updates and keeps native keyboard controls', async () => {
  const page = await pageFor();
  await page.locator('.markdown-body video').click();
  await position(page, '4 / 5');
  const frame = page.locator('#ghmg-root .media iframe');
  const media = page.frameLocator('#ghmg-root .media iframe').locator('video');
  await media.evaluate(async (video) => { video.muted = true; await video.play(); });
  await media.evaluate((video) => new Promise((done) => video.currentTime > 0 ? done() : video.addEventListener('timeupdate', done, { once: true })));
  await frame.evaluate((element) => { element.dataset.testIdentity = 'playing'; });
  await page.evaluate(() => document.querySelector('main').append(document.createElement('div')));
  await page.waitForTimeout(400); // Debounced DOM rescan must not replace the playing player.
  assert.equal(await frame.getAttribute('data-test-identity'), 'playing');
  assert.equal(await media.evaluate((video) => video.paused), false);
  await media.focus();
  await page.keyboard.press('ArrowLeft');
  await position(page, '4 / 5');
  await page.getByRole('button', { name: 'Next media', exact: true }).click();
  await position(page, '5 / 5');
  assert.equal(await frame.count(), 0, 'navigation removes the previous video');
  await page.close();
});

test('newly loaded comments are indexed and client navigation restores the page', async () => {
  const page = await pageFor();
  await page.locator('.markdown-body img[alt="Before"]').click();
  await position(page, '1 / 5');
  await page.evaluate(() => {
    const comment = document.querySelector('#issuecomment-2').cloneNode(true);
    comment.id = 'issuecomment-3';
    comment.querySelector('.js-timestamp').href = '#issuecomment-3';
    document.querySelector('.columns > section').append(comment);
  });
  await position(page, '1 / 6');
  await page.evaluate(() => { history.pushState({}, '', '/test/gallery/issues/43'); document.querySelector('main').append(document.createElement('hr')); });
  await page.waitForFunction(() => document.querySelector('#ghmg-root').hidden);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('ghmg-open')), false);
  await page.close();
});

test('modern issue markup: nested markdown, body authors, comment IDs, and repeated media', async () => {
  const html = `<main><section data-testid="issue-body"><a data-hovercard-type="user"><img alt="avatar"></a><a data-testid="issue-body-header-author">writer</a><a href="#issue-42">Today</a><div data-testid="issue-body-viewer"><div class="markdown-body"><div class="markdown-body"><img src="https://github.com/assets/before.png"></div></div></div></section><section data-testid="comment-viewer-outer-box-IC_abc"><div id="issuecomment-99"><a data-hovercard-type="user"><img alt="avatar"></a><a data-testid="avatar-link" data-hovercard-type="user">reviewer</a><a href="#issuecomment-99">Today</a></div><div class="markdown-body"><div class="markdown-body"><img src="https://github.com/assets/before.png"><a href="https://github.com/assets/demo.mp4">Download video</a></div></div></section></main>`;
  const page = await pageFor(html, '/test/gallery/issues/42');
  const items = await scan(page);
  assert.equal(items.length, 3, 'nested markdown is indexed once and repeat in another comment is kept');
  assert.deepEqual(items.map((item) => item.source), [
    { id: 'issue-42', isBody: true, author: 'writer' },
    { id: 'issuecomment-99', isBody: false, author: 'reviewer' },
    { id: 'issuecomment-99', isBody: false, author: 'reviewer' },
  ]);
  assert.equal(items[2].type, 'video');
  assert.equal(await page.evaluate(`${model}\nGitHubGalleryModel.safeUrl('javascript:alert(1)')`), '');
  await page.close();
});

test('release-download videos play under GitHub CSP, which blocks release-assets in media-src', async () => {
  const csp = (await readFile(new URL('./fixtures/github-csp.txt', import.meta.url), 'utf8')).trim();
  await context.addCookies([{ name: 'user_session', value: 'signed-in', domain: 'github.com', path: '/', secure: true, httpOnly: true, sameSite: 'Lax' }]);
  for (const repository of ['public/gallery', 'private/gallery']) {
    const release = `https://github.com/${repository}/releases/download/pr-assets/clip.mp4`;
    const page = await context.newPage();
    const html = `<main><div class="js-comment timeline-comment-group" id="issuecomment-7"><a class="author" href="/agent">agent</a><a class="js-timestamp" href="#issuecomment-7">Today</a><div class="markdown-body js-comment-body"><p>Recording:</p><p><a href="${release}">${release}</a></p></div></div></main>`;
    await page.route(`https://github.com/${repository}/pull/43`, (route) => route.fulfill({ contentType: 'text/html', headers: { 'content-security-policy': csp }, body: html }));
    await page.goto(`https://github.com/${repository}/pull/43`);
    await page.locator(`.markdown-body a[href="${release}"]`).click();
    await position(page, '1 / 1');
    const player = page.frameLocator('#ghmg-root .media iframe').locator('video');
    await player.evaluate((element) => new Promise((done, fail) => element.readyState ? done() : (element.addEventListener('loadedmetadata', done, { once: true }), setTimeout(() => fail(new Error(`no metadata: ${element.currentSrc}`)), 8000))));
    await player.evaluate(async (element) => { element.muted = true; await element.play(); });
    await player.evaluate((element) => new Promise((done) => element.currentTime > 0 ? done() : element.addEventListener('timeupdate', done, { once: true })));
    assert.match(await player.evaluate((element) => element.currentSrc), /release-assets\.githubusercontent\.com|releases\/download/, repository);
    await page.waitForFunction(() => document.querySelector('#ghmg-root').shadowRoot.querySelector('.media-message').hidden);
    await page.close();
  }
});

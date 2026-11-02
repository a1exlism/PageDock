const { _electron: electron, expect } = require('playwright/test');
const { strict: assert } = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = process.argv[2];
if (!output) throw new Error('Usage: node test/app.cjs <output-directory> [app-executable]');
const out = path.resolve(output);
fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(out, 'test-data-'));
const executablePath = process.argv[3] ? path.resolve(process.argv[3]) : undefined;
const exampleURL = 'https://example.com/';
const wikiURL = 'https://en.wikipedia.org/wiki/Computer';
const publicHosts = new Set(['example.com', 'en.wikipedia.org', 'upload.wikimedia.org']);
let running;
const errors = [];
const navigationFailures = [];
const results = [];

async function launch() {
  running = await electron.launch({
    colorScheme: null,
    ...(executablePath ? { executablePath, args: [] } : { args: [root] }),
    env: { ...process.env, WEBPAGE_APP_DATA_DIR: data }, timeout: 30000
  });
  running.context().on('requestfailed', request => {
    if (request.isNavigationRequest()) navigationFailures.push(request.failure()?.errorText || 'Navigation request failed');
  });
  await running.evaluate(({ session }, { hosts, pages }) => {
    const allowedHosts = new Set(hosts);
    session.fromPartition('persist:websites').webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      const navigation = ['mainFrame', 'subFrame'].includes(details.resourceType);
      const approvedPage = !url.search && pages.includes(`${url.origin}${url.pathname}`);
      const allowed = url.protocol === 'https:' && allowedHosts.has(url.hostname) && !url.username && !url.password && ['GET', 'HEAD'].includes(details.method) && (!navigation || approvedPage);
      callback({ cancel: !allowed });
    });
  }, { hosts: [...publicHosts], pages: [exampleURL, wikiURL] });
  const page = await running.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('#hero-add:visible, #library:visible, #browser-controls:visible');
  return page;
}

async function publicPage(expectedURL = exampleURL) {
  await expect.poll(() => running.context().pages().some(page => page.url().startsWith(expectedURL)), { timeout: 30000, message: `Waiting for public page: ${expectedURL}` }).toBe(true);
  const page = running.context().pages().find(page => page.url().startsWith(expectedURL));
  await expect(page).toHaveTitle(expectedURL === wikiURL ? /Computer.*Wikipedia/ : 'Example Domain', { timeout: 30000 });
  await expect(page.locator('body')).toContainText(expectedURL === wikiURL ? 'Computer' : 'documentation examples', { timeout: 30000 });
  return page;
}

async function expandSidebar(page) {
  if (await page.locator('#sidebar-toggle').getAttribute('aria-expanded') === 'false') await page.click('#sidebar-toggle');
  await expect(page.locator('#sidebar')).toBeVisible();
}

async function guestLayout() {
  return running.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().startsWith('file:'));
    const guest = win.contentView.children.find(item => /^https:\/\/(example\.com|en\.wikipedia\.org)\//.test(item.webContents?.getURL() || ''));
    return { bounds: guest.getBounds(), size: win.getContentSize(), id: guest.webContents.id };
  });
}

async function zenShortcut(shell = false) {
  await running.evaluate(({ BrowserWindow }, shell) => {
    const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().startsWith('file:'));
    const target = shell ? win.webContents : win.contentView.children.find(item => /^https:\/\/(example\.com|en\.wikipedia\.org)\//.test(item.webContents?.getURL() || '')).webContents;
    win.focus();
    target.focus();
    target.sendInputEvent({ type: 'keyDown', keyCode: 'Enter', modifiers: ['meta', 'shift'] });
    target.sendInputEvent({ type: 'keyUp', keyCode: 'Enter', modifiers: ['meta', 'shift'] });
  }, shell);
}

async function addPublicPage(page, name, url) {
  assert.ok([exampleURL, wikiURL].includes(url));
  await expandSidebar(page);
  await page.click('#add');
  await page.fill('#name-input', name);
  await page.fill('#url-input', url);
  await page.click('#save');
  return publicPage(url);
}

async function colors(page) {
  return page.evaluate(() => ({
    color: getComputedStyle(document.body).color,
    background: getComputedStyle(document.body).backgroundColor,
    font: getComputedStyle(document.body).fontSize,
    darkPreference: matchMedia('(prefers-color-scheme: dark)').matches
  }));
}

async function addSyntheticControls(page) {
  await page.evaluate(() => {
    const fixture = document.createElement('section');
    fixture.setAttribute('data-pagedock-test', '');
    fixture.style.cssText = 'max-width:800px;margin:0 auto;padding:32px';
    fixture.innerHTML = '<h2 id="public-controls">Public test controls</h2><button id="public-action" type="button">Public test action</button><a href="#public-destination">Public test link</a><a href="https://example.com/#popup" target="_blank">Public test popup</a><p><input aria-label="Public typing field"></p><p contenteditable="true" role="textbox" aria-label="Public editor"></p><article id="public-scroll" style="height:110px;overflow:auto;width:70%;border:1px solid #aaa"><section style="height:900px">Synthetic scroll content</section></article><section style="min-height:800px"><h2 id="public-destination">Public test destination</h2></section><section style="min-height:800px"><h3>Public test details</h3></section>';
    fixture.querySelector('#public-action').addEventListener('click', event => { event.currentTarget.dataset.clicked = 'true'; });
    document.body.append(fixture);
  });
}

(async () => {
  let page = await launch();
  await expect(page.locator('#welcome')).toBeVisible();
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect(page.locator('#sidebar-toggle')).toBeHidden();
  await expect(page.locator('#zen-toggle')).toBeHidden();
  assert.equal(await running.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('zen-mode').enabled), false);
  await expect(page.locator('button[data-theme="system"]')).toHaveAttribute('aria-pressed', 'true');
  const systemDark = await running.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors);
  await page.screenshot({ path: path.join(out, 'welcome.png') });
  await page.click('button[data-theme="dark"]');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(23, 25, 30)');
  await page.screenshot({ path: path.join(out, 'dark.png') });
  await page.click('button[data-theme="light"]');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(247, 248, 250)');
  await page.screenshot({ path: path.join(out, 'light.png') });
  await page.click('button[data-theme="dark"]');

  let guest = await addPublicPage(page, 'Example Domain', exampleURL);
  await expect(page.locator('#sidebar')).toBeHidden();
  await expect(page.getByRole('button', { name: '展开侧边栏', exact: true })).toBeVisible();
  const folded = await guestLayout();
  assert.equal(folded.bounds.x, 0);
  assert.equal(folded.bounds.width, folded.size[0]);
  await expect.poll(() => guest.evaluate(() => innerWidth)).toBe(folded.size[0]);
  const capture = await running.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().startsWith('file:'));
    return (await win.capturePage()).toPNG().toString('base64');
  });
  fs.writeFileSync(path.join(out, 'collapsed.png'), Buffer.from(capture, 'base64'));
  const originalColors = await colors(guest);
  await addSyntheticControls(guest);
  await guest.getByRole('textbox', { name: 'Public typing field' }).fill('PUBLIC_TEST_ONLY');
  await expandSidebar(page);
  const expanded = await guestLayout();
  assert.equal(expanded.id, folded.id);
  assert.equal(expanded.bounds.x, 244);
  assert.equal(expanded.bounds.width, expanded.size[0] - 244);
  await expect.poll(() => guest.evaluate(() => innerWidth)).toBe(expanded.size[0] - 244);
  await expect(guest.getByRole('textbox', { name: 'Public typing field' })).toHaveValue('PUBLIC_TEST_ONLY');
  await page.click('#sidebar-toggle');
  await running.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(item => item.webContents.getURL().startsWith('file:')).setContentSize(1000, 700));
  await expect.poll(async () => (await guestLayout()).bounds.width).toBe(1000);
  await expect.poll(() => guest.evaluate(() => innerWidth)).toBe(1000);
  await running.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows().find(item => item.webContents.getURL().startsWith('file:')).setContentSize(...size), folded.size);
  await expandSidebar(page);
  await page.click('button[data-theme="light"]');
  assert.deepEqual(await colors(guest), originalColors);
  await page.click('button[data-theme="dark"]');
  assert.deepEqual(await colors(guest), originalColors);
  assert.equal(await guest.evaluate(() => typeof require), 'undefined');
  assert.equal(await guest.evaluate(() => typeof window.pages), 'undefined');
  results.push('public example.com: default collapse, full-width viewport, resize, no reload or form loss, and unchanged website colors');

  await page.click('[data-plugin="toc"]');
  await expect(guest.getByRole('region', { name: '页面目录' })).toBeVisible();
  await page.click('#zen-toggle');
  await expect(page.locator('body')).toHaveClass(/zen-mode/);
  await expect(page.locator('#sidebar')).toBeHidden();
  await expect(page.locator('.toolbar')).toBeHidden();
  await expect(page.locator('#sidebar-toggle')).toBeHidden();
  await expect(page.getByRole('button', { name: '退出 Zen Mode', exact: true })).toBeVisible();
  await expect(guest.locator('[data-pagedock-tools]')).toHaveCount(0);
  const zen = await guestLayout();
  assert.equal(zen.id, expanded.id);
  assert.deepEqual(zen.bounds, { x: 0, y: 32, width: zen.size[0], height: zen.size[1] - 32 });
  await expect.poll(() => guest.evaluate(() => innerHeight)).toBe(zen.size[1] - 32);
  await expect(guest.getByRole('textbox', { name: 'Public typing field' })).toHaveValue('PUBLIC_TEST_ONLY');
  assert.deepEqual(await colors(guest), originalColors);
  await page.screenshot({ path: path.join(out, 'zen-shell.png') });
  await guest.screenshot({ path: path.join(out, 'zen-page.png') });
  await zenShortcut();
  await expect(page.locator('body')).not.toHaveClass(/zen-mode/);
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect(guest.getByRole('region', { name: '页面目录' })).toBeVisible();
  assert.deepEqual((await guestLayout()).bounds, expanded.bounds);
  await guest.getByRole('button', { name: '收起目录', exact: true }).click();
  await page.click('#sidebar-toggle');
  await zenShortcut(true);
  await expect(page.locator('body')).toHaveClass(/zen-mode/);
  await running.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(item => item.webContents.getURL().startsWith('file:')).setContentSize(1000, 700));
  await expect.poll(async () => (await guestLayout()).size[0]).toBe(1000);
  const resizedSize = (await guestLayout()).size;
  await expect.poll(async () => (await guestLayout()).bounds).toEqual({ x: 0, y: 32, width: resizedSize[0], height: resizedSize[1] - 32 });
  await expect.poll(() => guest.evaluate(() => innerHeight)).toBe(resizedSize[1] - 32);
  await running.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows().find(item => item.webContents.getURL().startsWith('file:')).setContentSize(...size), zen.size);
  await page.click('#zen-exit');
  await expect(page.locator('#sidebar')).toBeHidden();
  await expect(guest.getByRole('button', { name: '切换页面目录' })).toHaveAttribute('aria-expanded', 'false');
  await expandSidebar(page);
  await page.click('[data-plugin="toc"]');
  await expect(guest.locator('[data-pagedock-tools]')).toHaveCount(0);
  results.push('Zen Mode: minimal header, full-width page, hidden chrome and TOC, preserved form and colors, keyboard and button exit, sidebar and TOC restoration, resized viewport');

  await guest.locator('#public-controls').click();
  const startScroll = await guest.evaluate(() => scrollY);
  await guest.keyboard.press('j');
  assert.equal(await guest.evaluate(() => scrollY), startScroll);
  await page.click('[data-plugin="vimium"]');
  await guest.locator('#public-controls').click();
  const beforeScroll = await guest.evaluate(() => scrollY);
  await guest.keyboard.press('j');
  await expect.poll(() => guest.evaluate(() => scrollY)).toBeGreaterThan(beforeScroll);
  await guest.keyboard.press('G');
  await expect.poll(() => guest.evaluate(() => scrollY)).toBeGreaterThan(1000);
  await guest.keyboard.press('g');
  await guest.keyboard.press('g');
  await expect.poll(() => guest.evaluate(() => scrollY)).toBe(0);
  await guest.locator('#public-controls').click();
  await guest.locator('#public-scroll').hover();
  await guest.keyboard.press('j');
  await expect.poll(() => guest.locator('#public-scroll').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await guest.getByRole('textbox', { name: 'Public typing field' }).fill('');
  await guest.keyboard.type('jkgf');
  await expect(guest.getByRole('textbox', { name: 'Public typing field' })).toHaveValue('jkgf');
  await guest.getByRole('textbox', { name: 'Public editor', exact: true }).fill('');
  await guest.keyboard.type('jkgf');
  await expect(guest.getByRole('textbox', { name: 'Public editor', exact: true })).toHaveText('jkgf');
  await guest.locator('#public-controls').click();
  await guest.keyboard.press('?');
  await expect(guest.getByRole('region', { name: 'Vimium Lite 快捷键' })).toBeVisible();
  await guest.keyboard.press('Escape');
  await guest.locator('#public-controls').evaluate(async element => {
    element.scrollIntoView({ block: 'start', behavior: 'instant' });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  await guest.keyboard.press('f');
  const code = await guest.locator('[data-pagedock-tools] .hint').first().textContent();
  await guest.screenshot({ path: path.join(out, 'vimium.png') });
  await expect(guest.locator('[data-pagedock-tools] .hint').first()).toBeVisible();
  await guest.keyboard.type(code.toLowerCase());
  await expect(guest.locator('#public-action')).toHaveAttribute('data-clicked', 'true');
  await page.click('[data-plugin="toc"]');
  await expect(guest.getByRole('button', { name: 'Public test destination', exact: true })).toBeVisible();
  await guest.getByRole('button', { name: 'Public test destination', exact: true }).click();
  await expect.poll(() => guest.locator('#public-destination').evaluate(element => Math.abs(element.getBoundingClientRect().top))).toBeLessThan(3);
  await guest.evaluate(() => { const heading = document.createElement('h2'); heading.textContent = 'Public dynamic heading'; document.querySelector('[data-pagedock-test]').append(heading); });
  await expect(guest.getByRole('button', { name: 'Public dynamic heading', exact: true })).toBeVisible();
  assert.deepEqual(await colors(guest), originalColors);
  await page.click('[data-plugin="toc"]');
  await page.click('[data-plugin="vimium"]');
  await expect(guest.locator('[data-pagedock-tools]')).toHaveCount(0);
  await guest.getByRole('link', { name: 'Public test link', exact: true }).click();
  await expect.poll(() => guest.url()).toBe(`${exampleURL}#public-destination`);
  await page.click('#back');
  await expect.poll(() => guest.url()).toBe(exampleURL);
  await page.click('#forward');
  await expect.poll(() => guest.url()).toBe(`${exampleURL}#public-destination`);
  const popupPromise = running.waitForEvent('window');
  await guest.getByRole('link', { name: 'Public test popup', exact: true }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveTitle('Example Domain', { timeout: 30000 });
  await expect(popup.locator('body')).toContainText('documentation examples', { timeout: 30000 });
  assert.equal(await popup.evaluate(() => typeof window.pages), 'undefined');
  await popup.close();
  await guest.evaluate(() => localStorage.setItem('pagedock_public_test', 'PUBLIC_TEST_ONLY'));
  await page.click('#reload');
  guest = await publicPage();
  await expect(page.locator('#sidebar')).toBeVisible();
  results.push('synthetic controls within example.com: keyboard navigation, input exclusion, link hints, TOC updates, plugin cleanup, public navigation and popup isolation');

  guest = await addPublicPage(page, 'Wikipedia Computer', wikiURL);
  await expect(page.locator('#sidebar')).toBeHidden();
  await expandSidebar(page);
  await page.click('[data-plugin="toc"]');
  await expect(guest.getByRole('region', { name: '页面目录' })).toBeVisible();
  await expect.poll(() => guest.locator('[data-pagedock-tools] .toc-entry').count()).toBeGreaterThan(1);
  await guest.screenshot({ path: path.join(out, 'wiki-toc.png') });
  await page.click('#zen-toggle');
  await expect(guest.locator('[data-pagedock-tools]')).toHaveCount(0);
  await guest.reload();
  guest = await publicPage(wikiURL);
  await expect(page.locator('body')).toHaveClass(/zen-mode/);
  await expect(guest.locator('[data-pagedock-tools]')).toHaveCount(0);
  await running.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu().getMenuItemById('zen-mode');
    item.click();
  });
  await expect(page.locator('body')).not.toHaveClass(/zen-mode/);
  await expect(guest.getByRole('region', { name: '页面目录' })).toBeVisible();
  await page.getByRole('button', { name: '打开 Example Domain', exact: true }).click();
  guest = await publicPage();
  await expect(page.locator('#sidebar')).toBeHidden();
  await expandSidebar(page);
  await page.getByRole('button', { name: '打开 Wikipedia Computer', exact: true }).click();
  await publicPage(wikiURL);
  await expect(page.locator('#sidebar')).toBeHidden();
  await page.click('#zen-toggle');
  await running.evaluate(({ Menu }) => Menu.getApplicationMenu().items.flatMap(item => item.submenu?.items || []).find(item => item.label === '新增页面…').click());
  await expect(page.locator('#editor')).toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/zen-mode/);
  await page.click('#cancel');
  await page.click('#edit');
  await page.click('#remove');
  await page.click('#remove');
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect(page.locator('#sidebar-toggle')).toBeHidden();
  await page.getByRole('button', { name: '打开 Example Domain', exact: true }).click();
  await publicPage();
  await expandSidebar(page);
  await page.click('#zen-toggle');
  await running.close();
  running = null;
  page = await launch();
  guest = await publicPage();
  await expect(page.locator('body')).not.toHaveClass(/zen-mode/);
  await expect(page.locator('#sidebar')).toBeHidden();
  await expect(page.locator('button[data-theme="dark"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-plugin="toc"]')).toHaveAttribute('aria-pressed', 'true');
  assert.equal(await guest.evaluate(() => localStorage.getItem('pagedock_public_test')), 'PUBLIC_TEST_ONLY');
  await expandSidebar(page);
  await page.click('button[data-theme="system"]');
  await expect(page.locator('html')).toHaveAttribute('data-theme', systemDark ? 'dark' : 'light');
  await page.click('#overview');
  await expect(page.locator('#sidebar')).toBeVisible();
  await running.close();
  running = null;
  page = await launch();
  await expect(page.locator('#library')).toBeVisible();
  await expect(page.locator('#sidebar')).toBeVisible();
  await expect(page.locator('#sidebar-toggle')).toBeHidden();
  results.push('Wikipedia TOC; page switches and restart with an open page collapse; active-page removal and restart without an open page expand; preferences and synthetic localStorage persist');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: results, publicPages: [exampleURL, wikiURL], rendererErrors: errors }, null, 2));
})().catch(async error => {
  console.error('Completed checks:', results);
  if (running) {
    const diagnostic = await running.evaluate(({ webContents }) => webContents.getAllWebContents().filter(wc => /^https:\/\/(example\.com|en\.wikipedia\.org)\//.test(wc.getURL())).map(wc => ({ title: wc.getTitle(), loading: wc.isLoading(), type: wc.getType() }))).catch(() => []);
    console.error('Public page diagnostics:', diagnostic);
    const shell = running.context().pages().find(page => page.url().startsWith('file:'));
    if (shell) {
      const status = await shell.evaluate(() => window.pages.state().then(state => ({ failure: state.failure, activePage: Boolean(state.activeId), savedPages: state.sites.length }))).catch(() => 'Application state unavailable');
      console.error('Public page status:', status);
    }
    const guest = running.context().pages().find(page => page.url().startsWith(exampleURL) || page.url().startsWith(wikiURL));
    if (guest) await guest.screenshot({ path: path.join(out, 'public-page-failure.png'), timeout: 3000 }).catch(() => {});
  }
  console.error('Navigation failures:', [...new Set(navigationFailures)]);
  let message = error.message;
  for (const [value, label] of [[data, '<test-data>'], [out, '<test-output>'], [root, '<project>'], [process.env.HOME, '~']]) {
    if (value) message = message.split(value).join(label);
  }
  console.error(message);
  process.exitCode = 1;
}).finally(async () => {
  try {
    if (running) await running.close();
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});

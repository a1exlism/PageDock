const { _electron: electron, expect } = require('playwright/test');
const { strict: assert } = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const output = process.argv[2];
if (!output) throw new Error('Usage: node test/app.cjs <output-directory> [app-executable]');
const out = path.resolve(output);
fs.mkdirSync(out, { recursive: true });
const data = fs.mkdtempSync(path.join(out, 'test-data-'));
const executablePath = process.argv[3] ? path.resolve(process.argv[3]) : undefined;
let running;
const errors = [];
const results = [];
const server = http.createServer((request, response) => {
  if (request.url === '/fixture.css') {
    response.setHeader('Content-Type', 'text/css');
    response.end('html{color-scheme:light;background:transparent}body{margin:0;background:transparent;color:rgb(38,48,62);font:16px/1.6 sans-serif}main{padding:32px 50px}h1{font-size:32px}h2{font-size:26px}section.chapter{min-height:700px;padding-top:30px}a{display:inline-block;margin:0 25px 20px 0;color:#245ba0}input,[contenteditable]{display:block;margin:12px 0;padding:8px;border:1px solid #aaa;max-width:350px}#scroll-panel{height:110px;overflow:auto;border:1px solid #bbb;width:60%}#scroll-content{height:900px;background:#f2f4f7}.surface,.hint,.toc-entry{background:rgb(255,0,100);font-size:48px}');
    return;
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  if (request.url === '/tools') {
    response.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self'; script-src 'self'");
    response.end('<!doctype html><html><head><title>PageDock fixture</title><link rel="stylesheet" href="/fixture.css"></head><body><main><h1>Local page</h1><p>Original website colors</p><a href="/next">Next</a><a href="/popup" target="_blank">Popup</a><input aria-label="Typing field"><div contenteditable="true" role="textbox" aria-label="Editor"></div><div id="scroll-panel"><div id="scroll-content">Nested scrolling area</div></div><section class="chapter"><h2>Chapter one</h2><p>First section.</p></section><section class="chapter"><h2>Chapter two</h2><p>Second section.</p></section><section class="chapter"><h3>Details</h3><p>Last section.</p></section></main></body></html>');
    return;
  }
  response.end(`<!doctype html><html><head><title>Local test page</title></head><body><h1>${request.url === '/next' ? 'Next page' : 'Local page'}</h1><p id="cookie"></p><a href="/next">Next</a><a href="/popup" target="_blank">Popup</a><script>document.querySelector('#cookie').textContent=document.cookie; window.fixtureLoaded=true;</script></body></html>`);
});

async function launch() {
  running = await electron.launch({
    colorScheme: null,
    ...(executablePath ? { executablePath, args: [] } : { args: [root] }),
    env: { ...process.env, WEBPAGE_APP_DATA_DIR: data }, timeout: 30000
  });
  const page = await running.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('#hero-add:visible, #browser-controls:visible');
  return page;
}

async function guestEval(code) {
  return running.evaluate(async ({ webContents }, source) => {
    const guest = webContents.getAllWebContents().find(wc => /^http:\/\/localhost:/.test(wc.getURL()));
    if (!guest) throw new Error('Missing guest page');
    return guest.executeJavaScript(source);
  }, code);
}

async function waitGuest(text) {
  await expect.poll(async () => {
    try { return await guestEval('document.body.textContent'); } catch { return ''; }
  }).toContain(text);
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const url = `localhost:${port}/tools`;
  let page = await launch();
  await expect(page.locator('#welcome')).toBeVisible();
  await expect(page.locator('button[data-theme="system"]')).toHaveAttribute('aria-pressed', 'true');
  assert.equal(await running.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'system');
  const systemDark = await running.evaluate(({ nativeTheme }) => nativeTheme.shouldUseDarkColors);
  await expect(page.locator('html')).toHaveAttribute('data-theme', systemDark ? 'dark' : 'light');
  await page.screenshot({ path: path.join(out, 'welcome.png') });
  await page.click('button[data-theme="dark"]');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(23, 25, 30)');
  await page.screenshot({ path: path.join(out, 'dark.png') });
  await page.click('button[data-theme="light"]');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(247, 248, 250)');
  await page.screenshot({ path: path.join(out, 'light.png') });
  await page.click('button[data-theme="dark"]');
  results.push('PageDock defaults to system; shell light and dark use neutral colors');
  await page.click('#hero-add');
  await page.fill('#name-input', '本地测试');
  await page.fill('#url-input', 'javascript:alert(1)');
  await page.click('#save');
  await expect(page.locator('#form-error')).toContainText('仅支持');
  await page.fill('#url-input', url);
  await page.click('#save');
  await waitGuest('Local page');
  const originalColors = await guestEval('({ color: getComputedStyle(document.body).color, background: getComputedStyle(document.body).backgroundColor, font: getComputedStyle(document.body).fontSize, styles: document.querySelectorAll("style").length })');
  assert.equal(originalColors.background, 'rgba(0, 0, 0, 0)');
  assert.equal(originalColors.color, 'rgb(38, 48, 62)');
  assert.equal(await guestEval('matchMedia("(prefers-color-scheme: dark)").matches'), systemDark);
  await page.click('button[data-theme="light"]');
  assert.equal(await guestEval('matchMedia("(prefers-color-scheme: dark)").matches'), systemDark);
  await page.click('button[data-theme="dark"]');
  assert.equal(await guestEval('matchMedia("(prefers-color-scheme: dark)").matches'), systemDark);
  assert.deepEqual(await guestEval('({ color: getComputedStyle(document.body).color, background: getComputedStyle(document.body).backgroundColor, font: getComputedStyle(document.body).fontSize, styles: document.querySelectorAll("style").length })'), originalColors);
  results.push('app theme leaves website colors, CSS and system media preference unchanged');
  assert.equal(await guestEval('typeof require'), 'undefined');
  assert.equal(await guestEval('typeof window.pages'), 'undefined');
  results.push('HTTP localhost load; unsafe URL rejection; guest has no Node or privileged bridge');
  await guestEval('document.cookie="session_test=retained; max-age=86400; path=/"; localStorage.setItem("session_test", "retained")');
  const guestPage = running.context().pages().find(item => /^http:\/\/localhost:/.test(item.url()));
  assert.ok(guestPage, 'Guest page is available for real pointer input');
  await expect(page.locator('[data-plugin="vimium"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-plugin="toc"]')).toHaveAttribute('aria-pressed', 'false');
  await guestPage.locator('h1').click();
  await guestPage.keyboard.press('j');
  assert.equal(await guestPage.evaluate(() => scrollY), 0);
  await page.click('[data-plugin="vimium"]');
  await guestPage.locator('h1').click();
  await guestPage.keyboard.press('j');
  await expect.poll(() => guestPage.evaluate(() => scrollY)).toBeGreaterThan(0);
  await guestPage.keyboard.press('k');
  await expect.poll(() => guestPage.evaluate(() => scrollY)).toBe(0);
  await guestPage.keyboard.press('G');
  await expect.poll(() => guestPage.evaluate(() => scrollY)).toBeGreaterThan(1000);
  await guestPage.keyboard.press('g');
  await guestPage.keyboard.press('g');
  await expect.poll(() => guestPage.evaluate(() => scrollY)).toBe(0);
  await guestPage.locator('#scroll-panel').hover();
  await guestPage.keyboard.press('j');
  await expect.poll(() => guestPage.locator('#scroll-panel').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  assert.equal(await guestPage.evaluate(() => scrollY), 0);
  await guestPage.getByRole('textbox', { name: 'Typing field' }).fill('');
  await guestPage.keyboard.type('jkgf');
  await expect(guestPage.getByRole('textbox', { name: 'Typing field' })).toHaveValue('jkgf');
  assert.equal(await guestPage.evaluate(() => scrollY), 0);
  await guestPage.getByRole('textbox', { name: 'Editor', exact: true }).fill('');
  await guestPage.keyboard.type('jkgf');
  await expect(guestPage.getByRole('textbox', { name: 'Editor', exact: true })).toHaveText('jkgf');
  await guestPage.locator('h1').click();
  await guestPage.keyboard.press('?');
  await expect(guestPage.getByRole('region', { name: 'Vimium Lite 快捷键' })).toBeVisible();
  await guestPage.keyboard.press('Escape');
  await expect(guestPage.getByRole('region', { name: 'Vimium Lite 快捷键' })).toHaveCount(0);
  await guestPage.keyboard.press('f');
  const hintCode = await guestPage.locator('[data-pagedock-tools] .hint').first().textContent();
  await guestPage.screenshot({ path: path.join(out, 'vimium.png') });
  await guestPage.keyboard.type(hintCode.toLowerCase());
  await waitGuest('Next page');
  await page.click('#back');
  await waitGuest('Local page');
  await page.click('[data-plugin="toc"]');
  await expect(guestPage.getByRole('region', { name: '页面目录' })).toBeVisible();
  await expect(guestPage.locator('[data-pagedock-tools] .toc-entry')).toHaveCount(4);
  await guestPage.getByRole('button', { name: 'Chapter two', exact: true }).click();
  await expect.poll(() => guestPage.locator('h2').last().evaluate(element => Math.abs(element.getBoundingClientRect().top))).toBeLessThan(3);
  await guestPage.evaluate(() => { const heading = document.createElement('h2'); heading.textContent = 'Live section'; document.querySelector('main').append(heading); });
  await expect(guestPage.getByRole('button', { name: 'Live section', exact: true })).toBeVisible();
  await expect(guestPage.locator('[data-pagedock-tools] .toc-panel')).toHaveCSS('background-color', 'rgb(35, 39, 47)');
  assert.deepEqual(await guestEval('({ color: getComputedStyle(document.body).color, background: getComputedStyle(document.body).backgroundColor, font: getComputedStyle(document.body).fontSize, styles: document.querySelectorAll("style").length })'), originalColors);
  await guestPage.screenshot({ path: path.join(out, 'toc.png') });
  await page.click('[data-plugin="toc"]');
  await page.click('[data-plugin="vimium"]');
  await expect(guestPage.locator('[data-pagedock-tools]')).toHaveCount(0);
  await guestPage.evaluate(() => scrollTo(0, 0));
  await guestPage.locator('h1').click();
  await guestPage.keyboard.press('f');
  await guestPage.keyboard.press('j');
  await expect(guestPage.locator('[data-pagedock-tools]')).toHaveCount(0);
  assert.equal(await guestPage.evaluate(() => scrollY), 0);
  await page.click('[data-plugin="vimium"]');
  await page.click('[data-plugin="toc"]');
  results.push('Vimium scrolling, nested scroll areas, gg/G, hints, help and editable-field exclusion; TOC headings, jump and live updates; strict CSP and style isolation; toggles remove tool UI');
  await guestPage.getByRole('link', { name: 'Next', exact: true }).click();
  await waitGuest('Next page');
  await page.click('#back');
  await waitGuest('Local page');
  await page.click('#forward');
  await waitGuest('Next page');
  await page.click('#reload');
  await waitGuest('Next page');
  results.push('back, forward and reload');
  const popupPromise = running.waitForEvent('window');
  await guestPage.getByRole('link', { name: 'Popup', exact: true }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  assert.equal(await popup.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), systemDark);
  assert.equal(await popup.evaluate(() => typeof window.pages), 'undefined');
  assert.equal(await popup.evaluate(() => typeof require), 'undefined');
  await popup.close();
  results.push('popup browsing retains sandbox and has no privileged bridge');
  await page.click('#edit');
  await page.screenshot({ path: path.join(out, 'dark-editor.png') });
  await page.fill('#name-input', '开发面板');
  await page.click('#save');
  await expect(page.locator('#page-name')).toHaveText('开发面板');
  await waitGuest('Local page');
  await page.click('#overview');
  await expect(page.locator('#library')).toBeVisible();
  await page.click('#add');
  await page.fill('#name-input', '<img src=x onerror=alert(1)>');
  await page.fill('#url-input', url);
  await page.click('#save');
  await waitGuest('Local page');
  await expect(page.locator('.site-row')).toHaveCount(2);
  assert.equal(await page.locator('#sites img').count(), 0);
  await page.click('#edit');
  await page.click('#remove');
  await page.click('#remove');
  await expect(page.locator('.site-row')).toHaveCount(1);
  await page.locator('.site-row').click();
  await waitGuest('Local page');
  results.push('edit, overview, multiple saved pages, safe names and remove');
  await running.close();
  running = null;
  page = await launch();
  await expect(page.locator('button[data-theme="dark"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-plugin="vimium"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-plugin="toc"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  assert.equal(await running.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'system');
  await expect(page.locator('#page-name')).toHaveText('开发面板');
  await waitGuest('Local page');
  assert.match(await guestEval('document.cookie'), /session_test=retained/);
  assert.equal(await guestEval('localStorage.getItem("session_test")'), 'retained');
  results.push('saved names, addresses, selection, cookies and localStorage survive restart');
  await page.click('button[data-theme="system"]');
  await expect(page.locator('button[data-theme="system"]')).toHaveAttribute('aria-pressed', 'true');
  assert.equal(await running.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'system');
  assert.equal(await guestEval('matchMedia("(prefers-color-scheme: dark)").matches'), systemDark);
  await running.close();
  running = null;
  page = await launch();
  await expect(page.locator('button[data-theme="system"]')).toHaveAttribute('aria-pressed', 'true');
  assert.equal(await running.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'system');
  await waitGuest('Local page');
  assert.match(await guestEval('document.cookie'), /session_test=retained/);
  results.push('theme and plugin choices persist across restart; auto resolves OS appearance without overriding websites');
  await new Promise(resolve => server.close(resolve));
  await page.click('#reload');
  await expect(page.locator('#failure')).toBeVisible({ timeout: 15000 });
  await page.screenshot({ path: path.join(out, 'unavailable.png') });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  await page.click('#retry');
  await waitGuest('Local page');
  await expect(page.locator('#failure')).toBeHidden();
  results.push('stopped local server displays error; retry recovers');
  await page.click('#overview');
  await page.screenshot({ path: path.join(out, 'library.png') });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: results, rendererErrors: errors }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (running) await running.close();
  server.close();
  fs.rmSync(data, { recursive: true, force: true });
});

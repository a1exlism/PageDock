const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeURL, isLocalFileURL, canNavigateURL, Store } = require('../model.cjs');

test('local addresses retain HTTP and path, query, fragment and port', () => {
  assert.equal(normalizeURL(' localhost:3000/path?q=hello#panel '), 'http://localhost:3000/path?q=hello#panel');
  assert.equal(normalizeURL('127.0.0.1:8080'), 'http://127.0.0.1:8080/');
  assert.equal(normalizeURL('[::1]:9000'), 'http://[::1]:9000/');
  assert.equal(normalizeURL('192.168.1.20:80'), 'http://192.168.1.20/');
  assert.equal(normalizeURL('example.com'), 'https://example.com/');
  assert.equal(normalizeURL('http://machine.local:8080'), 'http://machine.local:8080/');
});

test('reject executable URLs, credentials and invalid ports', () => {
  for (const url of ['', 'javascript:alert(1)', 'data:text/html,hello', 'ftp://example.com', 'http://user:password@example.com', 'localhost:99999', 'https://', 'http://host name']) {
    assert.throws(() => normalizeURL(url), undefined, url);
  }
});

test('absolute and home-relative file paths encode filename characters without URL reinterpretation', () => {
  const expected = 'file:///synthetic/%E4%B8%AD%E6%96%87%20page%23%3F%25.html';
  assert.equal(normalizeURL('/synthetic/中文 page#?%.html'), expected);
  assert.equal(normalizeURL('  "/synthetic/中文 page#?%.html"  '), expected);
  assert.equal(normalizeURL("'/synthetic/中文 page#?%.html'"), expected);
  assert.equal(normalizeURL('~/Documents/guide.html', '/synthetic/home'), 'file:///synthetic/home/Documents/guide.html');
  assert.equal(normalizeURL('/synthetic/docs/../guide.html'), 'file:///synthetic/guide.html');
  assert.equal(normalizeURL('/synthetic/100%20.html'), 'file:///synthetic/100%2520.html');
});

test('file URLs preserve encoded filenames, query parameters and anchors across normalization', () => {
  for (const input of ['file:///synthetic/中文 page.html?mode=read#intro', 'file://localhost/synthetic/中文 page.html?mode=read#intro', 'file:/synthetic/中文 page.html?mode=read#intro']) {
    const result = normalizeURL(input);
    assert.equal(result, 'file:///synthetic/%E4%B8%AD%E6%96%87%20page.html?mode=read#intro');
    assert.equal(normalizeURL(result), result);
    assert.equal(isLocalFileURL(result), true);
  }
  assert.equal(normalizeURL('file:///synthetic/a%23b%3Fc%25.html#section'), 'file:///synthetic/a%23b%3Fc%25.html#section');
});

test('ambiguous relative paths, remote file authorities and malformed file URLs are rejected', () => {
  for (const input of ['./guide.html', '../guide.html', '~someone/guide.html', 'file:guide.html', 'file://example.com/guide.html', 'file:///synthetic/bad%2Fname.html', 'file:///synthetic/bad%00name.html', 'file:///synthetic/bad%.html', '/synthetic/bad\0name.html', '""']) {
    assert.throws(() => normalizeURL(input), undefined, 'Invalid path must be rejected');
  }
  assert.equal(isLocalFileURL('https://example.com/'), false);
  assert.equal(isLocalFileURL('file://example.com/guide.html'), false);
  assert.throws(() => normalizeURL('./guide.html'), /完整文件路径/);
});

test('only local file documents may navigate or open another local file', () => {
  const local = 'file:///synthetic/guide.html';
  const other = 'file:///synthetic/next.html#intro';
  assert.equal(canNavigateURL(other, local), true);
  assert.equal(canNavigateURL('https://example.com/', local), true);
  assert.equal(canNavigateURL('about:blank', local), true);
  for (const source of ['https://example.com/', 'about:blank', '', 'file://example.com/guide.html']) {
    assert.equal(canNavigateURL(other, source), false);
  }
  for (const target of ['javascript:alert(1)', 'data:text/html,hello', 'file://example.com/guide.html', 'file:///synthetic/bad%00name.html']) {
    assert.equal(canNavigateURL(target, local), false);
  }
});

test('saving and reopening local page metadata retains the file URL without accessing the target file', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pagedock-file-metadata-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const file = path.join(dir, 'pages.json');
  const store = new Store(file);
  const saved = store.save({ name: 'Synthetic local document', url: '/synthetic/中文 page#1.html' });
  assert.equal(saved.url, 'file:///synthetic/%E4%B8%AD%E6%96%87%20page%231.html');
  const reopened = new Store(file);
  assert.deepEqual(reopened.state.sites, [saved]);
  assert.equal(reopened.state.activeId, saved.id);
  reopened.save({ id: saved.id, name: saved.name, url: 'file:///synthetic/updated.html#intro' });
  assert.equal(new Store(file).state.sites[0].url, 'file:///synthetic/updated.html#intro');
});

test('editing, removal, selection and restart preserve consistent state', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webpage-app-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const file = path.join(dir, 'pages.json');
  const store = new Store(file);
  const first = store.save({ name: '本地面板', url: 'localhost:3000' });
  const second = store.save({ name: '公开站点', url: 'https://example.com' });
  store.save({ id: first.id, name: '开发面板', url: 'localhost:4000' });
  const reopened = new Store(file);
  assert.equal(reopened.state.activeId, first.id);
  assert.equal(reopened.state.sites[0].url, 'http://localhost:4000/');
  assert.throws(() => reopened.save({ id: 'missing', name: 'bad', url: 'https://example.com' }));
  assert.throws(() => reopened.select('missing'));
  reopened.remove(first.id);
  assert.equal(reopened.state.activeId, null);
  assert.deepEqual(reopened.state.sites.map(site => site.id), [second.id]);
  reopened.select(second.id);
  assert.equal(new Store(file).state.activeId, second.id);
});

test('corrupt state is reported and never silently overwritten', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webpage-app-corrupt-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const file = path.join(dir, 'pages.json');
  fs.writeFileSync(file, '{broken');
  assert.throws(() => new Store(file));
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
});

test('theme defaults to system and survives page changes and restart', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'webpage-app-theme-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const file = path.join(dir, 'pages.json');
  const store = new Store(file);
  assert.equal(store.state.theme, 'system');
  store.setTheme('dark');
  const site = store.save({ name: '测试', url: 'localhost:3000' });
  store.select(null);
  store.remove(site.id);
  assert.equal(new Store(file).state.theme, 'dark');
  assert.throws(() => store.setTheme('invalid'));
  assert.equal(new Store(file).state.theme, 'dark');
  fs.writeFileSync(file, JSON.stringify({ sites: [], activeId: null }));
  assert.equal(new Store(file).state.theme, 'system');
});

test('plugins default off, validate inputs and survive page edits and reload', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pagedock-tools-'));
  t.after(() => fs.rmSync(dir, { recursive: true }));
  const file = path.join(dir, 'pages.json');
  const store = new Store(file);
  assert.deepEqual(store.state.plugins, { vimium: false, toc: false });
  store.setPlugin('vimium', true);
  store.setPlugin('toc', true);
  const item = store.save({ name: 'Panel', url: 'localhost:3000' });
  store.setTheme('dark');
  store.remove(item.id);
  assert.deepEqual(new Store(file).state.plugins, { vimium: true, toc: true });
  assert.throws(() => store.setPlugin('__proto__', true));
  assert.throws(() => store.setPlugin('vimium', 'false'));
  store.setPlugin('toc', false);
  assert.deepEqual(new Store(file).state.plugins, { vimium: true, toc: false });
});

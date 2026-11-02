const $ = id => document.getElementById(id);
let state = { sites: [], activeId: null };
let editingId = null;
let saving = false;
let toastTimer;

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#i-${name}`);
  svg.append(use);
  return svg;
}

function displayAddress(value, compact = false) {
  try {
    const url = new URL(value);
    return url.protocol === 'file:' ? `${decodeURIComponent(url.pathname)}${url.search}${url.hash}` : compact ? url.host : value;
  } catch { return value; }
}

function badge(name) {
  const el = document.createElement('span');
  el.className = 'site-badge';
  el.textContent = Array.from(name)[0].toLocaleUpperCase();
  return el;
}

function showError(error) {
  $('toast').textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
}

async function select(id) {
  try { render(await window.pages.select(id)); } catch (error) { showError(error); }
}

function render(next) {
  state = next;
  document.documentElement.dataset.theme = state.resolvedTheme;
  for (const button of document.querySelectorAll('button[data-theme]')) {
    button.setAttribute('aria-pressed', button.dataset.theme === state.theme ? 'true' : 'false');
  }
  const active = state.sites.find(site => site.id === state.activeId);
  const collapsed = state.sidebarWidth === 0;
  document.documentElement.style.setProperty('--sidebar-width', `${state.sidebarWidth}px`);
  document.documentElement.style.setProperty('--header-height', `${state.headerHeight}px`);
  document.body.classList.toggle('zen-mode', state.zenMode);
  $('zen-bar').hidden = !state.zenMode;
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  document.body.classList.toggle('has-active-page', Boolean(active));
  $('sidebar').hidden = collapsed;
  $('sidebar-toggle').hidden = !active;
  $('sidebar-toggle').setAttribute('aria-expanded', String(!collapsed));
  $('sidebar-toggle').setAttribute('aria-label', collapsed ? '展开侧边栏' : '收起侧边栏');
  $('sidebar-toggle').title = collapsed ? '展开侧边栏' : '收起侧边栏';
  for (const button of document.querySelectorAll('[data-plugin]')) {
    button.setAttribute('aria-pressed', String(state.plugins[button.dataset.plugin]));
  }
  const query = $('search').value.trim().toLocaleLowerCase();
  const filtered = state.sites.filter(site => `${site.name} ${site.url} ${displayAddress(site.url)}`.toLocaleLowerCase().includes(query));
  $('sites').replaceChildren();
  $('cards').replaceChildren();
  for (const site of filtered) {
    const row = document.createElement('button');
    row.className = `site-row${site.id === state.activeId ? ' selected' : ''}`;
    row.setAttribute('aria-label', `打开 ${site.name}`);
    row.setAttribute('aria-current', site.id === state.activeId ? 'page' : 'false');
    row.title = displayAddress(site.url);
    const info = document.createElement('span');
    info.className = 'site-info';
    const name = document.createElement('strong');
    name.textContent = site.name;
    const url = document.createElement('small');
    url.textContent = displayAddress(site.url, true);
    info.append(name, url);
    row.append(badge(site.name), info);
    row.addEventListener('click', () => select(site.id));
    $('sites').append(row);
    const card = document.createElement('button');
    card.className = 'page-card';
    card.append(badge(site.name), name.cloneNode(true), url.cloneNode(true), icon('arrow'));
    card.addEventListener('click', () => select(site.id));
    $('cards').append(card);
  }
  $('count').textContent = state.sites.length;
  $('sidebar-empty').hidden = filtered.length !== 0;
  $('sidebar-empty').textContent = query ? '没有匹配的页面' : '常用页面会显示在这里';
  $('overview').classList.toggle('selected', !active);
  $('overview-heading').hidden = !!active;
  $('browser-controls').hidden = !active;
  $('header-add').hidden = !!active;
  $('welcome').hidden = !!active || state.sites.length > 0;
  $('library').hidden = !!active || state.sites.length === 0;
  $('failure').hidden = !active || !state.failure;
  $('failure-detail').textContent = state.failure || '';
  $('page-name').textContent = active?.name || '';
  const address = state.url || active?.url || '';
  $('location').textContent = displayAddress(address);
  $('location').title = displayAddress(address);
  const external = document.querySelector('[data-action="external"]');
  external.title = address.startsWith('file:') ? '在 Finder 中显示' : '在默认浏览器中打开';
  external.setAttribute('aria-label', external.title);
  $('back').disabled = !state.canBack;
  $('forward').disabled = !state.canForward;
  $('loading').hidden = !state.loading;
}

async function openEditor(site = null) {
  if ($('editor').open) return;
  editingId = site?.id || null;
  $('name-input').value = site?.name || '';
  $('url-input').value = site?.url || '';
  $('editor-title').textContent = site ? '编辑页面' : '新增页面';
  $('remove').hidden = !site;
  $('remove-note').hidden = !site;
  $('remove').textContent = '移除页面';
  $('remove').dataset.confirm = '';
  $('form-error').textContent = '';
  try {
    await window.pages.editor(true);
    $('editor').showModal();
    $('name-input').focus();
  } catch (error) { showError(error); }
}

async function closeEditor() {
  if (saving) return;
  $('editor').close();
  editingId = null;
  try { await window.pages.editor(false); } catch (error) { showError(error); }
}

for (const id of ['add', 'header-add', 'hero-add']) $(id).addEventListener('click', () => openEditor());
for (const id of ['edit', 'failure-edit']) $(id).addEventListener('click', () => openEditor(state.sites.find(site => site.id === state.activeId)));
for (const id of ['cancel', 'close-editor']) $(id).addEventListener('click', closeEditor);
for (const id of ['brand', 'overview']) $(id).addEventListener('click', () => select(null));
$('editor').addEventListener('cancel', event => { event.preventDefault(); closeEditor(); });
$('search').addEventListener('input', () => render(state));
$('sidebar-toggle').addEventListener('click', () => window.pages.sidebar().then(render).catch(showError));
for (const id of ['zen-toggle', 'zen-exit']) $(id).addEventListener('click', () => window.pages.zen().then(render).catch(showError));
for (const button of document.querySelectorAll('button[data-theme]')) {
  button.addEventListener('click', () => window.pages.theme(button.dataset.theme).then(render).catch(showError));
}
for (const button of document.querySelectorAll('[data-plugin]')) {
  button.addEventListener('click', () => window.pages.plugin(button.dataset.plugin, !state.plugins[button.dataset.plugin]).then(render).catch(showError));
}
for (const button of document.querySelectorAll('[data-action]')) {
  button.addEventListener('click', () => window.pages.navigate(button.dataset.action).catch(showError));
}
$('retry').addEventListener('click', () => window.pages.navigate('reload').catch(showError));
$('form').addEventListener('submit', async event => {
  event.preventDefault();
  if (saving) return;
  saving = true;
  $('save').disabled = true;
  $('form-error').textContent = '';
  try {
    const next = await window.pages.save({ id: editingId, name: $('name-input').value, url: $('url-input').value });
    saving = false;
    await closeEditor();
    render(next);
  } catch (error) {
    $('form-error').textContent = error.message.replace(/^Error invoking remote method '[^']+': Error: /, '');
  } finally { saving = false; $('save').disabled = false; }
});
$('remove').addEventListener('click', async () => {
  if (!$('remove').dataset.confirm) {
    $('remove').dataset.confirm = 'yes';
    $('remove').textContent = '确认移除';
    return;
  }
  try {
    render(await window.pages.remove(editingId));
    await closeEditor();
  } catch (error) { showError(error); }
});
window.pages.onState(render);
window.pages.onAdd(() => openEditor());
window.pages.state().then(render).catch(showError);

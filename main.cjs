const { app, BrowserWindow, WebContentsView, ipcMain, Menu, dialog, session, shell, nativeTheme } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { Store } = require('./model.cjs');

app.setName('PageDock');
const dataDir = process.env.WEBPAGE_APP_DATA_DIR;
if (dataDir) {
  if (!path.isAbsolute(dataDir)) throw new Error('WEBPAGE_APP_DATA_DIR must be an absolute path.');
  app.setPath('userData', dataDir);
} else {
  app.setPath('userData', path.join(app.getPath('appData'), 'WebpageApp'));
}

let win;
let store;
let view;
let overlay = false;
let failure = '';
let quitting = false;
let sidebarCollapsed = false;
let zenMode = false;
const sidebarExpandedWidth = 244;
const popups = new Set();
const guests = new Set();
const uiURL = pathToFileURL(path.join(__dirname, 'ui', 'index.html')).href;
const guestPreferences = { partition: 'persist:websites', sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, preload: path.join(__dirname, 'guest-preload.cjs') };

function resolvedTheme() {
  return store.state.theme === 'system' ? (nativeTheme.shouldUseDarkColors ? 'dark' : 'light') : store.state.theme;
}

function toolOptions(wc) {
  return { ...store.state.plugins, theme: resolvedTheme(), zen: zenMode && wc === view?.webContents };
}

function updateTools() {
  for (const wc of guests) {
    if (!wc.isDestroyed()) wc.send('guest:tools-update', toolOptions(wc));
  }
}

function isWebURL(value) {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
}

function currentState() {
  const wc = view?.webContents;
  const active = store.state.sites.find(site => site.id === store.state.activeId);
  return {
    ...store.state,
    resolvedTheme: resolvedTheme(),
    sidebarWidth: zenMode || sidebarCollapsed ? 0 : sidebarExpandedWidth,
    headerHeight: zenMode ? 32 : 88,
    zenMode,
    url: wc && !wc.isDestroyed() ? wc.getURL() || active?.url || '' : '',
    loading: wc && !wc.isDestroyed() ? wc.isLoading() : false,
    canBack: wc && !wc.isDestroyed() ? wc.navigationHistory.canGoBack() : false,
    canForward: wc && !wc.isDestroyed() ? wc.navigationHistory.canGoForward() : false,
    failure
  };
}

function emitState() {
  const zenItem = Menu.getApplicationMenu()?.getMenuItemById('zen-mode');
  if (zenItem) {
    zenItem.checked = zenMode;
    zenItem.enabled = Boolean(view) && !overlay;
  }
  if (win && !win.isDestroyed()) win.webContents.send('pages:changed', currentState());
}

function setZenMode(enabled) {
  zenMode = Boolean(enabled && view && !overlay);
  layout();
  updateTools();
  emitState();
  if (view && !overlay && !failure) view.webContents.focus();
  return currentState();
}

function handleZenShortcut(event, input) {
  const modifier = process.platform === 'darwin' ? input.meta && !input.control : input.control && !input.meta;
  if (input.type === 'keyDown' && input.key === 'Enter' && modifier && input.shift && !input.alt) {
    event.preventDefault();
    if (!input.isAutoRepeat) setZenMode(!zenMode);
  }
}

function updateAppearance() {
  const background = resolvedTheme() === 'dark' ? '#17191e' : '#f7f8fa';
  if (win && !win.isDestroyed()) win.setBackgroundColor(background);
  updateTools();
  emitState();
}

function layout() {
  if (!win) return;
  if (process.platform === 'darwin') win.setWindowButtonVisibility(!zenMode);
  if (!view) return;
  const [width, height] = win.getContentSize();
  const { sidebarWidth, headerHeight } = currentState();
  view.setBounds({ x: sidebarWidth, y: headerHeight, width: Math.max(1, width - sidebarWidth), height: Math.max(1, height - headerHeight) });
  view.setVisible(!overlay && !failure);
}

function secureGuest(wc) {
  guests.add(wc);
  wc.once('destroyed', () => guests.delete(wc));
  wc.on('will-navigate', (event, url) => {
    if (!isWebURL(url) && url !== 'about:blank') event.preventDefault();
  });
  wc.on('will-redirect', (event, url) => {
    if (!isWebURL(url) && url !== 'about:blank') event.preventDefault();
  });
  wc.setWindowOpenHandler(({ url }) => ({
    action: isWebURL(url) || url === 'about:blank' ? 'allow' : 'deny',
    overrideBrowserWindowOptions: {
      width: 1000, height: 760, autoHideMenuBar: true, backgroundColor: '#ffffff',
      webPreferences: guestPreferences
    }
  }));
  wc.on('did-create-window', child => {
    popups.add(child);
    child.on('closed', () => popups.delete(child));
    secureGuest(child.webContents);
  });
}

function releaseView() {
  if (!view) return;
  win.contentView.removeChildView(view);
  view.webContents.close({ waitForBeforeUnload: false });
  view = undefined;
}

function openSite(id) {
  releaseView();
  failure = '';
  const site = store.state.sites.find(item => item.id === id);
  sidebarCollapsed = Boolean(site);
  if (!site) {
    zenMode = false;
    layout();
    win.setTitle(app.name);
    emitState();
    return;
  }
  win.setTitle(`${site.name} — ${app.name}`);
  view = new WebContentsView({ webPreferences: guestPreferences });
  view.setBackgroundColor('#ffffff');
  win.contentView.addChildView(view);
  const wc = view.webContents;
  secureGuest(wc);
  wc.on('before-input-event', handleZenShortcut);
  wc.on('did-start-loading', () => { failure = ''; layout(); emitState(); });
  for (const event of ['did-stop-loading', 'did-navigate', 'did-navigate-in-page']) wc.on(event, emitState);
  wc.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
    if (!mainFrame || code === -3 || view?.webContents !== wc) return;
    failure = `${description} (${code})`;
    layout();
    emitState();
  });
  wc.on('render-process-gone', () => {
    if (view?.webContents !== wc) return;
    failure = '网页进程已退出，请重新加载。';
    layout();
    emitState();
  });
  layout();
  wc.loadURL(site.url).catch(() => {});
  emitState();
}

function navigate(action) {
  const wc = view?.webContents;
  if (!wc || wc.isDestroyed()) return;
  switch (action) {
    case 'back': if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); break;
    case 'forward': if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); break;
    case 'reload': failure = ''; layout(); wc.reload(); break;
    case 'home': {
      const site = store.state.sites.find(item => item.id === store.state.activeId);
      if (site) wc.loadURL(site.url).catch(() => {});
      break;
    }
    case 'external': if (isWebURL(wc.getURL())) return shell.openExternal(wc.getURL()); break;
    default: throw new Error('不支持的操作。');
  }
}

function registerIPC() {
  ipcMain.handle('guest:tools', event => {
    if (!guests.has(event.sender) || event.senderFrame !== event.sender.mainFrame || !isWebURL(event.senderFrame.url)) {
      throw new Error('请求来源不受信任。');
    }
    return toolOptions(event.sender);
  });
  const actions = {
    state: () => currentState(),
    zen: () => setZenMode(!zenMode),
    sidebar: () => {
      sidebarCollapsed = store.state.activeId ? !sidebarCollapsed : false;
      layout();
      emitState();
      return currentState();
    },
    theme: (_event, theme) => {
      store.setTheme(theme);
      updateAppearance();
      return currentState();
    },
    plugin: (_event, name, enabled) => {
      store.setPlugin(name, enabled);
      updateTools();
      emitState();
      return currentState();
    },
    save: (_event, input) => {
      const result = store.save(input);
      openSite(result.id);
      return currentState();
    },
    select: (_event, id) => {
      store.select(id);
      openSite(id);
      return currentState();
    },
    remove: (_event, id) => {
      const active = store.state.activeId === id;
      store.remove(id);
      if (active) openSite(null);
      emitState();
      return currentState();
    },
    navigate: (_event, action) => navigate(action),
    editor: (_event, open) => {
      overlay = open === true;
      if (overlay) zenMode = false;
      layout();
      updateTools();
      emitState();
    }
  };
  for (const [name, action] of Object.entries(actions)) {
    ipcMain.handle(`pages:${name}`, async (event, ...args) => {
      if (event.sender !== win?.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== uiURL) {
        throw new Error('请求来源不受信任。');
      }
      return action(event, ...args);
    });
  }
}

function createWindow() {
  overlay = false;
  zenMode = false;
  sidebarCollapsed = Boolean(store.state.activeId);
  win = new BrowserWindow({
    width: 1240, height: 820, minWidth: 860, minHeight: 600, title: app.name,
    titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 20, y: 22 },
    backgroundColor: resolvedTheme() === 'dark' ? '#17191e' : '#f7f8fa', show: false,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.cjs') }
  });
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.on('before-input-event', handleZenShortcut);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.on('resize', layout);
  win.on('close', () => { releaseView(); });
  win.on('closed', () => { win = undefined; });
  win.once('ready-to-show', () => { win.show(); openSite(store.state.activeId); });
  win.loadURL(uiURL);
}

function configureSession() {
  const guestSession = session.fromPartition('persist:websites');
  const approved = new Set();
  guestSession.setPermissionCheckHandler((_wc, permission, origin) => approved.has(`${origin}|${permission}`));
  guestSession.setPermissionRequestHandler(async (wc, permission, callback, details) => {
    const labels = { media: '使用摄像头或麦克风', geolocation: '访问位置', notifications: '发送通知', clipboardReadWrite: '读取剪贴板', 'clipboard-sanitized-write': '写入剪贴板', fullscreen: '进入全屏', 'local-network-access': '访问本地网络', 'local-network': '访问本地网络', 'loopback-network': '访问本地服务' };
    if (!wc || wc.isDestroyed() || !labels[permission]) return callback(false);
    const url = details.requestingUrl || wc.getURL();
    if (!isWebURL(url)) return callback(false);
    const origin = new URL(url).origin;
    const key = `${origin}|${permission}`;
    if (approved.has(key)) return callback(true);
    const parent = BrowserWindow.fromWebContents(wc) || win;
    try {
      const { response } = await dialog.showMessageBox(parent, { type: 'question', title: '网页权限', message: `允许此网站${labels[permission]}？`, detail: origin, buttons: ['不允许', '允许'], defaultId: 0, cancelId: 0 });
      if (response === 1) approved.add(key);
      callback(response === 1);
    } catch { callback(false); }
  });
}

function setupMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: app.name, submenu: [{ role: 'about', label: `关于 ${app.name}` }, { type: 'separator' }, { role: 'hide', label: `隐藏 ${app.name}` }, { role: 'hideOthers', label: '隐藏其他' }, { role: 'unhide', label: '显示全部' }, { type: 'separator' }, { role: 'quit', label: `退出 ${app.name}` }] },
    { label: '文件', submenu: [{ label: '新增页面…', accelerator: 'CmdOrCtrl+N', click: () => { if (!win) createWindow(); win.webContents.send('pages:add'); } }, { role: 'close', label: '关闭窗口' }] },
    { label: '编辑', submenu: [{ role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' }, { role: 'cut', label: '剪切' }, { role: 'copy', label: '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] },
    { label: '浏览', submenu: [{ label: '后退', accelerator: 'CmdOrCtrl+[', click: () => navigate('back') }, { label: '前进', accelerator: 'CmdOrCtrl+]', click: () => navigate('forward') }, { label: '刷新', accelerator: 'CmdOrCtrl+R', click: () => navigate('reload') }, { label: '打开保存的网址', click: () => navigate('home') }, { type: 'separator' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' }, { role: 'resetZoom', label: '实际大小' }, { role: 'togglefullscreen', label: '切换全屏' }, { label: '网页开发者工具', accelerator: 'Alt+CmdOrCtrl+I', click: () => view?.webContents.openDevTools({ mode: 'detach' }) }] },
    { label: '专注', submenu: [{ id: 'zen-mode', label: 'Zen Mode', type: 'checkbox', enabled: false, accelerator: 'CmdOrCtrl+Shift+Enter', click: () => setZenMode(!zenMode) }] },
    { role: 'windowMenu', label: '窗口' }
  ]));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (!win) createWindow(); if (win.isMinimized()) win.restore(); win.show(); win.focus(); });
  app.on('before-quit', () => { quitting = true; for (const popup of popups) popup.destroy(); });
  app.on('activate', () => { if (!win && !quitting) createWindow(); });
  app.whenReady().then(() => {
    const dir = app.getPath('userData');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    store = new Store(path.join(dir, 'pages.json'));
    nativeTheme.themeSource = 'system';
    nativeTheme.on('updated', updateAppearance);
    registerIPC();
    configureSession();
    setupMenu();
    createWindow();
  }).catch(error => { dialog.showErrorBox(`无法打开 ${app.name}`, error.message); app.quit(); });
}

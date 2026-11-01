const { ipcRenderer } = require('electron');

if (process.isMainFrame) {
  let options = { vimium: false, toc: false, theme: 'light' };
  let host;
  let shadow;
  let tocOpen = false;
  let helpOpen = false;
  let headings = [];
  let hints = [];
  let hintPrefix = '';
  let openInNewWindow = false;
  let gPending = false;
  let gTimer;
  let tocTimer;
  let scrollFrame;
  let pointer = { x: 1, y: 1 };
  let listening = false;
  const observer = new MutationObserver(() => {
    clearTimeout(tocTimer);
    tocTimer = setTimeout(refreshTOC, 180);
  });

  const styles = `
    :host{all:initial!important;position:fixed!important;inset:0!important;z-index:2147483646!important;pointer-events:none!important;display:block!important;}
    *{box-sizing:border-box}button{font:inherit;cursor:pointer}button:focus-visible{outline:2px solid #5593df;outline-offset:3px}
    .surface{--bg:#fff;--text:#26303e;--muted:#758194;--border:#dce2eb;--hover:#f0f4fa;--active:#e7effb;--accent:#3567a8;color-scheme:light;color:var(--text);background:var(--bg);font:13px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;border:1px solid var(--border);box-shadow:0 8px 32px #172b4522;pointer-events:auto}
    :host([data-theme=dark]) .surface{--bg:#23272f;--text:#e1e6ef;--muted:#a2acbc;--border:#3a424e;--hover:#303744;--active:#30425d;--accent:#9ac1f4;color-scheme:dark;box-shadow:0 8px 32px #0005}
    .toc-toggle{position:fixed;right:18px;top:16px;border-radius:8px;padding:8px 13px;display:flex;gap:9px;align-items:center;font-weight:600}.toc-toggle span{font:11px/1.4 ui-monospace,monospace;color:var(--muted)}
    .toc-panel{position:fixed;right:18px;top:60px;width:min(290px,calc(100vw - 36px));max-height:min(520px,calc(100vh - 90px));border-radius:12px;overflow:hidden;display:flex;flex-direction:column}
    .heading{display:flex;align-items:center;justify-content:space-between;padding:13px 15px;border-bottom:1px solid var(--border);font-weight:600}.close{color:var(--muted);border:0;background:none;border-radius:4px;padding:0 6px;font-size:20px}.close:hover{background:var(--hover)}
    .toc-list{padding:8px;overflow:auto;overscroll-behavior:contain}.toc-entry{display:block;width:100%;border:0;border-radius:6px;background:none;color:var(--text);text-align:left;padding:7px 10px;line-height:1.55;overflow-wrap:anywhere}.toc-entry:hover{background:var(--hover)}.toc-entry[aria-current=true]{background:var(--active);color:var(--accent)}.empty{color:var(--muted);padding:12px 8px;margin:0;font-size:12px}
    .hint{position:fixed;pointer-events:none;border:1px solid #9e7a13;border-radius:3px;background:#ffe69c;color:#322506;padding:1px 4px;font:700 12px/17px ui-monospace,Menlo,monospace;box-shadow:0 1px 4px #0004;letter-spacing:1px}.hint em{font-style:normal;color:#a99564}
    .help{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);border-radius:13px;width:min(390px,calc(100vw - 40px));max-height:calc(100vh - 40px);overflow:auto}.help dl{margin:0;padding:14px 20px;display:grid;grid-template-columns:95px 1fr;gap:10px 15px}.help dt{font:600 12px/1.6 ui-monospace,Menlo,monospace;color:var(--accent)}.help dd{margin:0;font-size:12px}.help p{margin:0 20px 18px;color:var(--muted);font-size:11px;line-height:1.7}
  `;

  function mount() {
    if (host?.isConnected) return;
    host = document.createElement('div');
    host.setAttribute('data-pagedock-tools', '');
    host.setAttribute('data-theme', options.theme);
    host.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483646!important;pointer-events:none!important;display:block!important';
    shadow = host.attachShadow({ mode: 'open' });
    const style = new CSSStyleSheet();
    style.replaceSync(styles);
    shadow.adoptedStyleSheets = [style];
    document.documentElement.append(host);
  }

  function trimHost() {
    if (!options.toc && !helpOpen && hints.length === 0) {
      host?.remove();
      host = undefined;
      shadow = undefined;
    }
  }

  function button(label, className, action) {
    const element = document.createElement('button');
    element.type = 'button';
    element.className = className;
    element.textContent = label;
    element.addEventListener('click', action);
    return element;
  }

  function visible(element) {
    const style = getComputedStyle(element);
    return element.getClientRects().length > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function refreshTOC() {
    if (!options.toc) return;
    mount();
    headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).filter(element => visible(element) && element.textContent.trim());
    shadow.querySelector('.toc-toggle')?.remove();
    shadow.querySelector('.toc-panel')?.remove();
    const toggle = button('目录', 'surface toc-toggle', () => { tocOpen = !tocOpen; refreshTOC(); });
    toggle.setAttribute('aria-expanded', String(tocOpen));
    toggle.setAttribute('aria-label', '切换页面目录');
    const count = document.createElement('span');
    count.textContent = headings.length;
    toggle.append(count);
    shadow.append(toggle);
    if (!tocOpen) return;
    const panel = document.createElement('section');
    panel.className = 'surface toc-panel';
    panel.setAttribute('aria-label', '页面目录');
    const header = document.createElement('div');
    header.className = 'heading';
    header.textContent = '页面目录';
    const close = button('×', 'close', () => { tocOpen = false; refreshTOC(); });
    close.setAttribute('aria-label', '收起目录');
    header.append(close);
    const list = document.createElement('nav');
    list.className = 'toc-list';
    const minLevel = Math.min(...headings.map(element => Number(element.tagName[1])));
    for (const [index, heading] of headings.entries()) {
      const entry = button(heading.textContent.trim(), 'toc-entry', () => {
        heading.scrollIntoView({ behavior: 'auto', block: 'start' });
        markCurrentHeading();
      });
      entry.style.paddingLeft = `${10 + (Number(heading.tagName[1]) - minLevel) * 12}px`;
      entry.dataset.heading = index;
      list.append(entry);
    }
    if (headings.length === 0) {
      const message = document.createElement('p');
      message.className = 'empty';
      message.textContent = '此页面暂无可识别的标题。';
      list.append(message);
    }
    panel.append(header, list);
    shadow.append(panel);
    markCurrentHeading();
  }

  function markCurrentHeading() {
    if (!options.toc || !tocOpen || !shadow) return;
    let active = 0;
    for (const [index, heading] of headings.entries()) {
      if (heading.getBoundingClientRect().top <= 110) active = index;
    }
    for (const entry of shadow.querySelectorAll('.toc-entry')) entry.setAttribute('aria-current', String(Number(entry.dataset.heading) === active));
  }

  function clearHints() {
    for (const hint of hints) hint.label.remove();
    hints = [];
    hintPrefix = '';
    trimHost();
  }

  function startHints(newWindow) {
    clearHints();
    const elements = Array.from(document.querySelectorAll('a[href],button,input[type=button],input[type=submit],[role=button],summary,[tabindex]')).filter(element => {
      if (!visible(element) || element.disabled || element.getAttribute('aria-disabled') === 'true' || element.tabIndex < 0) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
    }).slice(0, 500);
    if (!elements.length) return;
    mount();
    openInNewWindow = newWindow;
    const alphabet = 'asdfghjkl';
    const width = Math.max(1, Math.ceil(Math.log(elements.length) / Math.log(alphabet.length)));
    hints = elements.map((element, index) => {
      let code = '';
      let value = index;
      for (let i = 0; i < width; i++) { code = alphabet[value % alphabet.length] + code; value = Math.floor(value / alphabet.length); }
      const rect = element.getBoundingClientRect();
      const label = document.createElement('span');
      label.className = 'hint';
      label.textContent = code.toUpperCase();
      label.style.left = `${Math.max(0, Math.min(rect.left, innerWidth - 35))}px`;
      label.style.top = `${Math.max(0, Math.min(rect.top, innerHeight - 22))}px`;
      shadow.append(label);
      return { element, code, label };
    });
  }

  function followHint(key) {
    hintPrefix += key.toLowerCase();
    const candidates = hints.filter(hint => hint.code.startsWith(hintPrefix));
    if (!candidates.length) { clearHints(); return; }
    const match = candidates.find(hint => hint.code === hintPrefix);
    if (match) {
      const element = match.element;
      clearHints();
      if (openInNewWindow && element instanceof HTMLAnchorElement && /^https?:/.test(element.href)) {
        window.open(element.href, '_blank', 'noopener');
      } else {
        element.focus({ preventScroll: true });
        element.click();
      }
      return;
    }
    for (const hint of hints) {
      hint.label.hidden = !hint.code.startsWith(hintPrefix);
      hint.label.replaceChildren();
      const prefix = document.createElement('em');
      prefix.textContent = hint.code.slice(0, hintPrefix.length).toUpperCase();
      hint.label.append(prefix, document.createTextNode(hint.code.slice(hintPrefix.length).toUpperCase()));
    }
  }

  function showHelp() {
    mount();
    helpOpen = true;
    shadow.querySelector('.help')?.remove();
    const panel = document.createElement('section');
    panel.className = 'surface help';
    panel.setAttribute('aria-label', 'Vimium Lite 快捷键');
    const header = document.createElement('div');
    header.className = 'heading';
    header.textContent = 'Vimium Lite';
    const close = button('×', 'close', hideHelp);
    close.setAttribute('aria-label', '关闭快捷键帮助');
    header.append(close);
    const list = document.createElement('dl');
    for (const [keys, description] of [['j / k', '向下 / 向上滚动'], ['h / l', '向左 / 向右滚动'], ['d / u', '向下 / 向上半页'], ['gg / G', '顶部 / 底部'], ['f / F', '打开链接 / 在新窗口打开链接'], ['H / L', '后退 / 前进'], ['r', '刷新页面'], ['? / Esc', '查看帮助 / 关闭提示']]) {
      const term = document.createElement('dt');
      term.textContent = keys;
      const detail = document.createElement('dd');
      detail.textContent = description;
      list.append(term, detail);
    }
    const note = document.createElement('p');
    note.textContent = '输入框、文本编辑器和输入法组合输入期间不拦截按键。';
    panel.append(header, list, note);
    shadow.append(panel);
  }

  function hideHelp() {
    helpOpen = false;
    shadow?.querySelector('.help')?.remove();
    trimHost();
  }

  function scrollTarget() {
    let element = document.elementFromPoint(pointer.x, pointer.y);
    if (element === host) element = document.activeElement;
    while (element && element !== document.documentElement) {
      const style = getComputedStyle(element);
      if (/(auto|scroll)/.test(style.overflowY + style.overflowX) && (element.scrollHeight > element.clientHeight + 2 || element.scrollWidth > element.clientWidth + 2)) return element;
      element = element.parentElement;
    }
    return document.scrollingElement || document.documentElement;
  }

  function onPointer(event) { pointer = { x: event.clientX, y: event.clientY }; }

  function onScroll(event) {
    if (event.composedPath().includes(host)) return;
    if (hints.length) clearHints();
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(markCurrentHeading);
  }

  function onKey(event) {
    if (!event.isTrusted || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Escape') {
      const handled = hints.length > 0 || helpOpen;
      clearHints();
      hideHelp();
      gPending = false;
      if (handled) { event.preventDefault(); event.stopImmediatePropagation(); }
      return;
    }
    if (!options.vimium) return;
    const editing = event.composedPath().some(element => element instanceof Element && (element.matches('input,textarea,select,[role=textbox],[role=combobox],.monaco-editor,.cm-editor') || element.isContentEditable));
    if (editing) return;
    if (hints.length) {
      if (event.key.length === 1) { event.preventDefault(); event.stopImmediatePropagation(); followHint(event.key); }
      return;
    }
    const key = event.key;
    if (!['j', 'k', 'h', 'l', 'd', 'u', 'g', 'G', 'f', 'F', 'H', 'L', 'r', '?'].includes(key)) { gPending = false; return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    const target = scrollTarget();
    const halfPage = Math.round((target === document.scrollingElement ? innerHeight : target.clientHeight) / 2);
    if (key === 'g') {
      if (gPending) { target.scrollTo({ top: 0, behavior: 'instant' }); gPending = false; }
      else { gPending = true; clearTimeout(gTimer); gTimer = setTimeout(() => { gPending = false; }, 700); }
      return;
    }
    gPending = false;
    if (key === 'G') target.scrollTo({ top: target.scrollHeight, behavior: 'instant' });
    else if (['j', 'k', 'd', 'u'].includes(key)) target.scrollBy({ top: { j: 90, k: -90, d: halfPage, u: -halfPage }[key], behavior: 'instant' });
    else if (['h', 'l'].includes(key)) target.scrollBy({ left: key === 'h' ? -80 : 80, behavior: 'instant' });
    else if (key === 'f' || key === 'F') startHints(key === 'F');
    else if (key === 'H') history.back();
    else if (key === 'L') history.forward();
    else if (key === 'r') location.reload();
    else if (key === '?') showHelp();
  }

  function applyOptions(next) {
    const wasTOC = options.toc;
    options = next;
    const active = options.vimium || options.toc;
    if (active !== listening) {
      const action = active ? 'addEventListener' : 'removeEventListener';
      document[action]('keydown', onKey, true);
      document[action]('pointermove', onPointer, true);
      document[action]('scroll', onScroll, true);
      listening = active;
    }
    if (!options.vimium) { clearHints(); hideHelp(); gPending = false; clearTimeout(gTimer); }
    host?.setAttribute('data-theme', options.theme);
    if (options.toc) {
      if (!wasTOC) tocOpen = true;
      refreshTOC();
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    } else {
      observer.disconnect();
      clearTimeout(tocTimer);
      headings = [];
      shadow?.querySelector('.toc-toggle')?.remove();
      shadow?.querySelector('.toc-panel')?.remove();
      trimHost();
    }
  }

  window.addEventListener('DOMContentLoaded', async () => {
    if (!/^https?:/.test(location.protocol)) return;
    ipcRenderer.on('guest:tools-update', (_event, next) => applyOptions(next));
    try { applyOptions(await ipcRenderer.invoke('guest:tools')); } catch {}
  }, { once: true });
}

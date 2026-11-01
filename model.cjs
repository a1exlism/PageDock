const fs = require('node:fs');
const { randomUUID } = require('node:crypto');

function normalizeURL(input) {
  if (typeof input !== 'string' || !input.trim() || input.length > 8192) {
    throw new Error('请输入有效的网址。');
  }
  let value = input.trim();
  if (!/^https?:\/\//i.test(value)) {
    const local = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(value);
    if (/^[a-z][a-z\d+.-]*:/i.test(value) && !/^[^/:]+:\d+(?:[/?#]|$)/.test(value) && !local) {
      throw new Error('仅支持 http:// 或 https:// 网页。');
    }
    value = `${local ? 'http' : 'https'}://${value}`;
  }
  let url;
  try { url = new URL(value); } catch { throw new Error('网址格式不正确，请检查地址和端口。'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('请输入不包含账号密码的 HTTP 或 HTTPS 网址。');
  }
  return url.href;
}

function validateSite(input) {
  if (!input || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80) {
    throw new Error('请填写名称，长度不超过 80 个字符。');
  }
  return { name: input.name.trim(), url: normalizeURL(input.url) };
}

class Store {
  constructor(file) {
    this.file = file;
    this.state = { sites: [], activeId: null, theme: 'system', plugins: { vimium: false, toc: false } };
    if (!fs.existsSync(file)) return;
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Array.isArray(state.sites) || state.sites.some(site => typeof site.id !== 'string' || !site.id)) {
      throw new Error('页面列表文件格式不正确。');
    }
    if (new Set(state.sites.map(site => site.id)).size !== state.sites.length) throw new Error('页面列表包含重复标识。');
    this.state.sites = state.sites.map(site => ({ id: site.id, ...validateSite(site) }));
    this.state.activeId = this.state.sites.some(site => site.id === state.activeId) ? state.activeId : null;
    if (['system', 'light', 'dark'].includes(state.theme)) this.state.theme = state.theme;
    for (const name of Object.keys(this.state.plugins)) {
      if (typeof state.plugins?.[name] === 'boolean') this.state.plugins[name] = state.plugins[name];
    }
  }

  commit(next) {
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
    fs.renameSync(`${this.file}.tmp`, this.file);
    this.state = next;
  }

  save(input) {
    const site = validateSite(input);
    if (input.id && !this.state.sites.some(item => item.id === input.id)) throw new Error('这个页面已被移除。');
    const result = { id: input.id || randomUUID(), ...site };
    const sites = input.id ? this.state.sites.map(item => item.id === input.id ? result : item) : [...this.state.sites, result];
    this.commit({ ...this.state, sites, activeId: result.id });
    return result;
  }

  select(id) {
    if (id !== null && !this.state.sites.some(site => site.id === id)) throw new Error('找不到这个页面。');
    this.commit({ ...this.state, activeId: id });
  }

  remove(id) {
    this.commit({ ...this.state, sites: this.state.sites.filter(site => site.id !== id), activeId: this.state.activeId === id ? null : this.state.activeId });
  }

  setTheme(theme) {
    if (!['system', 'light', 'dark'].includes(theme)) throw new Error('不支持的外观模式。');
    this.commit({ ...this.state, theme });
  }

  setPlugin(name, enabled) {
    if (!['vimium', 'toc'].includes(name) || typeof enabled !== 'boolean') throw new Error('不支持的插件设置。');
    this.commit({ ...this.state, plugins: { ...this.state.plugins, [name]: enabled } });
  }
}

module.exports = { normalizeURL, validateSite, Store };

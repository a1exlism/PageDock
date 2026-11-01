const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pages', {
  state: () => ipcRenderer.invoke('pages:state'),
  theme: mode => ipcRenderer.invoke('pages:theme', mode),
  plugin: (name, enabled) => ipcRenderer.invoke('pages:plugin', name, enabled),
  save: site => ipcRenderer.invoke('pages:save', site),
  select: id => ipcRenderer.invoke('pages:select', id),
  remove: id => ipcRenderer.invoke('pages:remove', id),
  navigate: action => ipcRenderer.invoke('pages:navigate', action),
  editor: open => ipcRenderer.invoke('pages:editor', open),
  onState: listener => ipcRenderer.on('pages:changed', (_event, state) => listener(state)),
  onAdd: listener => ipcRenderer.on('pages:add', listener)
});

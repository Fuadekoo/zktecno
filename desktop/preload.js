// Only the setup screen uses this: a small, explicit bridge to the main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  get: () => ipcRenderer.invoke('setup:get'),
  test: (form) => ipcRenderer.invoke('setup:test', form),
  save: (form) => ipcRenderer.invoke('setup:save', form),
  openLogs: () => ipcRenderer.invoke('setup:openLogs'),
  onState: (fn) => ipcRenderer.on('setup:state', (_e, state) => fn(state)),
});

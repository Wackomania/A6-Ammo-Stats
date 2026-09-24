const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  pickFile: (label) => ipcRenderer.invoke('pbo:pickFile', label),
  loadPbos: (paths) => ipcRenderer.invoke('pbo:load', paths),
  applyEdits: (args) => ipcRenderer.invoke('pbo:applyEdits', args),
  pack: (sourceLabel) => ipcRenderer.invoke('pbo:pack', { sourceLabel }),
});

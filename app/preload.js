const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('api', {
  onOpen: cb => ipcRenderer.on('open-files', (_, p) => cb(p)),
  onBrowse: cb => ipcRenderer.on('browse', cb),
  cancel: () => ipcRenderer.send('cancel'),
  pick: () => ipcRenderer.invoke('pick'),
  rip: p => ipcRenderer.invoke('rip', p),
  onProgress: cb => ipcRenderer.on('progress', (_, d) => cb(d)),
  win: a => ipcRenderer.send('win', a),
  open: p => ipcRenderer.send('open', p),
  fileURL: (dir, file) => 'file://' + (dir + '/' + file).split('/').map(encodeURIComponent).join('/'),
  pathFor: f => webUtils.getPathForFile(f)
});

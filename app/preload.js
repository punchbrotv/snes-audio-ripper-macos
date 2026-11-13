const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('api', {
  onOpen: cb => ipcRenderer.on('open-files', (_, p) => cb(p)),
  onBrowse: cb => ipcRenderer.on('browse', cb),
  cancel: () => ipcRenderer.send('cancel'),
  pick: () => ipcRenderer.invoke('pick'),
  rip: (p, format) => ipcRenderer.invoke('rip', p, format),
  onProgress: cb => ipcRenderer.on('progress', (_, d) => cb(d)),
  win: a => ipcRenderer.send('win', a),
  openMidi: file => ipcRenderer.invoke('open-midi', file),
  open: p => ipcRenderer.send('open', p),
  fileURL: (dir, file) => 'file://' + (dir + '/' + file).split('/').map(encodeURIComponent).join('/'),
  pathFor: f => webUtils.getPathForFile(f)
});

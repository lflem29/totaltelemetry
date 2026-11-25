'use strict';

const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('communityHost', {
  recordSummary: () => ipcRenderer.invoke('community-host-record-summary'),
  state: () => ipcRenderer.invoke('community-host-state'),
  onProxyExit: callback => ipcRenderer.on('community-host-proxy-exit',(_,message) => callback(message)),
  start: options => ipcRenderer.invoke('community-host-start', options),
  stop: () => ipcRenderer.invoke('community-host-stop'),
  chooseDirectory: initial => ipcRenderer.invoke('community-host-choose-directory', initial),
  openUpdates: () => ipcRenderer.invoke('community-host-open-updates'),
  bundledKey: () => ipcRenderer.invoke('community-host-bundled-key'),
  generateKey: () => ipcRenderer.invoke('community-host-generate-key'),
  copy: value => ipcRenderer.invoke('community-host-copy', value)
});

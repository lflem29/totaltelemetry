'use strict';

const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('communityHost', {
  state: () => ipcRenderer.invoke('community-host-state'),
  start: options => ipcRenderer.invoke('community-host-start', options),
  stop: () => ipcRenderer.invoke('community-host-stop'),
  chooseDirectory: initial => ipcRenderer.invoke('community-host-choose-directory', initial),
  bundledKey: () => ipcRenderer.invoke('community-host-bundled-key'),
  generateKey: () => ipcRenderer.invoke('community-host-generate-key'),
  copy: value => ipcRenderer.invoke('community-host-copy', value)
});

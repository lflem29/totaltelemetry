'use strict';

const {app, BrowserWindow, Menu, clipboard, dialog, ipcMain, safeStorage} = require('electron');
const {randomBytes, randomUUID} = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createCommunityServer} = require('./server.cjs');
const {communityDefaults} = require('./package.json');

let window, server, pending = false;
let settings;

function addresses() {
  return [...new Set(Object.values(os.networkInterfaces()).flat()
    .filter(link => link.family === 'IPv4' && !link.internal).map(link => link.address))];
}

function snapshot() {
  return {...settings, version:app.getVersion(), running:Boolean(server?.listening), addresses:addresses(), advertisedAddress:communityDefaults.host};
}

function protectKey(key) {
  if (!safeStorage.isEncryptionAvailable() ||
      (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) return undefined;
  return safeStorage.encryptString(key).toString('base64');
}

function saveSettings(value) {
  const destination = path.join(app.getPath('userData'), 'server-settings.json');
  const temporary = destination + '.' + randomUUID();
  const {key, ownerPassword, ...preferences} = value;
  try {
    fs.writeFileSync(temporary, JSON.stringify({...preferences, protectedKey:protectKey(key), protectedOwnerPassword:protectKey(ownerPassword)}, null, 2), {flag:'wx'});
    fs.renameSync(temporary, destination);
  } finally {
    fs.rmSync(temporary, {force:true});
  }
}

function loadSettings() {
  const defaults = {port:communityDefaults.port, scope:'network', directory:path.join(app.getPath('userData'), 'laps'),
    key:communityDefaults.key || randomBytes(24).toString('hex'), ownerPassword:randomBytes(24).toString('hex')};
  try {
    const {protectedKey, protectedOwnerPassword, port, scope, directory} = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'server-settings.json'), 'utf8'));
    const decrypt = (encrypted, fallback) => {
      try { return safeStorage.decryptString(Buffer.from(encrypted, 'base64')); } catch { return fallback; }
    };
    return {port, scope, directory, key:decrypt(protectedKey, defaults.key),
      ownerPassword:decrypt(protectedOwnerPassword, defaults.ownerPassword)};
  } catch {
    return defaults;
  }
}

function listen(listener, port, host) {
  return new Promise((resolve, reject) => {
    const failed = error => reject(error);
    listener.once('error', failed);
    listener.listen(port, host, () => {
      listener.removeListener('error', failed);
      resolve();
    });
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app.whenReady().then(() => {
    settings = loadSettings();
    Menu.setApplicationMenu(null);
    window = new BrowserWindow({width:740, height:640, minWidth:640, minHeight:660, useContentSize:true, backgroundColor:'#101513',
      title:'Total Telemetry Community Server', webPreferences:{preload:path.join(__dirname, 'preload.cjs'),
        sandbox:true, contextIsolation:true, nodeIntegration:false}});
    window.webContents.setWindowOpenHandler(() => ({action:'deny'}));
    window.webContents.on('will-navigate', event => event.preventDefault());

    function handle(channel, action) {
      ipcMain.handle(channel, (event, ...args) => {
        if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
          throw new Error('Unrecognised server window.');
        }
        return action(...args);
      });
    }
    handle('community-host-state', snapshot);
    handle('community-host-choose-directory', async initial => {
      const result = await dialog.showOpenDialog(window, {
        defaultPath:typeof initial === 'string' ? initial : settings.directory,
        properties:['openDirectory', 'createDirectory']
      });
      return result.canceled ? null : result.filePaths[0];
    });
    handle('community-host-copy', text => {
      if (typeof text === 'string' && text.length <= 256) clipboard.writeText(text);
    });
    handle('community-host-bundled-key', () => communityDefaults.key);
    handle('community-host-generate-key', () => randomBytes(24).toString('hex'));
    handle('community-host-start', async ({port, scope, directory, key, ownerPassword}) => {
      if (pending || server) throw new Error('The server is already running or changing state.');
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Enter a port from 1 to 65535.');
      if (!['network','local'].includes(scope) || typeof directory !== 'string' || !path.isAbsolute(directory)) {
        throw new Error('Choose a binding and an absolute lap storage folder.');
      }
      if (!ownerPassword) throw new Error('Choose an owner password.');
      const next = {port, scope, directory, key, ownerPassword};
      pending = true;
      let listener;
      try {
        listener = createCommunityServer({...next, onError:message => console.error(message)});
        await listen(listener, port, scope === 'local' ? '127.0.0.1' : '0.0.0.0');
        saveSettings(next);
        settings = next;
        server = listener;
        return snapshot();
      } catch (error) {
        if (listener?.listening) listener.close();
        if (error.code === 'EADDRINUSE') throw new Error('Port ' + port + ' is already in use. Choose another port.');
        throw error;
      } finally {
        pending = false;
      }
    });
    handle('community-host-stop', async () => {
      if (pending) throw new Error('The server is changing state.');
      if (!server) return snapshot();
      pending = true;
      try {
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        server = null;
        return snapshot();
      } finally {
        pending = false;
      }
    });
    void window.loadFile(path.join(__dirname, 'index.html'));
  });
}

app.on('window-all-closed', () => app.quit());

'use strict';

const {app, BrowserWindow, screen, Menu, clipboard, dialog, shell, ipcMain, safeStorage} = require('electron');
const {spawn} = require('node:child_process');
const {randomBytes, randomUUID} = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {createCommunityServer, sharedLapSummary} = require('./server.cjs');
const {communityDefaults} = require('./package.json');

let window, server, pending = false;
let settings, proxy;
const caddyPath = () => path.join(process.resourcesPath,'caddy','caddy.exe');
const hasCaddy = () => app.isPackaged && process.platform === 'win32' && fs.existsSync(caddyPath());

function startCaddy(hostname,port) {
  const directory = path.join(app.getPath('userData'),'Caddy');
  fs.mkdirSync(directory,{recursive:true});
  const file = path.join(directory,'Caddyfile');
  const storage = JSON.stringify(path.join(directory,'certificates').replaceAll('\\','/'));
  fs.writeFileSync(file,[
    '{','  admin off','  storage file_system {','    root ' + storage,'  }','}',
    hostname + ' {','  reverse_proxy 127.0.0.1:' + port,'}',''
  ].join('\n'));
  const child = spawn(caddyPath(),['run','--config',file,'--adapter','caddyfile'],{
    cwd:directory,windowsHide:true,stdio:['ignore','ignore','pipe']
  });
  proxy = child;
  return new Promise((resolve,reject) => {
    let output = '';
    let started = false;
    const timer = setTimeout(() => reject(new Error('Caddy did not report a successful start. ' + output)),10_000);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data',chunk => {
      output = (output + chunk).slice(-3000);
      if (!started && output.includes('serving initial configuration')) {
        started = true;
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('error',error => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit',() => {
      clearTimeout(timer);
      if (!started) reject(new Error('Caddy could not start. ' + output));
      else if (proxy === child) {
        proxy = undefined;
        server?.close();
        server = undefined;
        if (window && !window.isDestroyed()) window.webContents.send('community-host-proxy-exit',output);
      }
    });
  });
}

function stopCaddy() {
  const child = proxy;
  proxy = undefined;
  if (child && child.exitCode === null) child.kill();
}

function updatesDirectory() {
  return app.isPackaged && app.getName() === 'Total Telemetry Community Server TPR Edition'
    ? path.join(path.dirname(process.execPath),'TPR Updates') : undefined;
}

function addresses() {
  return [...new Set(Object.values(os.networkInterfaces()).flat()
    .filter(link => link.family === 'IPv4' && !link.internal).map(link => link.address))];
}

function snapshot() {
  return {...settings, version:app.getVersion(), caddyAvailable:hasCaddy(), updatesDirectory:updatesDirectory(), running:Boolean(server?.listening), addresses:addresses(), advertisedAddress:communityDefaults.host};
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
  const defaults = {port:communityDefaults.port, scope:'network', httpsEnabled:false,
    httpsHostname:'', minimumGameVersion:'', directory:path.join(app.getPath('userData'), 'laps'),
    key:communityDefaults.key, ownerPassword:randomBytes(24).toString('hex')};
  try {
    const {protectedKey, protectedOwnerPassword, port, scope, directory, minimumGameVersion, httpsEnabled, httpsHostname} = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'server-settings.json'), 'utf8'));
    const decrypt = (encrypted, fallback) => {
      try { return safeStorage.decryptString(Buffer.from(encrypted, 'base64')); } catch { return fallback; }
    };
    return {port, scope, directory, httpsEnabled:httpsEnabled ?? defaults.httpsEnabled,
      httpsHostname:httpsHostname ?? defaults.httpsHostname, minimumGameVersion:minimumGameVersion ?? '', key:decrypt(protectedKey, defaults.key),
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
    window = new BrowserWindow({width:740, height:640, minWidth:640, useContentSize:true, show:false, backgroundColor:'#101513',
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
    handle('community-host-record-summary', () => sharedLapSummary(settings.directory));
    handle('community-host-choose-directory', async initial => {
      const result = await dialog.showOpenDialog(window, {
        defaultPath:typeof initial === 'string' ? initial : settings.directory,
        properties:['openDirectory', 'createDirectory']
      });
      return result.canceled ? null : result.filePaths[0];
    });
    handle('community-host-open-updates', async () => {
      const folder = updatesDirectory();
      if (!folder) throw new Error('TPR Updates are available in the packaged TPR server.');
      await fs.promises.mkdir(folder,{recursive:true});
      const error = await shell.openPath(folder);
      if (error) throw new Error(error);
    });
    handle('community-host-copy', text => {
      if (typeof text === 'string' && text.length <= 256) clipboard.writeText(text);
    });
    handle('community-host-bundled-key', () => communityDefaults.key);
    handle('community-host-generate-key', () => randomBytes(24).toString('hex'));
    handle('community-host-start', async ({port, scope, directory, key, ownerPassword, minimumGameVersion, httpsEnabled, httpsHostname}) => {
      if (pending || server) throw new Error('The server is already running or changing state.');
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Enter a port from 1 to 65535.');
      if (!['network','local'].includes(scope) || typeof directory !== 'string' || !path.isAbsolute(directory)) {
        throw new Error('Choose a binding and an absolute lap storage folder.');
      }
      if (!ownerPassword) throw new Error('Choose an owner password.');
      const useHttps = httpsEnabled === true;
      const hostname = String(httpsHostname ?? '').trim();
      if (useHttps && (!hasCaddy() || port === 80 || port === 443)) {
        throw new Error('HTTPS requires bundled Caddy and a backend port other than 80 or 443.');
      }
      if (useHttps && (hostname.length > 253 ||
          !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(hostname))) {
        throw new Error('Enter a public HTTPS hostname without a protocol or port.');
      }
      const next = {port, scope, directory, key, ownerPassword, httpsEnabled:useHttps, httpsHostname:hostname,
        minimumGameVersion:String(minimumGameVersion ?? '').trim()};
      pending = true;
      let listener;
      try {
        listener = createCommunityServer({...next, updatesDirectory:updatesDirectory(), onError:message => console.error(message)});
        await listen(listener, port, useHttps || scope === 'local' ? '127.0.0.1' : '0.0.0.0');
        if (useHttps) await startCaddy(hostname,port);
        saveSettings(next);
        settings = next;
        server = listener;
        return snapshot();
      } catch (error) {
        stopCaddy();
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
        stopCaddy();
        await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
        server = null;
        return snapshot();
      } finally {
        pending = false;
      }
    });
    window.webContents.once('did-finish-load', async () => {
      try {
        const height = await window.webContents.executeJavaScript(
          "initialRender.then(() => Math.ceil(document.querySelector('main').getBoundingClientRect().height))"
        );
        if (window.isDestroyed()) return;
        const [width,contentHeight] = window.getContentSize();
        const frameHeight = window.getSize()[1] - contentHeight;
        const {workArea} = screen.getDisplayMatching(window.getBounds());
        window.setContentSize(width,Math.min(height + 36,workArea.height - frameHeight));
        window.center();
      } catch (error) {
        if (!window.isDestroyed()) console.error('Could not fit the server window:', error.message);
      } finally {
        if (!window.isDestroyed()) window.show();
      }
    });
    void window.loadFile(path.join(__dirname, 'index.html'));
  });
}

app.on('before-quit',stopCaddy);
app.on('window-all-closed', () => app.quit());

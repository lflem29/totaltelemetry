const {app, BrowserWindow, dialog, ipcMain, Menu, screen, safeStorage} = require('electron');
const {execFile, spawn} = require('node:child_process');
const {once} = require('node:events');
const {randomUUID, randomBytes, createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {defaultDiscordWebhook, communityDefaults} = require('./package.json');
const windowIcon = path.join(__dirname, 'total-telemetry-icon.png');
const defaultInstallation = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Le Mans Ultimate';

function lapZipFilename(session, lap) {
  const driver = session.driver?.trim().split(/\s+/)[0] || 'Unknown driver';
  const recorded = session.recorded ?? '';
  const filenameTimestamp = (session.filename ?? '').match(/\d{4}-\d{2}-\d{2}T\d{2}_\d{2}_\d{2}Z(?=\.duckdb$)/i)?.[0];
  const date = new Date((recorded.match(/\d{4}-\d{2}-\d{2}T\d{2}_\d{2}_\d{2}Z(?=\.duckdb$)/i)?.[0] ?? (recorded || filenameTimestamp || '')).replace(/T(\d\d)_(\d\d)_(\d\d)Z$/, 'T$1:$2:$3Z'));
  const fallbackDate = (recorded + ' ' + (session.filename ?? '')).match(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/);
  const sessionDate = Number.isFinite(+date)
    ? new Intl.DateTimeFormat('en-AU', {year:'numeric', month:'2-digit', day:'2-digit'}).format(date).replaceAll('/', '-')
    : fallbackDate ? [fallbackDate[3], fallbackDate[2], fallbackDate[1]].join('-') : 'Unknown date';
  const milliseconds = Math.round(lap.time * 1000);
  const minutes = Math.floor(milliseconds / 60000);
  const seconds = ((milliseconds % 60000) / 1000).toFixed(3).padStart(6, '0');
  const lapTime = minutes + '-' + seconds;
  const name = [driver, session.track || 'Unknown track', sessionDate, session.model || session.car || 'Unknown car', lapTime]
    .map(part => part.replace(/[.,<>:"/\\|?*\x00-\x1f]/g, '-').trim().slice(0, 72).trimEnd())
    .join(' - ');
  return name + '.zip';
}

function discordWebhook(value) {
  const url = typeof value === 'string' && URL.canParse(value) ? new URL(value) : null;
  if (url?.origin !== 'https://discord.com' || url.username || url.password || url.hash ||
      !/^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(url.pathname) ||
      [...url.searchParams].some(([key, id]) => key !== 'thread_id' || !/^\d+$/.test(id))) {
    throw new Error('Enter a valid Discord webhook URL.');
  }
  url.searchParams.set('wait', 'true');
  return url;
}

async function exportLapZip(session, lap, destination) {
  await backend('export-lap', {
    path:session.path, destination, start:lap.start, end:lap.end,
    track:session.track, car:session.model || session.car, carClass:session.carClass,
    trackName:session.trackName, trackLayout:session.trackLayout, gameVersion:session.gameVersion,
    driver:session.driver, lap:lap.number, time:lap.time, validity:lap.validity
  });
}

function discordLapMessage(session, lap) {
  const lapTime = seconds => {
    const ms = Math.round(seconds * 1000);
    return Math.floor(ms / 60000) + ':' + ((ms % 60000) / 1000).toFixed(3).padStart(6, '0');
  };
  const recorded = session.recorded?.replace(/(?:\.duckdb)?$/i, '').replace(/T(\d\d)_(\d\d)_(\d\d)Z$/i, 'T$1:$2:$3Z');
  const date = new Date(recorded);
  const splits = [0, 1, 2].map(index => {
    const seconds = lap.sectors?.[index];
    return Number.isFinite(seconds) && seconds > 0 ? 'S' + (index + 1) + ' ' + seconds.toFixed(3) + ' s' : '';
  }).filter(Boolean).join(' · ');
  const fields = [
    ['Best Lap', lapTime(lap.time)], ['Driver', session.driver],
    ['Track', session.trackName || session.track],
    ['Layout', session.trackLayout !== (session.trackName || session.track) ? session.trackLayout : null],
    ['Car', session.model || session.car],
    ['Entry', session.model && session.car !== session.model ? session.car : null],
    ['Class', session.carClass], ['Session', session.session], ['Lap', lap.number],
    ['Sectors', splits], ['Top Speed', Number.isFinite(lap.topSpeed) ? lap.topSpeed.toFixed(1) + ' km/h' : null],
    ['Validity', lap.validity], ['Timed Laps', session.timed],
    ['Session Duration', Number.isFinite(session.durationSeconds) ? lapTime(session.durationSeconds) : null],
    ['Distance Driven', Number.isFinite(session.distanceKm) ? session.distanceKm.toFixed(1) + ' km' : null],
    ['Recorded', Number.isFinite(+date) ? date.toLocaleString('en-AU') : recorded],
    ['LMU Version', session.gameVersion]
  ];
  return fields.filter(([, value]) => value !== null && value !== undefined && String(value).trim())
    .map(([label, value]) => '**' + label + '** · ' + String(value).replace(/\s+/g, ' ').trim()
      .slice(0, 80).replace(/[\\*_~`|<>]/g, '\\$&'))
    .join('\n').slice(0, 2000);
}

async function uploadDiscordLap(url, source, filename, content) {
  const form = new FormData();
  form.set('payload_json', JSON.stringify({content, allowed_mentions:{parse:[]}}));
  form.set('files[0]', await fs.openAsBlob(source, {type:'application/zip'}), filename);
  let response;
  try {
    response = await fetch(url, {method:'POST', body:form, redirect:'error', signal:AbortSignal.timeout(60_000)});
  } catch {
    throw new Error('Could not confirm delivery to Discord. Check the channel before trying again.');
  }
  await response.body?.cancel().catch(() => {});
  if (response.ok) return;
  if (response.status === 409 && route.startsWith('/request/')) throw new Error('That record changed. Refresh Track Records and try again.');
    if (response.status === 413) throw new Error('This lap ZIP exceeds the Discord channel’s upload limit.');
  if (response.status === 429) throw new Error('Discord is rate limiting uploads. Try again in a moment.');
  if ([401, 403, 404].includes(response.status)) throw new Error('Discord could not access that webhook or channel. Check the webhook URL.');
  throw new Error('Discord did not accept the upload (HTTP ' + response.status + ').');
}

const communityMaxBytes = 32 * 1024 * 1024;
const communityId = /^[a-f0-9]{64}$/;

function communityOrigin({host, port, https}) {
  const address = typeof host === 'string' ? host.trim() : '';
  if (!/^(?:[a-z0-9._-]+|\[[a-f0-9:]+\])$/i.test(address) ||
      !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Enter a valid server address and port.');
  return new URL((https ? 'https://' : 'http://') + address + ':' + port).origin;
}
const {key:bundledCommunityKey, ...originalCommunityServer} = communityDefaults;
const bundledCommunityServer = app.getName() === 'Total Telemetry TPR Edition'
  ? {host:originalCommunityServer.host,port:443,https:true} : originalCommunityServer;

function usesBundledCommunityKey(server) {
  return [bundledCommunityServer,originalCommunityServer].some(endpoint =>
    server.host.toLowerCase() === endpoint.host.toLowerCase() && server.port === endpoint.port);
}
function communityToken(server, encrypted) {
  if (encrypted) return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  if (usesBundledCommunityKey(server)) return bundledCommunityKey;
  throw new Error('Enter the community server’s shared key in Settings.');
}
function configuredCommunity() {
  const server = config.communityServer ?? bundledCommunityServer;
  return {origin:communityOrigin(server), token:communityToken(server, config.communityKeyEncrypted)};
}
function emitCommunityActivity(event) {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send('community-activity',event);
}

async function communityFetch(server, route, options = {}, endpoint = '/v1/laps') {
  const id = randomUUID();
  const action = endpoint === '/v1/track-records' ? 'Syncing Track Records' :
    endpoint.endsWith('/requests') && !route ? 'Checking Requests' :
    route.startsWith('/request/') ? 'Sending Request' :
    /^\/(accept|deny)\//.test(route) ? 'Sending Response' :
    route.startsWith('/upload/') || options.method === 'POST' ? 'Uploading Lap' :
    /^\/(download\/)?[a-f0-9-]{36,64}$/.test(route) ? 'Downloading Lap' : 'Checking Community Laps';
  const transferStep = endpoint.endsWith('/requests') && /^\/(upload|download)\//.test(route);
  emitCommunityActivity({id,action,state:'busy',transferStep});
  try {
    const response = await fetch(server.origin + endpoint + route, {
      ...options, headers:{...options.headers, Authorization:'Bearer ' + server.token},
      signal:AbortSignal.timeout(endpoint === '/v1/track-records' ? 10_000 : 120_000), redirect:'error'
    }).catch(() => { throw new Error('Could not reach the community server. Check its address, port and HTTPS setting.'); });
    emitCommunityActivity({id,action,state:'connected',status:response.status,transferStep});
    if (response.ok) return response;
    await response.body?.cancel();
    if (response.status === 403 && options.method === 'DELETE') throw new Error('The server did not accept the owner password. Check Settings.');
    if (response.status === 401) throw new Error('The community server rejected the access key.');
    if (response.status === 404) {
      const error = new Error('This community lap or server route is no longer available.');
      error.code = 'COMMUNITY_NOT_FOUND';
      throw error;
    }
    if (response.status === 413) throw new Error('This lap ZIP exceeds the community server’s 32 MiB limit.');
    throw new Error('The community server could not complete the request (HTTP ' + response.status + ').');
  } catch (error) {
    emitCommunityActivity({id,action,state:'error',message:error.message,transferStep});
    throw error;
  }
}
function communityProgress(sender, operation, stage, received, total) {
  if (!sender.isDestroyed()) sender.send('community-progress', {operation, stage, received, total});
}
async function readCommunityBody(response, limit, onProgress) {
  const total = Number(response.headers.get('content-length')) || null;
  if (total > limit) {
    await response.body?.cancel();
    throw new Error('The community server returned more data than expected.');
  }
  onProgress?.(0, total);
  let length = 0;
  const chunks = [];
  for await (const part of response.body) {
    length += part.length;
    if (length > limit) throw new Error('The community server returned more data than expected.');
    chunks.push(part);
    onProgress?.(length, total);
  }
  return Buffer.concat(chunks, length);
}
function shareTrackRecords() {
  return config.shareTrackRecords ?? (app.getName() === 'Total Telemetry TPR Edition');
}


function meetsMinimumGameVersion(raw, minimum) {
  if (!minimum) return true;
  const packed = /^(\d+)\.(\d)(\d{3})$/.exec(raw);
  const version = packed ? [packed[1],packed[2],...packed[3].replace(/0+$/, '')].join('.') : raw;
  if (!/^\d+(\.\d+)*$/.test(version)) return false;
  const actual = version.split('.').map(Number);
  const required = minimum.split('.').map(Number);
  for (let index = 0; index < Math.max(actual.length,required.length); index++) {
    const difference = (actual[index] ?? 0) - (required[index] ?? 0);
    if (difference) return difference > 0;
  }
  return true;
}

function driverIdentity(name) {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function suggestedDriver() {
  const drivers = new Map();
  for (const session of sessionIndex) {
    const name = session.driver?.trim();
    if (!name || /^(unknown(?: driver)?|n\/a)$/i.test(name)) continue;
    const id = driverIdentity(name);
    const total = drivers.get(id) ?? {name,laps:0};
    total.laps += session.laps.filter(lap => lap.kind === 'complete' && lap.time > 0).length;
    drivers.set(id,total);
  }
  return [...drivers.values()].filter(item => item.laps > 0).sort((a,b) => b.laps - a.laps || a.name.localeCompare(b.name))[0];
}

function trustedUpdateTransport(server) {
  const {protocol,hostname} = new URL(server.origin);
  return protocol === 'https:' || ['localhost','127.0.0.1','[::1]'].includes(hostname);
}

function trackRecordIdentity() {
  if (!config.primaryDriver) return null;
  if (!config.trackRecordSecretEncrypted) {
    if (!safeStorage.isEncryptionAvailable() ||
        (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
      throw new Error('Secure storage is required for private Track Records requests.');
    }
    const next = {...config,trackRecordClientId:randomUUID(),
      trackRecordSecretEncrypted:safeStorage.encryptString(randomBytes(32).toString('hex')).toString('base64')};
    save(next);
    config = next;
  }
  return {client:config.trackRecordClientId,
    secret:safeStorage.decryptString(Buffer.from(config.trackRecordSecretEncrypted,'base64'))};
}

function recordLapKey(session,lap) {
  return createHash('sha256').update(JSON.stringify([
    session.filename, session.recorded, session.driver, session.trackName || session.track,
    session.trackLayout || session.track, session.trackLayoutVersion, session.carClass,
    session.model || session.car, session.gameVersion, lap.id, lap.start, lap.end, lap.time
  ])).digest('hex');
}

function lapMatchesRequest(session,lap,key) {
  return lap.kind === 'complete' && recordLapKey(session,lap) === key;
}

function recordedTrackRecordDate(session) {
  for (const value of [session.recorded,session.filename]) {
    const text = String(value ?? '').trim();
    const timestamp = text.match(/\d{4}-\d{2}-\d{2}T\d{2}_\d{2}_\d{2}Z(?=\.duckdb$|$)/i)?.[0];
    const date = Date.parse(timestamp ? timestamp.replace(/T(\d\d)_(\d\d)_(\d\d)Z$/i,'T$1:$2:$3Z') : text);
    if (Number.isFinite(date)) return new Date(date).toISOString();
  }
  return '';
}

function localTrackRecords(minimumGameVersion, eligibility) {
  const records = new Map();
  for (const session of sessionIndex) {
    if (driverIdentity(session.driver) !== driverIdentity(config.primaryDriver)) continue;
    const fields = {
      driver:config.primaryDriver, track:session.trackName || session.track, layout:session.trackLayout || session.track,
      layoutVersion:session.trackLayoutVersion, car:session.model || session.car, carClass:session.carClass,
      gameVersion:session.gameVersion, recorded:recordedTrackRecordDate(session)
    };
    for (const [key,value] of Object.entries(fields)) fields[key] = String(value ?? '').trim().slice(0,160);
    if (!fields.driver || !fields.track || !fields.layout || !fields.car || !fields.recorded) continue;
    const laps = session.laps.filter(lap => lap.kind === 'complete' && Number.isFinite(lap.time) &&
      lap.time > 0 && lap.time <= 86400 && lap.validity === 'official');
    const lap = laps.reduce((best,entry) => !best || entry.time < best.time ? entry : best,null);
    if (!lap) continue;
    if (!meetsMinimumGameVersion(fields.gameVersion, minimumGameVersion)) {
      if (eligibility) eligibility.excludedSessions++;
      continue;
    }
    const key = JSON.stringify([fields.driver,fields.track,fields.layout,fields.carClass || 'Unknown'].map(value => value.toLowerCase()));
    if (records.has(key) && records.get(key).time <= lap.time) continue;
    const bestSectors = [0,1,2].map(index => {
      const best = laps.reduce((min,entry) => {
        const time = entry.sectors?.[index];
        return Number.isFinite(time) && time > 0 ? Math.min(min,time) : min;
      },Infinity);
      return Number.isFinite(best) ? best : null;
    });
    records.set(key,{...fields,lapKey:recordLapKey(session,lap),time:lap.time,sectors:lap.sectors?.slice(0,3),bestSectors,validity:lap.validity});
  }
  return records;
}

let trackRecordSyncState;
let trackRecordSyncRequest;

function syncTrackRecords() {
  if (trackRecordSyncRequest) return trackRecordSyncRequest;
  trackRecordSyncRequest = refreshTrackRecords().finally(() => { trackRecordSyncRequest = undefined; });
  return trackRecordSyncRequest;
}

async function refreshTrackRecords() {
  if (!publicSettings().communityConfigured) {
    trackRecordSyncState = undefined;
    return {records:[],minimumGameVersion:null};
  }
  const server = configuredCommunity();
  if (trackRecordSyncState?.origin !== server.origin || trackRecordSyncState.token !== server.token) {
    trackRecordSyncState = {...server, sent:new Map(), received:new Map(), epoch:null,cursor:0};
  }
  const state = trackRecordSyncState;
  const capabilities = await communityFetch(server,'',{method:'GET'},'/v1/track-records').then(async response =>
    JSON.parse((await readCommunityBody(response,8192)).toString('utf8')));
  const privateRequestsAvailable = capabilities.privateRecordProtocol === 1;
  state.privateRequestsAvailable = privateRequestsAvailable;
  const identity = privateRequestsAvailable ? trackRecordIdentity() : null;
  let eligibility;
  const unsent = () => {
    if (!identity || config.trackRecordClientId !== identity.client || !shareTrackRecords()) return [];
    eligibility = {excludedSessions:0,eligibleRecords:0};
    const records = localTrackRecords(state.minimumGameVersion,eligibility);
    eligibility.eligibleRecords = records.size;
    return [...records].filter(([key,record]) => (state.sent.get(key) ?? Infinity) > record.time);
  };
  let pending = [];
  let more = false;
  do {
    const active = !identity || (config.primaryDriver && config.trackRecordClientId === identity.client);
    if (!active) return {records:[],minimumGameVersion:null};
    const batch = shareTrackRecords() ? pending.splice(0,200) : [];
    if (!shareTrackRecords()) pending.length = 0;
    const response = await communityFetch(server,'',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({client:identity?.client ?? null,secret:identity?.secret,driver:identity && config.primaryDriver,epoch:state.epoch,cursor:state.cursor,
        records:batch.map(([,record]) => record)})
    },'/v1/track-records');
    const data = JSON.parse((await readCommunityBody(response,1024*1024)).toString('utf8'));
    if (typeof data.epoch !== 'string' || !Number.isSafeInteger(data.cursor) || data.cursor < 0 ||
        !Array.isArray(data.records) || (data.more && data.epoch === state.epoch && data.cursor <= state.cursor)) {
      throw new Error('Invalid Track Records response.');
    }
    const minimumGameVersion = typeof data.minimumGameVersion === 'string' ? data.minimumGameVersion : '';
    const policyChanged = state.minimumGameVersion !== minimumGameVersion;
    const epochChanged = state.epoch !== data.epoch;
    if (epochChanged) {
      state.sent.clear();
      state.received.clear();
    }
    state.minimumGameVersion = minimumGameVersion;
    if (typeof data.minimumGameVersion === 'string' &&
        communityOrigin(config.communityServer ?? bundledCommunityServer) === server.origin &&
        config.communityMinimumGameVersion !== minimumGameVersion) {
      config.communityMinimumGameVersion = minimumGameVersion;
      save();
    }
    if (!policyChanged && !epochChanged) {
      for (const [key,record] of batch) state.sent.set(key,record.time);
    }
    if (policyChanged || epochChanged || !batch.length) pending = unsent();
    for (const record of data.records) {
      if (record?.removed === true) { state.received.delete(record.id); continue; }
      if (/^[a-f0-9]{64}$/.test(record?.id) &&
          ['driver','track','layout','car','carClass','layoutVersion','gameVersion','recorded'].every(key => typeof record[key] === 'string') &&
          Number.isFinite(record.time) && record.time > 0) state.received.set(record.id,record);
    }
    state.epoch = data.epoch;
    state.cursor = data.cursor;
    more = data.more === true;
  } while (pending.length || more);
  return {records:[...state.received.values()],minimumGameVersion:state.minimumGameVersion,privateRequestsAvailable,eligibility};
}

async function uploadCommunityLap(server, source, session, lap, sender) {
  const archive = await fs.openAsBlob(source, {type:'application/zip'});
  if (archive.size > communityMaxBytes) throw new Error('The lap ZIP exceeds 32 MiB.');
  const details = {
    track:session.trackName || session.track, layout:session.trackLayout || session.track,
    driver:session.driver, car:session.model || session.car, gameVersion:session.gameVersion, time:lap.time
  };
  for (const key of ['track','layout','driver','car','gameVersion']) details[key] = String(details[key] ?? '').slice(0, 160);
  let sent = 0;
  async function* transfer() {
    for await (const chunk of fs.createReadStream(source)) {
      if (!sent) communityProgress(sender, 'upload', 'Uploading best lap…', 0, archive.size);
      yield chunk;
      sent += chunk.length;
      const stage = sent === archive.size ? 'Waiting for the server to save the lap…' : 'Uploading best lap…';
      communityProgress(sender, 'upload', stage, sent, archive.size);
    }
  }
  communityProgress(sender, 'upload', 'Connecting to the community server…');
  const response = await communityFetch(server, '', {
    method:'POST', duplex:'half', body:transfer(), headers:{
      'Content-Type':'application/zip', 'Content-Length':String(archive.size),
      'x-tt-lap':Buffer.from(JSON.stringify(details)).toString('base64url')
    }
  });
  await response.body?.cancel();
}

let config = {};
let sessionIndex = [];
let activeScan;
let generation = 0;
let configPath;
let watchers = [];
let watchTimer;

function watchFolders(win) {
  for (const watcher of watchers) watcher.close();
  watchers = [];
  clearTimeout(watchTimer);
  for (const folder of new Set([config.telemetry, config.results].filter(Boolean))) {
    try {
      const watcher = fs.watch(folder, () => {
        clearTimeout(watchTimer);
        watchTimer = setTimeout(() => {
          if (!win.isDestroyed()) win.webContents.send('folder-change');
        }, 250);
      });
      watcher.on('error', () => watcher.close());
      watchers.push(watcher);
    } catch {
      // Periodic scans also cover network shares and folders that do not exist yet.
    }
  }
}

function save(values = config) {
  const temporary = configPath + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(values, null, 2));
  fs.renameSync(temporary, configPath);
}
const settingsFileFormat = 'total-telemetry-settings';
const isSettingsObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const settingsMap = validate => value => isSettingsObject(value) && Object.entries(value).every(([key, entry]) =>
  !['__proto__', 'constructor', 'prototype'].includes(key) && validate(entry));
const settingsText = value => typeof value === 'string';
const settingsList = value => Array.isArray(value) && value.every(settingsText);
const settingsNumber = Number.isFinite;
const settingsColour = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const temperatureMap = settingsMap(value => value === null || settingsNumber(value));
const measurementUnitKeys = ['speed','distance','temperature','pressure','fuel'];
const displayFields = {
  autoLoadTelemetry:value => typeof value === 'boolean',
  elementColours:settingsMap(settingsColour),
  turboPressureReference:value => value === 'absolute' || value === 'gauge',
  measurementUnits:value => isSettingsObject(value) && Object.keys(value).length === measurementUnitKeys.length &&
    measurementUnitKeys.every(key => ['metric','imperial'].includes(value[key])),
  driverTrainerEnabled:value => typeof value === 'boolean', trainerColdTyreTemperature:settingsNumber,
  heights:settingsMap(settingsNumber), enabled:settingsList, tyres:settingsText,
  colors:settingsMap(settingsColour), speedActivations:settingsMap(value => typeof value === 'boolean'),
  deltaChannels:settingsList, graphOrder:settingsList, hiddenGraphs:settingsList, hiddenSummary:settingsList,
  interfaceColour:settingsColour, interfaceColourMode:value => ['green', 'orange', 'custom'].includes(value),
  interfaceBackgroundColour:settingsColour, graphBackgroundColour:settingsColour,
  textScalePercent:value => Number.isInteger(value) && value >= 75 && value <= 150,
  extraSummaryChannels:settingsList, summaryChannelOrder:settingsList, summaryChartHeights:settingsMap(settingsNumber),
  summaryHeight:settingsNumber, extraGraphChannels:settingsList, telemetryNames:settingsMap(settingsText),
  telemetryDecimals:settingsMap(value => Number.isInteger(value) && value >= 0 && value <= 6)
};
const settingsFileFields = new Map([
  ['display', {...displayFields, presets:settingsMap(preset => isSettingsObject(preset) &&
    settingsList(preset.enabled) && Object.entries(preset).every(([key, value]) =>
      Object.hasOwn(displayFields, key) && displayFields[key](value))),
    colourPresets:settingsMap(preset => isSettingsObject(preset) &&
      Object.entries(preset).every(([key,value]) =>
        ['interfaceColourMode','interfaceColour','interfaceBackgroundColour','graphBackgroundColour','elementColours'].includes(key) &&
        displayFields[key](value))),
    graphPresets:settingsMap(preset => isSettingsObject(preset) &&
      settingsList(preset.hiddenGraphs) && settingsList(preset.extraGraphChannels) &&
      displayFields.heights(preset.heights) && (preset.graphOrder === undefined || settingsList(preset.graphOrder)))}],
  ['temperatures', {hotTemperatures:temperatureMap, hotTemperaturesByClass:settingsMap(temperatureMap)}]
]);

function publicSettings() {
  const {discordWebhookEncrypted, communityKeyEncrypted, communityOwnerEncrypted, trackRecordClientId, trackRecordSecretEncrypted, previousRecordDriver, ...preferences} = config;
  const communityServer = preferences.communityServer ?? bundledCommunityServer;
  const communityUsesBundledKey = Boolean(bundledCommunityKey) && !communityKeyEncrypted && usesBundledCommunityKey(communityServer);
  return {...preferences, communityServer, communityUsesBundledKey, shareTrackRecords:shareTrackRecords(),
    discordWebhookConfigured:Boolean(discordWebhookEncrypted ?? defaultDiscordWebhook),
    communityConfigured:Boolean(communityKeyEncrypted || communityUsesBundledKey),
    communityOwnerConfigured:Boolean(communityOwnerEncrypted), tprUpdatesSupported:tprUpdatesSupported()};
}

function savedDiscordWebhook() {
  if (config.discordWebhookEncrypted === undefined && defaultDiscordWebhook) return discordWebhook(defaultDiscordWebhook);
  if (!config.discordWebhookEncrypted) throw new Error('Add a Discord webhook in Settings first.');
  let value;
  try {
    value = safeStorage.decryptString(Buffer.from(config.discordWebhookEncrypted, 'base64'));
  } catch {
    throw new Error('The saved Discord webhook could not be opened. Save it again in Settings.');
  }
  return discordWebhook(value);
}
function windowPlacement(key, width, height, minWidth, minHeight) {
  const saved = config.windowPositions?.[key]?.bounds;
  const options = {width, height, minWidth, minHeight};
  if (!saved || !['x', 'y', 'width', 'height'].every(field => Number.isFinite(saved[field])) ||
      saved.width <= 0 || saved.height <= 0) return options;
  const {workArea} = screen.getDisplayMatching(saved);
  options.width = Math.max(minWidth, Math.min(saved.width, workArea.width));
  options.height = Math.max(minHeight, Math.min(saved.height, workArea.height));
  options.x = Math.max(workArea.x, Math.min(saved.x, workArea.x + workArea.width - options.width));
  options.y = Math.max(workArea.y, Math.min(saved.y, workArea.y + workArea.height - options.height));
  return options;
}
function rememberWindow(key, win) {
  config.windowPositions = {...config.windowPositions,
    [key]: {bounds:win.getNormalBounds(), maximized:win.isMaximized()}};
}

function backend(command, payload) {
  const runtime = path.join(__dirname, 'runtime', 'python.exe');
  const python = process.platform === 'win32' ? runtime : 'python3';
  return new Promise((resolve, reject) => {
    const child = execFile(python, [path.join(__dirname, 'telemetry.py'), command],
      {maxBuffer: 160 * 1024 * 1024, windowsHide: true}, (error, output, stderr) => {
        if (error) return reject(new Error(stderr.trim() || error.message));
        try { resolve(JSON.parse(output)); } catch (err) { reject(err); }
      });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify(payload));
  });
}

function comparisonStoragePath(filename) {
  return path.join(app.getPath('userData'), 'comparison-laps', filename);
}
async function storeComparisonLap(source, migrate = false, sourceKey = source) {
  const stats = await fs.promises.stat(source);
  const extension = path.extname(source).toLowerCase();
  if ((extension !== '.zip' && !(migrate && extension === '.csv')) || !stats.isFile() || stats.size > 200_000_000) {
    throw new Error('Choose a Total Telemetry ZIP under 200 MB.');
  }
  const storedFile = randomUUID() + extension;
  const destination = comparisonStoragePath(storedFile);
  await fs.promises.mkdir(path.dirname(destination), {recursive:true});
  try {
    await fs.promises.copyFile(source, destination, fs.constants.COPYFILE_EXCL);
    const lap = await backend('import-comparison-lap', {path:destination});
    const entries = config.comparisonLaps ?? [];
    const previous = entries.find(item => item.path === sourceKey);
    const entry = {...lap, path:sourceKey, storedFile};
    const comparisonLaps = migrate
      ? entries.map(item => item === previous ? entry : item)
      : [...entries.filter(item => item.path !== sourceKey), entry];
    const next = {...config, comparisonLaps};
    save(next);
    config = next;
    if (previous?.storedFile) {
      void fs.promises.rm(comparisonStoragePath(previous.storedFile), {force:true}).catch(() => {});
    }
  } catch (error) {
    await fs.promises.rm(destination, {force:true}).catch(() => {});
    throw error;
  }
}

const updateEndpoint = '/v1/tpr-updates';
const tprProduct = 'Total Telemetry TPR Edition';
const maxUpdateSize = 1024 * 1024 * 1024;

function tprUpdatesSupported() {
  return app.isPackaged && process.platform === 'win32' && app.getName() === tprProduct;
}

async function availableTprUpdate(server) {
  if (!trustedUpdateTransport(server)) throw new Error('Use HTTPS in Community Server settings to check for remote updates.');
  const response = await fetch(server.origin + updateEndpoint,{
    headers:{Authorization:'Bearer ' + server.token},redirect:'error',signal:AbortSignal.timeout(20_000)
  });
  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 404) return null;
    throw new Error('The Community Server could not check for updates (HTTP ' + response.status + ').');
  }
  const {update} = JSON.parse((await readCommunityBody(response,8192)).toString('utf8'));
  if (update === null) return null;
  if (!/^\d{1,9}\.\d{1,9}\.\d{1,9}$/.test(update?.version ?? '') ||
      update.filename !== 'Total-Telemetry-TPR-Edition-' + update.version + '-Setup.exe' ||
      !/^[a-f0-9]{64}$/.test(update.sha256 ?? '') ||
      !Number.isSafeInteger(update.size) || update.size <= 0 || update.size > maxUpdateSize) {
    throw new Error('The Community Server returned invalid update information.');
  }
  return meetsMinimumGameVersion(app.getVersion(),update.version) ? null : update;
}

async function installTprUpdate(server,update,progress) {
  const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(),'tt-tpr-update-'));
  const installer = path.join(directory,update.filename);
  try {
    const response = await fetch(server.origin + updateEndpoint + '/' + update.filename,{
      headers:{Authorization:'Bearer ' + server.token},redirect:'error',signal:AbortSignal.timeout(20 * 60_000)
    });
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) !== update.size) {
      await response.body?.cancel();
      throw new Error('The installer is unavailable or changed on the server. Check for updates again.');
    }
    const hash = createHash('sha256');
    const file = await fs.promises.open(installer,'wx');
    let downloaded = 0, lastPercent = -1;
    try {
      for await (const chunk of response.body) {
        downloaded += chunk.byteLength;
        if (downloaded > update.size) throw new Error('The download exceeded the expected installer size.');
        hash.update(chunk);
        await file.writeFile(chunk);
        const percent = Math.floor(downloaded * 100 / update.size);
        if (percent !== lastPercent) progress(lastPercent = percent);
      }
    } finally {
      await file.close();
    }
    if (downloaded !== update.size || hash.digest('hex') !== update.sha256) {
      throw new Error('The installer failed verification. Check for updates and try again.');
    }

    const log = path.join(app.getPath('userData'),'last-update.log');
    const ready = path.join(directory,'ready');
    await fs.promises.writeFile(log,new Date().toISOString() + ' Starting Windows update to ' + update.version + '\n');
    const child = spawn(installer,['/S'],{
      detached:true,windowsHide:true,stdio:'ignore',env:{...process.env,
        TT_UPDATE_PID:String(process.pid),TT_UPDATE_READY:ready,TT_UPDATE_LOG:log,
        TT_UPDATE_INSTALL_DIR:path.dirname(process.execPath)}
    });
    try {
      await once(child,'spawn');
    } catch (error) {
      await fs.promises.appendFile(log,'Could not launch the installer: ' + error.message + '\n');
      throw new Error('Could not launch the Windows installer. See ' + log + ' for details.');
    }
    const deadline = Date.now() + 45_000;
    while (true) {
      if (child.exitCode !== null || child.signalCode || Date.now() >= deadline) {
        const result = child.exitCode !== null ? 'Installer exited with code ' + child.exitCode :
          child.signalCode ? 'Installer exited with signal ' + child.signalCode : 'Timed out waiting for the installer';
        if (child.exitCode === null && !child.signalCode) child.kill();
        await fs.promises.appendFile(log,result + ' before signalling readiness.\n');
        throw new Error('The Windows installer did not start. See ' + log + ' for details.');
      }
      if (await fs.promises.readFile(ready,'utf8').catch(() => '') === 'ready') break;
      await new Promise(resolve => setTimeout(resolve,100));
    }
    child.unref();
  } catch (error) {
    await fs.promises.rm(directory,{recursive:true,force:true}).catch(() => {});
    throw error;
  }
}

function cleanUpTprUpdate() {
  const ready = process.env.TT_UPDATE_READY;
  delete process.env.TT_UPDATE_READY;
  delete process.env.TT_UPDATE_PID;
  delete process.env.TT_UPDATE_LOG;
  delete process.env.TT_UPDATE_INSTALL_DIR;
  if (process.platform !== 'win32' || !ready || path.basename(ready) !== 'ready') return;
  const directory = path.dirname(ready);
  if (path.relative(os.tmpdir(),path.dirname(directory)) !== '' ||
      !/^tt-tpr-update-[a-z0-9]+$/i.test(path.basename(directory))) return;
  setTimeout(() => {
    fs.promises.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:500}).catch(() => {});
  },5000).unref();
}

const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();

if (primaryInstance) app.whenReady().then(async () => {
  cleanUpTprUpdate();
  fs.mkdirSync(app.getPath('userData'), {recursive: true});
  configPath = path.join(app.getPath('userData'), 'settings.json');
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); } catch {}
  const savedCommunity = config.communityServer;
  if (app.getName() === tprProduct && !config.tprHttpsDefaultsApplied) {
    const savedHost = savedCommunity?.host?.toLowerCase();
    const previousTprAddress = savedHost === originalCommunityServer.host.toLowerCase() ||
      savedHost === bundledCommunityServer.host.toLowerCase();
    if (savedCommunity && !savedCommunity.https && previousTprAddress && savedCommunity.port === originalCommunityServer.port) {
      config.communityServer = {...bundledCommunityServer};
    }
    config.tprHttpsDefaultsApplied = true;
    save();
  }
  const win = new BrowserWindow({
    ...windowPlacement('main', 1536, 980, 1024, 620),
    icon: windowIcon,
    title: 'Total Telemetry', backgroundColor: '#101513',
    webPreferences: {preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true}
  });
  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  Menu.setApplicationMenu(null);
  const popouts = new Map();
  const panelTitles = {track:'Track View', summary:'Session Summary'};
  win.webContents.setWindowOpenHandler(({url, frameName}) => {
    if (url !== 'about:blank' || !Object.hasOwn(panelTitles, frameName)) return {action:'deny'};
    return {action:'allow', overrideBrowserWindowOptions:{
      ...windowPlacement(frameName, 720, 640, 360, 260),
      icon: windowIcon,
      title: 'Total Telemetry · ' + panelTitles[frameName],
      backgroundColor:'#101513',
      webPreferences:{nodeIntegration:false, contextIsolation:true, sandbox:true}
    }};
  });
  win.webContents.on('did-create-window', (child, {frameName}) => {
    popouts.set(frameName, child);
    child.webContents.setWindowOpenHandler(() => ({action:'deny'}));
    child.webContents.on('will-navigate', event => event.preventDefault());
    if (config.windowPositions?.[frameName]?.maximized) child.maximize();
    child.on('close', () => {
      rememberWindow(frameName, child);
      save();
    });
    child.on('closed', () => popouts.delete(frameName));
  });
  if (config.windowPositions?.main?.maximized) win.maximize();
  win.on('close', () => {
    rememberWindow('main', win);
    for (const [key, child] of popouts) if (!child.isDestroyed()) rememberWindow(key, child);
    save();
    for (const child of popouts.values()) if (!child.isDestroyed()) child.close();
  });
  win.webContents.on('will-navigate', event => event.preventDefault());

  ipcMain.handle('dock-panel', (event, key) => {
    if (event.sender !== win.webContents) return;
    const child = popouts.get(key);
    if (child && !child.isDestroyed()) child.close();
  });
  ipcMain.handle('settings', () => ({...publicSettings(), appVersion: app.getVersion()}));
  let installingUpdate = false;
  ipcMain.handle('tpr-update',async ({sender,senderFrame}, action, expectedVersion) => {
    if (sender !== win.webContents || senderFrame !== sender.mainFrame || !tprUpdatesSupported()) return null;
    if (!publicSettings().communityConfigured) return null;
    if (action === 'check') return availableTprUpdate(configuredCommunity());
    if (action !== 'install' || installingUpdate) throw new Error('An update is already in progress or unavailable.');
    installingUpdate = true;
    try {
      const server = configuredCommunity();
      const update = await availableTprUpdate(server);
      if (!update || update.version !== expectedVersion) throw new Error('The available update changed. Check for updates again.');
      await installTprUpdate(server,update,percent => {
        if (!sender.isDestroyed()) sender.send('tpr-update-progress',percent);
      });
      app.quit();
    } finally {
      installingUpdate = false;
    }
  });
  const trainerCachePath = path.join(app.getPath('userData'), 'driver-trainer-v1.json');
  ipcMain.handle('read-trainer-cache', async event => {
    if (event.sender !== win.webContents) return [];
    try {
      const entries = JSON.parse(await fs.promises.readFile(trainerCachePath,'utf8'));
      return Array.isArray(entries) ? entries : [];
    } catch { return []; }
  });
  ipcMain.handle('write-trainer-cache', async (event, entries) => {
    if (event.sender !== win.webContents || !Array.isArray(entries)) return;
    const temporary = trainerCachePath + '.tmp';
    await fs.promises.writeFile(temporary,JSON.stringify(entries),'utf8');
    await fs.promises.rename(temporary,trainerCachePath);
  });
  ipcMain.handle('save-settings', (_, changes) => {
    const allowed = ['shareTrackRecords', 'autoLoadTelemetry', 'driverTrainerEnabled', 'trainerColdTyreTemperature', 'measurementUnits', 'turboPressureReference', 'limit', 'heights', 'enabled', 'presets', 'graphPresets', 'graphOrder', 'tyres', 'colors', 'speedActivations', 'deltaChannels', 'hotTemperatures', 'hotTemperaturesByClass', 'hiddenGraphs', 'hiddenSummary', 'interfaceColour', 'elementColours', 'colourPresets', 'interfaceColourMode', 'interfaceBackgroundColour', 'graphBackgroundColour', 'textScalePercent', 'extraSummaryChannels', 'summaryChannelOrder', 'summaryChartHeights', 'summaryHeight', 'extraGraphChannels', 'telemetryNames', 'telemetryDecimals', 'telemetryReminderSeen'];
    for (const key of allowed) if (Object.hasOwn(changes, key)) config[key] = changes[key];
    save();
    return publicSettings();
  });
  ipcMain.handle('transfer-settings-file', async (_, action, category) => {
    const fields = settingsFileFields.get(category);
    if (!fields || !['import', 'export'].includes(action)) throw new Error('Invalid settings file request.');
    const title = category === 'display' ? 'Display Settings' : 'Temperature Settings';
    const filters = [{name:'JSON settings file', extensions:['json']}];
    if (action === 'export') {
      const result = await dialog.showSaveDialog(win, {
        title:'Export ' + title, filters,
        defaultPath:path.join(app.getPath('downloads'), 'Total-Telemetry-' + category + '.json')
      });
      if (result.canceled || !result.filePath) return null;
      const settings = Object.fromEntries(Object.keys(fields).map(key => [key, config[key] ?? null]));
      await fs.promises.writeFile(result.filePath, JSON.stringify({
        format:settingsFileFormat, version:1, category, settings
      }, null, 2) + '\n');
      return path.basename(result.filePath);
    }

    const result = await dialog.showOpenDialog(win, {title:'Import ' + title, filters, properties:['openFile']});
    if (result.canceled || !result.filePaths.length) return null;
    const filename = result.filePaths[0];
    if ((await fs.promises.stat(filename)).size > 1024 * 1024) throw new Error('The settings file exceeds 1 MB.');
    let data;
    try {
      data = JSON.parse(await fs.promises.readFile(filename, 'utf8'));
    } catch {
      throw new Error('Could not read a valid JSON settings file.');
    }
    if (data?.format !== settingsFileFormat || data.version !== 1 || data.category !== category ||
        !isSettingsObject(data.settings) || !Object.keys(data.settings).length) {
      throw new Error('Choose a Total Telemetry ' + title + ' file.');
    }
    const next = {...config};
    for (const [key, value] of Object.entries(data.settings)) {
      if (!Object.hasOwn(fields, key) || (value !== null && !fields[key](value))) {
        throw new Error('The settings file contains an invalid setting.');
      }
      if (value === null) delete next[key];
      else next[key] = value;
    }
    save(next);
    config = next;
    return {filename:path.basename(filename), settings:{...publicSettings(), appVersion:app.getVersion()}};
  });
  ipcMain.handle('set-discord-webhook', (_, value) => {
    const next = {...config};
    if (value === null) {
      next.discordWebhookEncrypted = '';
    } else {
      discordWebhook(value);
      if (!safeStorage.isEncryptionAvailable() ||
          (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
        throw new Error('Secure storage is unavailable on this computer.');
      }
      next.discordWebhookEncrypted = safeStorage.encryptString(value).toString('base64');
    }
    save(next);
    config = next;
    return Boolean(config.discordWebhookEncrypted);
  });
  ipcMain.handle('reset-settings', async () => {
    const result = await dialog.showMessageBox(win, {
      type: 'warning', title: 'Reset all settings', message: 'Reset all Total Telemetry settings?',
      detail: 'This clears saved preferences, presets and folder locations. Your community server address, shared key and Discord webhook setting are kept. You must confirm your driver again. Confirming the same driver restores your Track Records identity and open requests. Your telemetry recordings and results files stay on disk.',
      buttons: ['Cancel', 'Reset all settings'], defaultId: 0, cancelId: 0
    });
    if (result.response !== 1 || win.isDestroyed()) return;
    const {communityServer, communityKeyEncrypted, discordWebhookEncrypted, tprHttpsDefaultsApplied} = config;
    const {trackRecordClientId,trackRecordSecretEncrypted,primaryDriver,previousRecordDriver} = config;
    const retained = {communityServer, communityKeyEncrypted, discordWebhookEncrypted, tprHttpsDefaultsApplied,
      trackRecordClientId,trackRecordSecretEncrypted,previousRecordDriver:primaryDriver || previousRecordDriver};
    save(retained);
    config = retained;
    trackRecordSyncState = undefined;
    generation++;
    sessionIndex = [];
    watchFolders(win);
    win.webContents.reload();
  });
  ipcMain.handle('folder', async (_, type) => {
    const automatic = type === 'first-run-installation';
    if (!automatic && !['installation', 'telemetry', 'results'].includes(type)) return publicSettings();
    if (automatic && (process.platform !== 'win32' || config.telemetry || config.results)) return publicSettings();
    let folder;
    const userData = automatic && await fs.promises.stat(path.join(defaultInstallation, 'UserData')).catch(() => null);
    if (userData?.isDirectory()) {
      folder = defaultInstallation;
    } else {
      const title = automatic || type === 'installation' ? 'Select your Le Mans Ultimate installation' :
        type === 'telemetry' ? 'Select your telemetry folder' : 'Select your session results folder';
      const result = await dialog.showOpenDialog(win, {title, properties:['openDirectory']});
      if (result.canceled || !result.filePaths[0]) return publicSettings();
      folder = result.filePaths[0];
    }
    if (automatic || type === 'installation') {
      const root = path.basename(folder).toLowerCase() === 'userdata' ? folder : path.join(folder, 'UserData');
      config.telemetry = path.join(root, 'Telemetry');
      config.results = path.join(root, 'Log', 'Results');
    } else {
      config[type] = folder;
    }
    generation++;
    watchFolders(win);
    save();
    return publicSettings();
  });
  let distanceScan, distanceKey, distanceResult;
  ipcMain.handle('confirm-primary-driver', ({sender}, name) => {
    if (sender !== win.webContents) throw new Error('Confirm your driver from the main window.');
    if (config.primaryDriver) return publicSettings();
    if (typeof name !== 'string' || name !== suggestedDriver()?.name) {
      throw new Error('The suggested driver changed. Rescan your telemetry and confirm again.');
    }
    const sameDriver = driverIdentity(name) === driverIdentity(config.previousRecordDriver);
    const next = {...config,primaryDriver:sameDriver ? config.previousRecordDriver : name,primaryDriverProfile:randomUUID()};
    delete next.previousRecordDriver;
    if (!sameDriver) {
      delete next.trackRecordClientId;
      delete next.trackRecordSecretEncrypted;
    }
    save(next);
    config = next;
    trackRecordSyncState = undefined;
    return publicSettings();
  });
  ipcMain.handle('results-distance', async () => {
    const folder = config.results;
    if (!folder) return {drivers:[], errors:0};
    let files;
    try {
      const names = await fs.promises.readdir(folder);
      files = await Promise.all(names.filter(name => name.toLowerCase().endsWith('.xml')).sort().map(async name => {
        const stats = await fs.promises.stat(path.join(folder, name)).catch(() => null);
        return [name, stats?.size, stats?.mtimeMs];
      }));
    } catch (error) {
      if (error.code === 'ENOENT') return {drivers:[], errors:0};
      throw error;
    }
    const key = JSON.stringify([folder, files]);
    if (distanceKey === key && distanceResult) return distanceResult;
    if (distanceScan?.key === key) return distanceScan.promise;
    const scan = {key, promise:backend('results-distance', {results:folder})};
    distanceScan = scan;
    try {
      const result = await scan.promise;
      if (distanceScan === scan) {
        distanceKey = key;
        distanceResult = result;
      }
      return result;
    } finally {
      if (distanceScan === scan) distanceScan = undefined;
    }
  });
  ipcMain.handle('scan', async () => {
    if (activeScan) return activeScan;
    const token = generation;
    activeScan = backend('index', {telemetry: config.telemetry, results: config.results,
      cache: path.join(app.getPath('userData'), 'lap-index-v1.json')}).then(result => {
      if (token !== generation) return {stale: true};
      sessionIndex = result.sessions;
      return {...result,suggestedDriver:config.primaryDriver ? null : suggestedDriver()};
    }).finally(() => { activeScan = null; });
    return activeScan;
  });
  ipcMain.handle('read-summary-channels', (_, sessionPath, channels) => {
    const session = sessionIndex.find(item => item.path === sessionPath);
    if (!session) throw new Error('Session is no longer in the library.');
    const requested = new Set(Array.isArray(channels) ? channels : []);
    return backend('summary', {path: session.path, laps: session.laps,
      channels: session.summaryChannels.filter(name => requested.has(name))});
  });
  ipcMain.handle('practice-review', (_, sessionPath, lapIds, corners) => {
    const session = sessionIndex.find(item => item.path === sessionPath);
    if (!session) throw new Error('Session is no longer in the library.');
    if (!Array.isArray(lapIds) || !Array.isArray(corners) || corners.length > 200 ||
        corners.some(pair => !Array.isArray(pair) || pair.length !== 2 || !pair.every(Number.isFinite) ||
          pair[0] < 0 || pair[1] <= pair[0])) throw new Error('Invalid practice review selection.');
    const ids = new Set(lapIds);
    const laps = session.laps.filter(item => ids.has(item.id) && item.kind === 'complete' && item.time > 0 &&
      (item.validity === 'official' || item.validity === 'unconfirmed'));
    return backend('practice-corners', {path:session.path, laps, corners});
  });
  ipcMain.handle('set-community-server', (_, fields) => {
    const {host, port, https, key, ownerPassword} = fields;
    const communityServer = {host:typeof host === 'string' ? host.trim() : '', port:Number(port), https:https === true};
    const origin = communityOrigin(communityServer);
    const next = {...config, communityServer};
    const changedServer = communityOrigin(config.communityServer ?? bundledCommunityServer) !== origin;
    if (changedServer) {
      delete next.communityKeyEncrypted;
      delete next.communityOwnerEncrypted;
      delete next.communityMinimumGameVersion;
    }
    const encrypt = secret => {
      if (!safeStorage.isEncryptionAvailable() ||
          (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
        throw new Error('Secure storage is unavailable on this computer.');
      }
      return safeStorage.encryptString(secret).toString('base64');
    };
    if (key) {
      delete next.communityMinimumGameVersion;
      if (typeof key !== 'string' || !/^[!-~]{24,256}$/.test(key)) throw new Error('Enter a shared key of 24–256 characters without spaces.');
      next.communityKeyEncrypted = encrypt(key);
    }
    if (ownerPassword) {
      if (typeof ownerPassword !== 'string' || !/^[!-~]{12,256}$/.test(ownerPassword)) {
        throw new Error('Enter an owner password of 12–256 characters without spaces.');
      }
      next.communityOwnerEncrypted = encrypt(ownerPassword);
    }
    communityToken(communityServer, next.communityKeyEncrypted);
    save(next);
    config = next;
    return publicSettings();
  });
  ipcMain.handle('sync-track-records', ({sender}) => {
    if (sender !== win.webContents) throw new Error('Track Records are available from the main window.');
    return syncTrackRecords();
  });
  const recordRequestDownloads = new Set();
  const recordRequestUploads = new Set();
  const recordRequestEndpoint = '/v1/track-records/requests';
  const recordRequestCall = (server,route,method = 'GET',options = {}) => {
    const {identity} = server;
    if (!config.primaryDriver || identity.client !== config.trackRecordClientId) throw new Error('The confirmed driver was reset.');
    return communityFetch(server,route,{...options,method,headers:{...options.headers,
      'x-tt-record-client':identity.client,'x-tt-record-secret':identity.secret}},recordRequestEndpoint);
  };
  async function requestList(server) {
    const response = await recordRequestCall(server,'');
    return JSON.parse((await readCommunityBody(response,1024*1024)).toString('utf8'));
  }

  ipcMain.handle('manage-track-records', async ({sender},action,id) => {
    if (sender !== win.webContents || !config.communityOwnerEncrypted) throw new Error('Save the owner password in Sharing first.');
    if (action !== 'list' && (!['remove','revoke'].includes(action) || typeof id !== 'string' ||
        !/^(?:[a-f0-9]{64}|[a-f0-9-]{36})$/.test(id))) throw new Error('Invalid owner action.');
    const server = configuredCommunity();
    const password = safeStorage.decryptString(Buffer.from(config.communityOwnerEncrypted,'base64'));
    const headers = {'x-tt-owner-password':password};
    const endpoint = '/v1/track-records/owner';
    if (action !== 'list') {
      const response = await communityFetch(server,'/' + action + '/' + id,{method:'DELETE',headers},endpoint);
      await response.body?.cancel();
    }
    const response = await communityFetch(server,'',{headers},endpoint);
    return JSON.parse((await readCommunityBody(response,2*1024*1024)).toString('utf8'));
  });

  ipcMain.handle('track-record-request', async ({sender},action,id,lapKey) => {
    if (sender !== win.webContents) throw new Error('Open Track Records in the main window.');
    const connection = configuredCommunity();
    if (trackRecordSyncState?.origin !== connection.origin || trackRecordSyncState.token !== connection.token ||
        !trackRecordSyncState.privateRequestsAvailable) {
      if (action === 'list') return [];
      throw new Error('Private requests require an updated Community Server.');
    }
    const identity = trackRecordIdentity();
    if (!identity && action === 'list') return [];
    if (!identity) throw new Error('Confirm your primary driver before requesting telemetry.');
    const server = {...connection,identity};
    if (action === 'list') return requestList(server);
    if (action === 'request' && typeof id === 'string' && /^[a-f0-9]{64}$/.test(id) && typeof lapKey === 'string' && /^[a-f0-9]{64}$/.test(lapKey)) {
      const response = await recordRequestCall(server,'/request/' + id,'POST',{headers:{
        'x-tt-record-lap':lapKey
      }});
      await response.body?.cancel();
      return requestList(server);
    }
    if (!['accept','deny','download'].includes(action) || typeof id !== 'string' ||
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) throw new Error('Invalid telemetry request.');
    const entry = (await requestList(server)).find(item => item.id === id);
    if (!entry || entry.incoming === (action === 'download')) throw new Error('This telemetry request is unavailable.');
    if (action === 'deny') {
      const response = await recordRequestCall(server,'/deny/' + id,'POST');
      await response.body?.cancel();
      return requestList(server);
    }

    const active = action === 'download' ? recordRequestDownloads : recordRequestUploads;
    if (active.has(id)) throw new Error('This lap transfer is already in progress.');
    active.add(id);
    const activity = action === 'download' ? 'Downloading Requested Lap' : 'Uploading Requested Lap';
    const activityId = randomUUID();
    emitCommunityActivity({id:activityId,action:activity,state:'busy'});
    let temporary, transferError;
    try {
      const sourceKey = server.origin + recordRequestEndpoint + '/download/' + id;
      if (action === 'download' && config.comparisonLaps?.some(lap => lap.path === sourceKey)) return config.comparisonLaps;
      temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(),'tt-record-request-'));
      const source = path.join(temporary,'lap.zip');
      if (action === 'download') {
        if (entry.status !== 'uploaded') throw new Error('The requested lap is still being prepared.');
        const response = await recordRequestCall(server,'/download/' + id);
        const archive = await readCommunityBody(response,communityMaxBytes);
        if (createHash('sha256').update(archive).digest('hex') !== entry.sha256) throw new Error('The requested lap failed verification.');
        await fs.promises.writeFile(source,archive);
        if (!config.primaryDriver || identity.client !== config.trackRecordClientId) throw new Error('The confirmed driver was reset.');
        await storeComparisonLap(source,false,sourceKey);
        return config.comparisonLaps;
      }
      if (!['pending','accepted'].includes(entry.status)) throw new Error('This request has already been resolved.');
      const record = entry.record;
      const session = sessionIndex.find(item => recordedTrackRecordDate(item) === recordedTrackRecordDate(record) &&
        driverIdentity(item.driver) === driverIdentity(record.driver) &&
        item.laps.some(lap => lapMatchesRequest(item,lap,record.lapKey)));
      const lap = session?.laps.find(item => lapMatchesRequest(session,item,record.lapKey));
      if (!lap) throw new Error('Lap No Longer Available. Reconnect its recording folder or deny the request.');
      const accepted = await recordRequestCall(server,'/accept/' + id,'POST');
      await accepted.body?.cancel();
      try {
        await fs.promises.access(session.path);
      } catch {
        throw new Error('Lap No Longer Available. Reconnect its recording folder or deny the request.');
      }
      const operation = 'requested-lap:' + id;
      communityProgress(sender,operation,'preparing');
      await exportLapZip(session,lap,source);
      const archive = await fs.openAsBlob(source,{type:'application/zip'});
      if (archive.size > communityMaxBytes) throw new Error('The lap ZIP exceeds 32 MiB.');
      let received = 0, percent = 0;
      communityProgress(sender,operation,'uploading',0,archive.size);
      const body = archive.stream().pipeThrough(new TransformStream({
        transform(chunk,controller) {
          received += chunk.byteLength;
          const next = Math.floor(received * 100 / archive.size);
          if (next !== percent) {
            percent = next;
            communityProgress(sender,operation,'uploading',received,archive.size);
          }
          controller.enqueue(chunk);
        }
      }));
      const upload = await recordRequestCall(server,'/upload/' + id,'POST',{
        body,duplex:'half',headers:{'Content-Type':'application/zip','Content-Length':String(archive.size)}
      });
      await upload.body?.cancel();
      return requestList(server);
    } catch (error) {
      transferError = error;
      throw error;
    } finally {
      active.delete(id);
      if (action === 'accept') communityProgress(sender,'requested-lap:' + id,'done');
      emitCommunityActivity({id:activityId,action:activity,state:transferError ? 'error' : 'connected',message:transferError?.message});
      if (temporary) await fs.promises.rm(temporary,{recursive:true,force:true}).catch(() => {});
    }
  });
  ipcMain.handle('list-community-laps', async ({sender}, filters = {}) => {
    const page = Number.isSafeInteger(filters.page) ? Math.max(1, filters.page) : 1;
    const sort = filters.sort === 'fastest' ? 'fastest' : 'newest';
    const params = new URLSearchParams({page:String(page), sort, match:'exact'});
    const fields = ['track','layout','driver','gameVersion'];
    for (const key of fields) {
      if (typeof filters[key] === 'string' && filters[key].trim()) params.set(key, filters[key].trim().slice(0, 160));
    }
    communityProgress(sender, 'list', 'Connecting to the community server…');
    const server = configuredCommunity();
    let response;
    try {
      response = await communityFetch(server, '?' + params);
    } catch (error) {
      if (error.code !== 'COMMUNITY_NOT_FOUND') throw error;
      response = await communityFetch(server, '');
    }
    const readList = async result => JSON.parse((await readCommunityBody(result, 2 * 1024 * 1024,
      (received, total) => communityProgress(sender, 'list', 'Loading community laps…', received, total))).toString('utf8'));
    const data = await readList(response);
    const clean = items => items.filter(item => item && typeof item.id === 'string' && communityId.test(item.id) &&
      Number.isFinite(item.time) && item.time > 0).map(item => ({
        id:item.id, time:item.time,
        ...Object.fromEntries(['track','layout','driver','car','gameVersion'].map(key =>
          [key, typeof item[key] === 'string' ? item[key].slice(0, 160) : '']))
      }));
    if (data?.filterOptions && Array.isArray(data.laps) && [data.page, data.pageCount, data.total].every(Number.isSafeInteger)) {
      const filterOptions = Object.fromEntries(fields.map(key => {
        const options = Array.isArray(data.filterOptions[key]) ? data.filterOptions[key] : [];
        return [key, options.filter(value => typeof value === 'string' && value.length > 0 && value.length <= 160)];
      }));
      if (params.has('track') && data.layoutOptionsScoped !== true) {
        const trackParams = new URLSearchParams({track:params.get('track'), match:'exact'});
        const catalog = clean(await readList(await communityFetch(server, '?' + trackParams)));
        const layouts = new Set(catalog.map(lap => lap.layout).filter(Boolean));
        if (catalog.length >= 1000) {
          let trackPageCount = 1;
          for (let trackPage = 1; trackPage <= trackPageCount; trackPage++) {
            trackParams.set('page', String(trackPage));
            const result = await readList(await communityFetch(server, '?' + trackParams));
            if (!Array.isArray(result.laps) || !Number.isSafeInteger(result.pageCount) || result.pageCount < 1) {
              throw new Error('Invalid community track layout list.');
            }
            trackPageCount = result.pageCount;
            for (const lap of clean(result.laps)) if (lap.layout) layouts.add(lap.layout);
          }
        }
        filterOptions.layout = [...layouts].sort((a, b) => a.localeCompare(b, undefined, {numeric:true}));
      }
      return {...data, filterOptions, laps:clean(data.laps.slice(0, 25))};
    }

    // Older servers expose their latest 1,000 uploads through the original endpoint.
    const catalog = Array.isArray(data) ? data : await readList(await communityFetch(server, ''));
    if (!Array.isArray(catalog)) throw new Error('Invalid community lap list.');
    const all = clean(catalog.slice(0, 1000));
    const filterOptions = Object.fromEntries(fields.map(key => [key, [...new Set(all.filter(lap => key !== 'layout' || !params.has('track') ||
      lap.track.toLowerCase() === params.get('track').toLowerCase()).map(lap => lap[key]).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, {numeric:true}))]));
    const matching = all.filter(lap => fields.every(key => !params.has(key) ||
      lap[key].toLowerCase() === params.get(key).toLowerCase()));
    if (sort === 'fastest') matching.sort((a, b) => a.time - b.time);
    const pageCount = Math.max(1, Math.ceil(matching.length / 25));
    const current = Math.min(page, pageCount);
    return {laps:matching.slice((current - 1) * 25, current * 25), total:matching.length,
      page:current, pageCount, limited:catalog.length >= 1000, ownerActions:data?.ownerActions === true, filterOptions};
  });
  ipcMain.handle('remove-community-lap', async (_, id) => {
    if (typeof id !== 'string' || !communityId.test(id)) throw new Error('Invalid community lap.');
    const server = configuredCommunity();
    if (!config.communityOwnerEncrypted) throw new Error('Enter the owner password in Settings first.');
    const password = safeStorage.decryptString(Buffer.from(config.communityOwnerEncrypted, 'base64'));
    const response = await communityFetch(server, '/' + id, {method:'DELETE', headers:{'x-tt-owner-password':password}});
    await response.body?.cancel();
  });
  const communityImports = new Set();
  ipcMain.handle('import-community-lap', async ({sender}, id) => {
    if (typeof id !== 'string' || !communityId.test(id)) throw new Error('Invalid community lap.');
    const server = configuredCommunity();
    const sourceKey = server.origin + '/v1/laps/' + id;
    if (config.comparisonLaps?.some(lap => lap.path === sourceKey)) return config.comparisonLaps;
    if (communityImports.has(sourceKey)) throw new Error('This community lap is already downloading.');
    communityImports.add(sourceKey);
    let temporary;
    try {
      communityProgress(sender, 'download', 'Connecting to the community server…');
      const response = await communityFetch(server, '/' + id);
      const archive = await readCommunityBody(response, communityMaxBytes, (received, total) =>
        communityProgress(sender, 'download', 'Downloading lap…', received, total));
      communityProgress(sender, 'download', 'Checking and saving lap…');
      if (createHash('sha256').update(archive).digest('hex') !== id) throw new Error('The downloaded lap did not match the server listing.');
      temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tt-community-'));
      const source = path.join(temporary, 'lap.zip');
      await fs.promises.writeFile(source, archive);
      await storeComparisonLap(source, false, sourceKey);
      return config.comparisonLaps;
    } finally {
      communityImports.delete(sourceKey);
      if (temporary) await fs.promises.rm(temporary, {recursive:true, force:true}).catch(() => {});
    }
  });
  let bestLapExportInProgress = false;
  ipcMain.handle('export-best-lap', async ({sender}, sessionPath, target = 'local', recordLapId) => {
    if (bestLapExportInProgress) throw new Error('A best lap export is already in progress.');
    if (!['discord', 'local', 'community'].includes(target)) throw new Error('Choose an export destination.');
    const session = sessionIndex.find(item => item.path === sessionPath);
    const lap = recordLapId === undefined
      ? session?.laps.find(item => item.time > 0 && item.time === session.best)
      : session?.laps.find(item => item.id === recordLapId && item.kind === 'complete' && item.validity === 'official' && item.time > 0);
    if (!lap) throw new Error('This session has no timed lap to export.');
    const url = target === 'discord' ? savedDiscordWebhook() : null;
    const community = target === 'community' ? configuredCommunity() : null;
    const filename = lapZipFilename(session, lap);
    bestLapExportInProgress = true;
    let temporary;
    try {
      if (target === 'local') {
        const result = await dialog.showSaveDialog(win, {
          title:'Export Best Lap',
          defaultPath:path.join(app.getPath('downloads'), filename),
          filters:[{name:'Total Telemetry ZIP', extensions:['zip']}]
        });
        if (result.canceled || !result.filePath) return null;
        if (path.extname(result.filePath).toLowerCase() !== '.zip') throw new Error('Choose a .zip filename for the export.');
        await exportLapZip(session, lap, result.filePath);
        return path.basename(result.filePath);
      }
      temporary = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'tt-export-'));
      const source = path.join(temporary, 'lap.zip');
      await exportLapZip(session, lap, source);
      if (community) await uploadCommunityLap(community, source, session, lap, sender);
      else await uploadDiscordLap(url, source, filename, discordLapMessage(session, lap));
      return filename;
    } finally {
      if (temporary) await fs.promises.rm(temporary, {recursive:true, force:true}).catch(() => {});
      bestLapExportInProgress = false;
    }
  });
  ipcMain.handle('graph-export-font', () =>
    fs.promises.readFile(path.join(__dirname, 'geist-latin.woff2'), 'base64'));
  ipcMain.handle('export-graph-image', async (_, name, png) => {
    const signature = '89504e470d0a1a0a';
    if (!(png instanceof ArrayBuffer) || png.byteLength > 32 * 1024 * 1024 ||
        Buffer.from(png).subarray(0, 8).toString('hex') !== signature) {
      throw new Error('Could not export the graph as a PNG.');
    }
    const filename = String(name || 'LMU graph').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim().slice(0, 120);
    const result = await dialog.showSaveDialog(win, {
      title: 'Export graph image',
      defaultPath: path.join(app.getPath('downloads'), 'LMU - ' + filename + '.png'),
      filters: [{name:'PNG image', extensions:['png']}]
    });
    if (result.canceled || !result.filePath) return null;
    if (path.extname(result.filePath).toLowerCase() !== '.png') throw new Error('Choose a .png filename for the export.');
    await fs.promises.writeFile(result.filePath, Buffer.from(png));
    return path.basename(result.filePath);
  });
  ipcMain.handle('import-comparison-laps', async () => {
    const result = await dialog.showOpenDialog(win, {
      title:'Import Comparison Laps', properties:['openFile', 'multiSelections'],
      filters:[{name:'Total Telemetry ZIP', extensions:['zip']}]
    });
    const errors = [];
    for (const source of result.filePaths ?? []) {
      try {
        await storeComparisonLap(source);
      } catch (error) {
        errors.push(path.basename(source) + ': ' + error.message);
      }
    }
    return {laps:config.comparisonLaps ?? [], errors};
  });
  ipcMain.handle('remove-comparison-lap', (_, source) => {
    const entries = config.comparisonLaps ?? [];
    const entry = entries.find(item => item.path === source);
    if (!entry) return entries;
    const next = {...config, comparisonLaps:entries.filter(item => item.path !== source)};
    save(next);
    try {
      if (entry.storedFile && /^[a-f0-9-]{36}\.(zip|csv)$/.test(entry.storedFile)) {
        fs.rmSync(comparisonStoragePath(entry.storedFile), {force:true});
      }
    } catch (error) {
      save(config);
      throw error;
    }
    config = next;
    return config.comparisonLaps;
  });
  ipcMain.handle('read-comparison-lap', async (_, source) => {
    const entry = config.comparisonLaps?.find(item => item.path === source);
    if (!entry) throw new Error('This comparison lap is no longer imported.');
    const storedPath = entry.storedFile ? comparisonStoragePath(entry.storedFile) : source;
    const lap = await backend('import-comparison-lap', {path:storedPath, includeChannels:true});
    return lap.channels;
  });
  ipcMain.handle('read-lap', (_, sessionPath, lapId) => {
    const session = sessionIndex.find(item => item.path === sessionPath);
    const lap = session?.laps.find(item => item.id === lapId);
    if (!lap) throw new Error('Lap is no longer in the library.');
    return backend('lap', {path: session.path, start: lap.start, end: lap.end});
  });
  for (const entry of config.comparisonLaps ?? []) {
    if (entry.storedFile) continue;
    try {
      await storeComparisonLap(entry.path, true);
    } catch {
      // Leave unavailable or changed legacy files in the library so they can be reimported.
    }
  }
  if (win.isDestroyed()) return;
  watchFolders(win);
  win.loadFile(path.join(__dirname, 'index.html'));
});

app.on('window-all-closed', () => app.quit());

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const {promises: files} = fs;
const path = require('node:path');
const {createHash, randomUUID, timingSafeEqual} = require('node:crypto');
const {Transform} = require('node:stream');
const {pipeline} = require('node:stream/promises');

const maxBytes = 32 * 1024 * 1024;
const validId = /^[a-f0-9]{64}$/;
const validKey = /^[!-~]{24,256}$/;

function reply(response, status, data) {
  const body = JSON.stringify(data);
  response.writeHead(status, {'Content-Type':'application/json; charset=utf-8',
    'Content-Length':Buffer.byteLength(body), 'Cache-Control':'no-store'});
  response.end(body);
}

function metadata(header) {
  if (typeof header !== 'string' || header.length > 8192) throw new Error('Missing lap details.');
  const value = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
  const result = {};
  for (const key of ['track', 'layout', 'driver', 'gameVersion', 'car']) {
    result[key] = typeof value?.[key] === 'string' ? value[key].trim().slice(0, 160) : '';
  }
  if (!result.track || !result.car || !Number.isFinite(value?.time) || value.time <= 0) {
    throw new Error('Invalid lap details.');
  }
  return {...result, time:value.time};
}

async function upload(request, response, root) {
  const size = Number(request.headers['content-length']);
  if (!Number.isInteger(size) || size < 4 || size > maxBytes) {
    reply(response, 413, {error:'Lap ZIPs must be under 32 MiB.'});
    return;
  }
  let details;
  try {
    details = metadata(request.headers['x-tt-lap']);
  } catch {
    reply(response, 400, {error:'Invalid lap details.'});
    return;
  }
  const temporary = await files.mkdtemp(path.join(root, '.upload-'));
  try {
    const archive = path.join(temporary, 'lap.zip');
    const hash = createHash('sha256');
    let total = 0;
    let signature = Buffer.alloc(0);
    const collect = new Transform({
      transform(chunk, _, callback) {
        total += chunk.length;
        if (total > size) return callback(new Error('Upload exceeds the declared size.'));
        if (signature.length < 4) signature = Buffer.concat([signature, chunk.subarray(0, 4 - signature.length)]);
        hash.update(chunk);
        callback(null, chunk);
      }
    });
    await pipeline(request, collect, fs.createWriteStream(archive, {flags:'wx'}));
    if (total !== size || signature.toString('hex') !== '504b0304') {
      reply(response, 400, {error:'Choose a Total Telemetry lap ZIP.'});
      return;
    }
    const id = hash.digest('hex');
    await files.writeFile(path.join(temporary, 'details.json'), JSON.stringify({...details, id, uploadedAt:new Date().toISOString()}));
    try {
      await files.rename(temporary, path.join(root, id));
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code) ||
          !(await files.stat(path.join(root, id, 'details.json')).catch(() => null))?.isFile()) throw error;
    }
    reply(response, 201, {id});
  } finally {
    await files.rm(temporary, {recursive:true, force:true});
  }
}

async function listLaps(root, params, {unpaged = false} = {}) {
  const ids = (await files.readdir(root)).filter(id => validId.test(id));
  const fields = ['track','layout','driver','gameVersion'];
  const choices = Object.fromEntries(fields.map(field => [field, new Set()]));
  const exact = params.get('match') === 'exact';
  const filters = fields.map(field =>
    [field, (params.get(field) || '').trim().toLowerCase().slice(0, 160)]);
  const matchesTrack = ([field, term]) => field === 'track' && term;
  const trackFilter = filters.find(matchesTrack)?.[1];
  const laps = [];
  for (let offset = 0; offset < ids.length; offset += 32) {
    const batch = await Promise.all(ids.slice(offset, offset + 32).map(async id =>
      JSON.parse(await files.readFile(path.join(root, id, 'details.json'), 'utf8').catch(error => {
        if (error.code === 'ENOENT') return 'null';
        throw error;
      }))));
    for (const lap of batch) {
      if (!lap) continue;
      const track = lap.track?.toLowerCase() || '';
      const matchingTrack = !trackFilter || (exact ? track === trackFilter : track.includes(trackFilter));
      for (const field of fields) {
        if (lap[field] && (field !== 'layout' || matchingTrack)) choices[field].add(lap[field]);
      }
      if (filters.every(([field, term]) => {
        const value = lap[field]?.toLowerCase() || '';
        return !term || (exact ? value === term : value.includes(term));
      })) laps.push(lap);
    }
  }
  if (unpaged) return laps;
  const fastest = params.get('sort') === 'fastest';
  laps.sort((a, b) => (fastest ? a.time - b.time : 0) || b.uploadedAt.localeCompare(a.uploadedAt) || a.id.localeCompare(b.id));
  // Keep the original response for desktop builds that predate pagination.
  if (!params.has('page')) return laps.slice(0, 1000);
  const pageSize = 25;
  const pageCount = Math.max(1, Math.ceil(laps.length / pageSize));
  const page = Math.max(1, Math.min(pageCount, Math.trunc(Number(params.get('page'))) || 1));
  const filterOptions = Object.fromEntries(fields.map(field => [field,
    [...choices[field]].sort((a, b) => a.localeCompare(b, undefined, {numeric:true}))]));
  return {laps:laps.slice((page - 1) * pageSize, page * pageSize), page, pageCount, total:laps.length, filterOptions, layoutOptionsScoped:true};
}

function timingRecord(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid timing record.');
  const text = key => typeof raw[key] === 'string' ? raw[key].trim().slice(0,160) : '';
  const record = Object.fromEntries(['driver','track','layout','layoutVersion','car','carClass','gameVersion','recorded'].map(key => [key,text(key)]));
  const validTime = time => Number.isFinite(time) && time > 0 && time <= 86400;
  if (!record.driver || !record.track || !record.layout || !record.car ||
      !Number.isFinite(Date.parse(record.recorded)) || !validTime(raw.time)) throw new Error('Invalid timing record.');
  const sectors = key => [0,1,2].map(index => validTime(raw[key]?.[index]) ? raw[key][index] : null);
  const lapKey = recordLapKeyPattern.test(raw.lapKey ?? '') ? raw.lapKey : '';
  const variant = record.carClass.toLowerCase() === 'lmp2' && ['WEC','ELMS'].includes(raw.lmp2Variant) ? raw.lmp2Variant : '';
  return {...record,...(variant && {lmp2Variant:variant}),lapKey,...(!lapKey && raw.resultOnly === true && {resultOnly:true}),
    time:raw.time,sectors:sectors('sectors'),bestSectors:sectors('bestSectors'),
    validity:raw.validity === 'official' ? 'official' : 'unconfirmed'};
}

const recordLapKeyPattern = /^[a-f0-9]{64}$/;

const recordClientId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

function clientSecretHash(secret) {
  return typeof secret === 'string' && recordLapKeyPattern.test(secret)
    ? createHash('sha256').update(secret).digest('hex') : null;
}

function ownsRecordIdentity(identity, secret) {
  const hash = clientSecretHash(secret);
  return Boolean(identity && hash && timingSafeEqual(Buffer.from(identity.hash,'hex'),Buffer.from(hash,'hex')));
}

function sharedRecordId(client,record) {
  return createHash('sha256').update(JSON.stringify([client,...['driver','track','layout','carClass']
    .map(field => (record[field].trim() || (field === 'carClass' ? 'Unknown' : '')).toLowerCase()),
    ...(record.lmp2Variant === 'ELMS' ? ['ELMS'] : [])])).digest('hex');
}

function exactTrackRecordKey(record) {
  return JSON.stringify([
    record.driver.trim().toLowerCase(),record.lapKey || 'results',record.track,record.layout,record.carClass,
    record.car,record.gameVersion,record.time,Date.parse(record.recorded)
  ]);
}

function trackRecordGroups(records) {
  const groups = new Map();
  for (const [id,entry] of Object.entries(records)) {
    const {record} = entry;
    const key = !entry.removed && (record.resultOnly || record.lapKey)
      ? JSON.stringify([exactTrackRecordKey(record),record.lmp2Variant === 'ELMS']) : id;
    const group = groups.get(key);
    if (group) group.push([id,entry]);
    else groups.set(key,[[id,entry]]);
  }
  return [...groups.values()];
}

function hasDuplicateTrackRecords(records) {
  return trackRecordGroups(records).some(group => group.length > 1);
}

function migrateTrackRecords(store) {
  if (store.schema === 2) return store;
  const records = {};
  const ids = new Map();
  for (const [oldId,entry] of Object.entries(store.records)) {
    if (entry.record.validity !== 'official') continue;
    const id = sharedRecordId(entry.client,entry.record);
    ids.set(oldId,id);
    if (!records[id] || records[id].record.time > entry.record.time) records[id] = entry;
  }
  const requests = Object.fromEntries(Object.entries(store.requests ?? {}).map(([id,entry]) =>
    [id,{...entry,recordId:ids.get(entry.recordId) ?? entry.recordId,updatedAt:entry.updatedAt ?? Date.now()}]));
  return {...store,schema:2,epoch:randomUUID(),records,requests};
}

const requestExpiry = 14 * 24 * 60 * 60 * 1000;
function activeRequest(entry) {
  return ['pending','accepted','uploaded'].includes(entry.status);
}

async function trackRecordRequest(request,response,root,store,client,action,id) {
  const requests = store.requests ?? {};
  const now = Date.now();
  if (action === 'owner-list') return reply(response,200,{
    records:Object.entries(store.records).filter(([,item]) => !item.removed).map(([id,item]) => ({id,...item.record})),
    requests:Object.values(requests).filter(item => item.status === 'uploaded')
      .map(({id,record,requesterName,updatedAt}) => ({id,record,requesterName,updatedAt}))
  });
  if (action === 'owner-remove') {
    const current = store.records[id];
    if (!current || current.removed) return reply(response,404,{error:'Record unavailable.'});
    const revision = store.revision + 1;
    return {...store,revision,records:{...store.records,[id]:{...current,revision,removed:true}}};
  }
  if (action === 'list') return reply(response,200,Object.values(requests)
    .filter(entry => entry.owner === client || entry.requester === client)
    .map(({owner,requester,...entry}) => ({...entry,incoming:owner === client})));

  const entry = requests[id];
  if (action === 'download') {
    if (!entry || entry.requester !== client || entry.status !== 'uploaded') return reply(response,404,{error:'Requested lap unavailable.'});
    const archive = path.join(root,'.request-' + id + '.zip');
    const size = (await files.stat(archive)).size;
    response.writeHead(200,{'Content-Type':'application/zip','Content-Length':size,'Cache-Control':'no-store'});
    return pipeline(fs.createReadStream(archive),response);
  }
  let updated;
  if (action === 'request') {
    const record = store.records[id];
    if (!record || record.removed || record.client === client || !record.record.lapKey || !store.identities?.[record.client]) return reply(response,404,{error:'Record unavailable.'});
    if (record.record.lapKey !== request.headers['x-tt-record-lap']) return reply(response,409,{error:'Record changed.'});
    const existing = Object.values(requests).find(item => item.requester === client && item.recordId === id &&
      item.record.lapKey === record.record.lapKey && activeRequest(item));
    if (existing) return reply(response,200,{id:existing.id});
    const requesterName = store.identities[client].driver;
    updated = {id:randomUUID(),recordId:id,record:record.record,owner:record.client,requester:client,
      requesterName:requesterName || 'Unknown Driver',status:'pending',updatedAt:now};
  } else if (action === 'owner-revoke') {
    if (!entry || entry.status !== 'uploaded') return reply(response,404,{error:'Uploaded lap unavailable.'});
    updated = {...entry,status:'revoked'};
  } else {
    if (!entry || entry.owner !== client) return reply(response,404,{error:'Request unavailable.'});
    if (action === 'deny' && ['pending','accepted'].includes(entry.status)) updated = {...entry,status:'denied'};
    if (action === 'accept' && ['pending','accepted'].includes(entry.status)) updated = {...entry,status:'accepted'};
    if (action === 'upload' && entry.status === 'accepted') {
      const length = Number(request.headers['content-length']);
      if (!Number.isInteger(length) || length < 4 || length > maxBytes) return reply(response,413,{error:'Invalid lap archive size.'});
      const temporary = path.join(root,'.request-' + id + '.tmp');
      const archive = path.join(root,'.request-' + id + '.zip');
      const hash = createHash('sha256');
      let bytes = 0;
      let signature = Buffer.alloc(0);
      const collect = new Transform({transform(chunk,_,done) {
        bytes += chunk.length;
        if (bytes > length) return done(new Error('Lap exceeds the declared size.'));
        signature = Buffer.concat([signature,chunk.subarray(0,Math.max(0,4-signature.length))]);
        hash.update(chunk);
        done(null,chunk);
      }});
      try {
        await pipeline(request,collect,fs.createWriteStream(temporary));
        if (bytes !== length || signature.toString('hex') !== '504b0304') return reply(response,400,{error:'Invalid lap ZIP.'});
        await files.rename(temporary,archive);
        updated = {...entry,status:'uploaded',sha256:hash.digest('hex')};
      } finally {
        await files.rm(temporary,{force:true});
      }
    }
  }
  if (!updated) return reply(response,409,{error:'Request already resolved.'});
  return {...store,requests:{...requests,[updated.id]:{...updated,updatedAt:now}}};
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

function trackRecordsStore(root, minimumGameVersion) {
  const filename = path.join(root,'track-records.json');
  let store;
  let queue = Promise.resolve();
  const run = task => {
    const current = queue.then(async () => {
      if (!store) {
        const loaded = await files.readFile(filename,'utf8').then(JSON.parse,error => {
          if (error.code !== 'ENOENT') throw error;
          return {schema:2,epoch:randomUUID(),revision:0,records:{}};
        });
        store = migrateTrackRecords(loaded);
        if (!store.exactLapGrouping) store = {...store,exactLapGrouping:true,epoch:randomUUID()};
        if ((store.minimumGameVersion ?? '') !== minimumGameVersion) {
          store = {...store,minimumGameVersion,epoch:randomUUID()};
        }
        if (store !== loaded) await persist(store);
      }
      const requests = {...store.requests};
      let changed = false;
      const expiredArchives = [];
      for (const [id,entry] of Object.entries(requests)) {
        if (Date.now() - entry.updatedAt < requestExpiry) continue;
        if (activeRequest(entry)) {
          requests[id] = {...entry,status:'expired',updatedAt:Date.now()};
          if (entry.status === 'uploaded') expiredArchives.push(id);
        } else delete requests[id];
        changed = true;
      }
      if (changed) await persist({...store,requests});
      for (const id of expiredArchives) await files.rm(path.join(root,'.request-' + id + '.zip'),{force:true});
      await task();
    });
    queue = current.catch(() => {});
    return current;
  };
  const persist = async next => {
    if (store && store.records !== next.records &&
        (hasDuplicateTrackRecords(store.records) || hasDuplicateTrackRecords(next.records))) {
      next = {...next,epoch:randomUUID()};
    }
    const temporary = filename + '.tmp';
    await files.writeFile(temporary,JSON.stringify(next));
    await files.rename(temporary,filename);
    store = next;
  };
  return async (request,response,requestRoute) => {
    if (requestRoute) {
      const client = request.headers['x-tt-record-client'];
      const [action,id] = requestRoute;
      if (!action.startsWith('owner-') && (typeof client !== 'string' || !recordClientId.test(client))) return reply(response,400,{error:'Invalid record client.'});
      return run(async () => {
        if (!action.startsWith('owner-') && !ownsRecordIdentity(store.identities?.[client],request.headers['x-tt-record-secret'])) {
          return reply(response,403,{error:'Private Track Records access requires a verified installation.'});
        }
        if (action === 'request' && !meetsMinimumGameVersion(store.records[id]?.record.gameVersion ?? '', minimumGameVersion)) {
          return reply(response,404,{error:'Record unavailable for the minimum game version.'});
        }
        const next = await trackRecordRequest(request,response,root,store,client,action,id);
        if (next) {
          await persist(next);
          if (action === 'owner-revoke') await files.rm(path.join(root,'.request-' + id + '.zip'),{force:true});
          reply(response,200,{saved:true});
        }
      });
    }
    let data;
    try {
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 256 * 1024) return reply(response,413,{error:'Track record batch is too large.'});
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if ((input.client !== null && (typeof input.client !== 'string' || !recordClientId.test(input.client))) ||
          !Array.isArray(input.records) || input.records.length > 200) throw new Error('Invalid record batch.');
      data = {...input,records:input.records.map(timingRecord)};
    } catch {
      return reply(response,400,{error:'Invalid track record batch.'});
    }

    return run(async () => {
      let identity = store.identities?.[data.client];
      if (data.secret !== undefined) {
        const hash = clientSecretHash(data.secret);
        const driver = typeof data.driver === 'string' ? data.driver.trim().slice(0,160) : '';
        if (!hash || !data.client || !driver || (identity && (!ownsRecordIdentity(identity,data.secret) || identity.driver !== driver))) {
          return reply(response,403,{error:'The installation credentials could not be verified.'});
        }
        if (!identity) {
          const legacy = Object.values(store.records).some(entry => entry.client === data.client) ||
            Object.values(store.requests ?? {}).some(entry => entry.owner === data.client || entry.requester === data.client);
          if (legacy) return reply(response,403,{error:'Legacy installation IDs cannot be claimed.'});
          identity = {driver,hash};
          await persist({...store,identities:{...store.identities,[data.client]:identity}});
        }
      }
      const verified = data.secret !== undefined && Boolean(identity);
      const changes = {};
      let revision = store.revision;
      for (const record of verified ? data.records : []) {
        if (record.driver !== identity.driver || (!record.lapKey && !record.resultOnly)) continue;
        if (record.validity !== 'official' || !meetsMinimumGameVersion(record.gameVersion, minimumGameVersion)) continue;
        const key = sharedRecordId(data.client,record);
        const previous = changes[key] ?? store.records[key];
        if (!previous || !meetsMinimumGameVersion(previous.record.gameVersion, minimumGameVersion) || previous.record.time > record.time ||
            (previous.record.time === record.time && previous.record.resultOnly && record.lapKey)) {
          changes[key] = {client:data.client,revision:++revision,record};
        }
      }
      if (revision !== store.revision) {
        const next = {...store,revision,records:{...store.records,...changes}};
        await persist(next);
      }
      const reset = data.epoch !== store.epoch || !Number.isSafeInteger(data.cursor) ||
        data.cursor < 0 || data.cursor > store.revision;
      const changed = trackRecordGroups(store.records).flatMap(group => {
        if (verified && group.some(([,value]) => value.client === data.client)) return [];
        const visible = group.filter(([,value]) => meetsMinimumGameVersion(value.record.gameVersion,minimumGameVersion));
        if (!visible.length) return [];
        const newest = visible.reduce((latest,entry) => entry[1].revision > latest[1].revision ? entry : latest);
        return reset || newest[1].revision > data.cursor ? [newest] : [];
      }).sort((a,b) => a[1].revision - b[1].revision);
      const page = changed.slice(0,500);
      const more = changed.length > page.length;
      reply(response,200,{epoch:store.epoch,reset,more,minimumGameVersion,
        cursor:more ? page.at(-1)[1].revision : store.revision,
        records:page.map(([id,value]) => value.removed ? {id,removed:true} : {id,...value.record,requestable:Boolean(value.record.lapKey && store.identities?.[value.client])})});
    });

  };
}

const installerPattern = /^Total-Telemetry-TPR-Edition-(\d{1,9}\.\d{1,9}\.\d{1,9})-Setup\.exe$/;
const maxInstallerBytes = 1024 * 1024 * 1024;

function tprUpdates(directory) {
  let cached;
  return async (response, filename) => {
    if (filename) {
      if (!installerPattern.test(filename)) return reply(response,404,{error:'Update unavailable.'});
      const source = path.join(directory,filename);
      const stat = await files.lstat(source).catch(error => {
        if (error.code !== 'ENOENT') throw error;
        return null;
      });
      if (!stat?.isFile() || !stat.size || stat.size > maxInstallerBytes) {
        return reply(response,404,{error:'Update unavailable.'});
      }
      response.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-store'});
      return pipeline(fs.createReadStream(source),response);
    }

    const entries = await files.readdir(directory,{withFileTypes:true});
    const releases = entries.flatMap(entry => {
      const match = installerPattern.exec(entry.name);
      return match && entry.isFile() ? [{filename:entry.name,version:match[1]}] : [];
    });
    releases.sort((a,b) => b.version.localeCompare(a.version,'en',{numeric:true}));
    const latest = releases[0];
    if (!latest) return reply(response,200,{update:null});
    const source = path.join(directory,latest.filename);
    const stat = await files.lstat(source);
    if (!stat.isFile() || !stat.size || stat.size > maxInstallerBytes) return reply(response,200,{update:null});
    const key = JSON.stringify([latest.filename,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs]);
    if (cached?.key !== key) {
      const digest = (async () => {
        const hash = createHash('sha256');
        for await (const chunk of fs.createReadStream(source)) hash.update(chunk);
        const after = await files.lstat(source);
        if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) {
          throw new Error('The update installer changed during verification.');
        }
        return hash.digest('hex');
      })();
      const entry = {key,digest};
      cached = entry;
      void digest.catch(() => { if (cached === entry) cached = undefined; });
    }
    return reply(response,200,{update:{...latest,size:stat.size,sha256:await cached.digest}});
  };
}

async function serve(request, response, {root, expected, owner, syncTrackRecords, serveUpdates, serverVersion}) {
  const supplied = Buffer.from(request.headers.authorization || '');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    reply(response, 401, {error:'Incorrect community access key.'});
    return;
  }
  const url = new URL(request.url, 'http://localhost');
  const updateRoute = /^\/v1\/tpr-updates(?:\/([^/]+))?$/.exec(url.pathname);
  if (serveUpdates && updateRoute && request.method === 'GET') {
    return serveUpdates(response,updateRoute[1]);
  }
  const recordOwnerRoute = /^\/v1\/track-records\/owner(?:\/(remove|revoke)\/([a-f0-9-]{36}|[a-f0-9]{64}))?$/.exec(url.pathname);
  if (recordOwnerRoute && request.method === (recordOwnerRoute[1] ? 'DELETE' : 'GET')) {
    const password = Buffer.from(request.headers['x-tt-owner-password'] || '');
    if (!owner || password.length !== owner.length || !timingSafeEqual(password,owner))
      return reply(response,403,{error:'Incorrect owner password.'});
    return syncTrackRecords(request,response,['owner-' + (recordOwnerRoute[1] || 'list'),recordOwnerRoute[2]]);
  }
  if (url.pathname === '/v1/track-records' && request.method === 'GET') {
    return reply(response,200,{privateRecordProtocol:1,resultOnlyTrackRecords:true,lmp2Variants:true,serverVersion});
  }
  if (url.pathname === '/v1/track-records' && request.method === 'POST') return syncTrackRecords(request,response);
  if (url.pathname === '/v1/track-records/requests' && request.method === 'GET') return syncTrackRecords(request,response,['list']);
  const recordRequest = /^\/v1\/track-records\/requests\/(request|accept|deny|upload|download)\/([a-f0-9-]{36}|[a-f0-9]{64})$/.exec(url.pathname);
  if (recordRequest && request.method === (recordRequest[1] === 'download' ? 'GET' : 'POST'))
    return syncTrackRecords(request,response,recordRequest.slice(1));
  if (url.pathname === '/v1/laps') {
    if (request.method === 'POST' && !url.search) return upload(request, response, root);
    if (request.method === 'GET') {
      const result = await listLaps(root, url.searchParams);
      return reply(response, 200, Array.isArray(result) ? result : {...result, ownerActions:Boolean(owner)});
    }
  }
  const id = request.url?.match(/^\/v1\/laps\/([a-f0-9]{64})$/)?.[1];
  if (id && request.method === 'DELETE') {
    if (!owner) return reply(response, 403, {error:'Owner access is not configured.'});
    const password = Buffer.from(request.headers['x-tt-owner-password'] || '');
    if (password.length !== owner.length || !timingSafeEqual(password, owner)) {
      return reply(response, 403, {error:'Incorrect owner password.'});
    }
    const removed = path.join(root, '.removed-' + randomUUID());
    try {
      await files.rename(path.join(root, id), removed);
    } catch (error) {
      if (error.code === 'ENOENT') return reply(response, 404, {error:'Lap is already unavailable.'});
      throw error;
    }
    await files.rm(removed, {recursive:true, force:true});
    return reply(response, 200, {removed:true});
  }
  if (id && request.method === 'GET') {
    const archive = path.join(root, id, 'lap.zip');
    const stats = await files.stat(archive).catch(() => null);
    if (stats?.isFile()) {
      response.writeHead(200, {'Content-Type':'application/zip', 'Content-Length':stats.size, 'Cache-Control':'no-store'});
      await pipeline(fs.createReadStream(archive), response);
      return;
    }
  }
  reply(response, 404, {error:'Lap or route is unavailable.'});
}

function createCommunityServer({directory, key, ownerPassword, minimumGameVersion = '', updatesDirectory, serverVersion, onError = console.error}) {
  if (typeof key !== 'string' || !validKey.test(key)) throw new Error('Enter an access key of 24–256 characters without spaces.');
  if (ownerPassword && (typeof ownerPassword !== 'string' || !/^[!-~]{12,256}$/.test(ownerPassword) || ownerPassword === key)) {
    throw new Error('Enter a separate owner password of 12–256 characters without spaces.');
  }
  if (typeof minimumGameVersion !== 'string' || (minimumGameVersion && !/^\d{1,9}(\.\d{1,9}){1,5}$/.test(minimumGameVersion))) {
    throw new Error('Enter a minimum game version such as 1.1.2 or leave it blank.');
  }
  const root = path.resolve(directory);
  fs.mkdirSync(root, {recursive:true});
  if (updatesDirectory) fs.mkdirSync(updatesDirectory,{recursive:true});
  const serveUpdates = updatesDirectory ? tprUpdates(updatesDirectory) : null;
  const options = {root,serveUpdates,serverVersion,syncTrackRecords:trackRecordsStore(root, minimumGameVersion),
    expected:Buffer.from('Bearer ' + key),owner:ownerPassword ? Buffer.from(ownerPassword) : null};
  return http.createServer({requestTimeout:120_000}, (request, response) => {
    serve(request, response, options).catch(error => {
      onError(error.message);
      if (response.destroyed) return;
      if (response.headersSent) response.destroy();
      else reply(response, 500, {error:'Community server could not complete the request.'});
    });
  });
}

async function sharedLapSummary(directory) {
  const stored = await files.readFile(path.join(directory,'track-records.json'),'utf8')
    .then(JSON.parse,error => {
      if (error.code === 'ENOENT') return {records:{}};
      throw error;
    });
  const records = trackRecordGroups(stored.records).map(group => group[0][1]).filter(entry => !entry.removed);
  const shared = await listLaps(directory,new URLSearchParams(),{unpaged:true}).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const now = Date.now();
  const requested = Object.values(stored.requests ?? {}).filter(entry =>
    entry.status === 'uploaded' && now - entry.updatedAt < requestExpiry);
  const drivers = new Map();
  function countDriver(rawName, field) {
    const name = rawName?.trim() || 'Unknown Driver';
    const key = name.toLowerCase();
    const driver = drivers.get(key) ?? {name,records:0,telemetry:0};
    driver[field]++;
    drivers.set(key,driver);
  }
  for (const {record} of records) countDriver(record.driver,'records');
  for (const lap of shared) countDriver(lap.driver,'telemetry');
  for (const {record} of requested) countDriver(record.driver,'telemetry');
  return {records:records.length,telemetry:shared.length + requested.length,
    drivers:[...drivers.values()].sort((a,b) => a.name.localeCompare(b.name))};
}

module.exports = {createCommunityServer,sharedLapSummary,installerPattern,maxInstallerBytes};

if (require.main === module) {
  const host = process.env.TT_COMMUNITY_BIND || '127.0.0.1';
  const port = Number(process.env.TT_COMMUNITY_PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Set a valid TT_COMMUNITY_PORT.');
  const server = createCommunityServer({
    directory:process.env.TT_COMMUNITY_DATA || path.join(__dirname, 'data'),
    serverVersion:require('./package.json').version,
    updatesDirectory:process.env.TT_TPR_UPDATES_DIRECTORY,
    key:process.env.TT_COMMUNITY_KEY, ownerPassword:process.env.TT_COMMUNITY_OWNER_PASSWORD, minimumGameVersion:process.env.TT_COMMUNITY_MINIMUM_GAME_VERSION
  });
  server.listen(port, host, () => console.log('Total Telemetry Community Server listening on ' + host + ':' + port));
}

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

async function listLaps(root, params) {
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

async function serve(request, response, {root, expected, owner}) {
  const supplied = Buffer.from(request.headers.authorization || '');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    reply(response, 401, {error:'Incorrect community access key.'});
    return;
  }
  const url = new URL(request.url, 'http://localhost');
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

function createCommunityServer({directory, key, ownerPassword, onError = console.error}) {
  if (typeof key !== 'string' || !validKey.test(key)) throw new Error('Enter an access key of 24–256 characters without spaces.');
  if (ownerPassword && (typeof ownerPassword !== 'string' || !/^[!-~]{12,256}$/.test(ownerPassword) || ownerPassword === key)) {
    throw new Error('Enter a separate owner password of 12–256 characters without spaces.');
  }
  const root = path.resolve(directory);
  fs.mkdirSync(root, {recursive:true});
  const options = {root, expected:Buffer.from('Bearer ' + key), owner:ownerPassword ? Buffer.from(ownerPassword) : null};
  return http.createServer({requestTimeout:120_000}, (request, response) => {
    serve(request, response, options).catch(error => {
      onError(error.message);
      if (response.destroyed) return;
      if (response.headersSent) response.destroy();
      else reply(response, 500, {error:'Community server could not complete the request.'});
    });
  });
}

module.exports = {createCommunityServer};

if (require.main === module) {
  const host = process.env.TT_COMMUNITY_BIND || '127.0.0.1';
  const port = Number(process.env.TT_COMMUNITY_PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Set a valid TT_COMMUNITY_PORT.');
  const server = createCommunityServer({
    directory:process.env.TT_COMMUNITY_DATA || path.join(__dirname, 'data'),
    key:process.env.TT_COMMUNITY_KEY, ownerPassword:process.env.TT_COMMUNITY_OWNER_PASSWORD
  });
  server.listen(port, host, () => console.log('Total Telemetry Community Server listening on ' + host + ':' + port));
}

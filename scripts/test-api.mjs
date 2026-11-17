import { mkdir, rm } from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.env.HOTSPOT_DATA_FILE = path.join(root, '.data', 'test-devices.json');
await rm(process.env.HOTSPOT_DATA_FILE, { force: true });
await mkdir(path.dirname(process.env.HOTSPOT_DATA_FILE), { recursive: true });

const fns = path.join(root, 'netlify', 'functions');
const fnsBase = pathToFileURL(fns + path.sep);
async function load(name) {
  return (await import(new URL(name + '.mjs', fnsBase).href)).default;
}

function makeReq(method, url, body, authToken) {
  const headers = new Headers({ host: 'localhost:8787' });
  if (authToken) headers.set('authorization', 'Bearer ' + authToken);
  return { method, url, headers, json: async () => body || {} };
}

let passed = 0, failed = 0;
async function check(name, cond, extra = '') {
  if (cond) { passed++; console.log('  PASS  ' + name); }
  else { failed++; console.log('  FAIL  ' + name + (extra ? ' -> ' + extra : '')); }
}

const login = await load('login');
const register = await load('register');
const poll = await load('poll');
const report = await load('report');
const command = await load('command');
const devices = await load('devices');

console.log('== Login ==');
const bad = await login(makeReq('POST', '/api/login', { user: 'admin', pw: 'salah' }));
check('login salah ditolak (401)', bad.status === 401, JSON.stringify(bad.status));
const good = await login(makeReq('POST', '/api/login', { user: 'admin', pw: 'locABA10' }));
const goodBody = await good.json();
check('login benar dapat token', good.status === 200 && goodBody.token);
const adminToken = goodBody.token;

console.log('== Register ==');
const reg = await register(makeReq('POST', '/api/register', { device_id: 'Store-Test-01', name: 'Store Test 01' }));
const regBody = await reg.json();
check('register sukses', reg.status === 200 && regBody.ok && regBody.token);
const devId = regBody.device_id, devToken = regBody.token;

console.log('== Poll & Command ==');
const poll1 = await poll(makeReq('GET', `/api/poll?device_id=${devId}&token=${devToken}`));
check('poll awal tanpa perintah', (await poll1.json()).command === null);
const pollBad = await poll(makeReq('GET', `/api/poll?device_id=${devId}&token=tokepalsu`));
check('poll token salah ditolak (403)', pollBad.status === 403);

const cmdNoAuth = await command(makeReq('POST', '/api/command', { device_id: devId, action: 'ON' }));
check('command tanpa login ditolak (401)', cmdNoAuth.status === 401);
const cmd = await command(makeReq('POST', '/api/command', { device_id: devId, action: 'ON' }, adminToken));
check('command ON tersimpan', cmd.status === 200 && (await cmd.json()).pending === 'ON');

const poll2 = await poll(makeReq('GET', `/api/poll?device_id=${devId}&token=${devToken}`));
check('poll mengembalikan perintah ON', (await poll2.json()).command === 'ON');

console.log('== Report ==');
const rep = await report(makeReq('POST', '/api/report', { device_id: devId, token: devToken, hotspot: 'ON', error: '' }));
check('report ON diterima', rep.status === 200);
const poll3 = await poll(makeReq('GET', `/api/poll?device_id=${devId}&token=${devToken}`));
check('perintah terhapus setelah report sukses', (await poll3.json()).command === null);

const repErr = await report(makeReq('POST', '/api/report', { device_id: devId, token: devToken, hotspot: 'ERROR', error: 'Adapter tidak support' }));
check('report ERROR diterima', repErr.status === 200);

console.log('== Devices (admin) ==');
const list = await devices(makeReq('GET', '/api/devices', null, adminToken));
const listBody = await list.json();
check('daftar device ada 1', listBody.devices && listBody.devices.length === 1);
check('token device tidak bocor di API', listBody.devices[0] && !listBody.devices[0].token);
check('status ERROR tersimpan', listBody.devices[0] && listBody.devices[0].hotspot === 'ERROR');
const listNoAuth = await devices(makeReq('GET', '/api/devices'));
check('devices tanpa login ditolak (401)', listNoAuth.status === 401);

console.log('== Script download ==');
const script = await load('script');
const scr = await script(makeReq('GET', '/api/script'));
const scrText = await scr.text();
check('installer ter-download', scr.status === 200 && scrText.includes('Store_Guest'));
check('URL server ter-inject', scrText.includes('https://localhost:8787') && !scrText.includes('__SERVER_URL__'));
check('header attachment benar', (scr.headers.get('content-disposition') || '').includes('install-agent.ps1'));

console.log(`\nHasil: ${passed} pass, ${failed} fail`);
process.exit(failed ? 1 : 0);

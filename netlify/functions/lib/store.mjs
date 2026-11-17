import { getStore } from '@netlify/blobs';
import { promises as fs } from 'fs';
import path from 'path';

let blobStore = null;
let localMode = false;

const DATA_DIR = process.env.HOTSPOT_DATA_DIR || path.join(process.cwd(), '.data');
const ON_NETLIFY = Boolean(process.env.NETLIFY_BLOBS_CONTEXT);

const KEY_DEVICES = 'devices';
const KEY_SEEN = 'last_seen';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn) {
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      await sleep(200 * (i + 1));
    }
  }
  throw lastErr;
}

function blobGet(key) {
  if (!blobStore) blobStore = getStore('hotspot');
  return withRetry(async () => {
    const raw = await blobStore.get(key, { type: 'json' });
    return raw && typeof raw === 'object' ? raw : {};
  });
}

function blobSet(key, data) {
  return withRetry(() => blobStore.set(key, JSON.stringify(data)));
}

function localFile(key) {
  return path.join(DATA_DIR, `${key}.json`);
}

async function localRead(key) {
  try {
    const data = JSON.parse(await fs.readFile(localFile(key), 'utf8'));
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

async function localWrite(key, data) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(localFile(key), JSON.stringify(data, null, 2));
}

async function readKey(key) {
  if (!localMode) {
    try {
      return await blobGet(key);
    } catch (e) {
      if (ON_NETLIFY) {
        // Di Netlify tidak ada file lokal yang berguna; lempar agar jadi 500,
        // bukan fallback kosong yang menyesatkan jadi 403 "device tidak dikenal".
        throw e;
      }
      if (!process.env.HOTSPOT_DATA_DIR) console.warn('Netlify Blobs tidak tersedia, pakai file lokal:', e.message);
      localMode = true;
      blobStore = null;
    }
  }
  return localRead(key);
}

async function writeKey(key, data) {
  if (!localMode) {
    try {
      await blobSet(key, data);
      return;
    } catch (e) {
      if (ON_NETLIFY) throw e;
      localMode = true;
      blobStore = null;
    }
  }
  await localWrite(key, data);
}

export async function getDevice(id) {
  const all = await readKey(KEY_DEVICES);
  return all[id] || null;
}

export async function setDevice(dev) {
  const all = await readKey(KEY_DEVICES);
  all[dev.id] = dev;
  await writeKey(KEY_DEVICES, all);
}

export async function touchSeen(id) {
  const seen = await readKey(KEY_SEEN);
  seen[id] = Date.now();
  await writeKey(KEY_SEEN, seen);
}

export async function listDevices() {
  const [all, seen] = await Promise.all([readKey(KEY_DEVICES), readKey(KEY_SEEN)]);
  return Object.values(all)
    .map((dev) => ({ ...dev, last_seen: seen[dev.id] || dev.last_seen || null }))
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

export function publicDevice(dev) {
  return {
    id: dev.id,
    name: dev.name,
    hotspot: dev.hotspot || 'UNKNOWN',
    last_seen: dev.last_seen || null,
    pending: dev.pending || null,
    error: dev.error || null,
    created: dev.created || null
  };
}

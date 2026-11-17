import { getStore } from '@netlify/blobs';
import { promises as fs } from 'fs';
import path from 'path';

let blobStore = null;
let localMode = false;
let localCache = null;

const DATA_FILE = process.env.HOTSPOT_DATA_FILE || path.join(process.cwd(), '.data', 'devices.json');
const ON_NETLIFY = Boolean(process.env.NETLIFY_BLOBS_CONTEXT);

async function blobGet() {
  if (!blobStore) blobStore = getStore('hotspot');
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      const raw = await blobStore.get('devices', { type: 'json' });
      return raw && typeof raw === 'object' ? raw : {};
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
  throw lastErr;
}

async function readAll() {
  if (!localMode) {
    try {
      return await blobGet();
    } catch (e) {
      if (ON_NETLIFY) {
        // Di Netlify tidak ada file lokal yang berguna; lempar agar jadi 500,
        // bukan fallback kosong yang menyesatkan jadi 403 "device tidak dikenal".
        throw e;
      }
      if (!process.env.HOTSPOT_DATA_FILE) console.warn('Netlify Blobs tidak tersedia, pakai file lokal:', e.message);
      localMode = true;
      blobStore = null;
    }
  }
  if (localCache === null) {
    try {
      localCache = JSON.parse(await fs.readFile(DATA_FILE, 'utf8'));
    } catch {
      localCache = {};
    }
  }
  return localCache;
}

async function writeAll(data) {
  if (!localMode) {
    try {
      await blobStore.set('devices', JSON.stringify(data));
      return;
    } catch {
      localMode = true;
    }
  }
  localCache = data;
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2));
}

export async function getDevice(id) {
  const all = await readAll();
  return all[id] || null;
}

export async function setDevice(dev) {
  const all = await readAll();
  all[dev.id] = dev;
  await writeAll(all);
}

export async function listDevices() {
  const all = await readAll();
  return Object.values(all).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
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

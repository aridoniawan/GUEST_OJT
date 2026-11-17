import { randomBytes } from 'crypto';
import { wrap, json, readBody } from './lib/http.mjs';
import { getDevice, setDevice, touchSeen } from './lib/store.mjs';

export default wrap(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method tidak diizinkan' });
  const { device_id, name } = await readBody(req);
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(String(device_id || ''))) {
    return json(400, { error: 'device_id tidak valid' });
  }
  const storeName = String(name || '').trim().slice(0, 80) || device_id;
  const existing = await getDevice(device_id);
  if (existing) {
    existing.name = storeName;
    await setDevice(existing);
    await touchSeen(device_id);
    return json(200, { ok: true, device_id: existing.id, token: existing.token });
  }
  const token = randomBytes(16).toString('hex');
  await setDevice({
    id: device_id,
    name: storeName,
    token,
    hotspot: 'UNKNOWN',
    pending: null,
    error: null,
    created: Date.now()
  });
  await touchSeen(device_id);
  return json(200, { ok: true, device_id, token });
});

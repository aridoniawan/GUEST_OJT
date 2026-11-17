import { createHash, timingSafeEqual } from 'crypto';
import { wrap, json, readBody } from './lib/http.mjs';
import { getDevice, setDevice } from './lib/store.mjs';

function safeEqual(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export default wrap(async (req) => {
  let deviceId = '';
  let token = '';
  if (req.method === 'POST') {
    const body = await readBody(req);
    deviceId = String(body.device_id || '');
    token = String(body.token || '');
  } else if (req.method === 'GET') {
    const qs = String(req.url || '').split('?')[1] || '';
    const params = new URLSearchParams(qs);
    deviceId = params.get('device_id') || '';
    token = params.get('token') || '';
  } else {
    return json(405, { error: 'Method tidak diizinkan' });
  }
  const dev = await getDevice(deviceId);
  if (!dev || !safeEqual(token, dev.token)) {
    return json(403, { error: 'Device tidak dikenal' });
  }
  dev.last_seen = Date.now();
  await setDevice(dev);
  return json(200, { command: dev.pending || null });
});

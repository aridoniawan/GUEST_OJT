import { createHash, timingSafeEqual } from 'crypto';
import { wrap, json } from './lib/http.mjs';
import { getDevice, setDevice } from './lib/store.mjs';

function safeEqual(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export default wrap(async (req) => {
  if (req.method !== 'GET') return json(405, { error: 'Method tidak diizinkan' });
  const url = new URL(req.url, 'http://localhost');
  const deviceId = url.searchParams.get('device_id') || '';
  const token = url.searchParams.get('token') || '';
  const dev = await getDevice(deviceId);
  if (!dev || !safeEqual(token, dev.token)) {
    return json(403, { error: 'Device tidak dikenal' });
  }
  dev.last_seen = Date.now();
  await setDevice(dev);
  return json(200, { command: dev.pending || null });
});

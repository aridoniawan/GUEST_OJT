import { createHash, timingSafeEqual } from 'crypto';
import { wrap, json, readBody } from './lib/http.mjs';
import { getDevice, setDevice } from './lib/store.mjs';

function safeEqual(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export default wrap(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method tidak diizinkan' });
  const { device_id, token, hotspot, error } = await readBody(req);
  const dev = await getDevice(device_id);
  if (!dev || !safeEqual(token, dev.token)) {
    return json(403, { error: 'Device tidak dikenal' });
  }
  dev.last_seen = Date.now();
  if (['ON', 'OFF', 'ERROR'].includes(hotspot)) {
    dev.hotspot = hotspot;
    dev.error = hotspot === 'ERROR' ? String(error || 'Gagal mengubah status hotspot').slice(0, 300) : null;
    if (hotspot === 'ON' || hotspot === 'OFF') dev.pending = null;
  }
  await setDevice(dev);
  return json(200, { ok: true });
});

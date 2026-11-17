import { createHash, timingSafeEqual } from 'crypto';
import { wrap, json, readBody } from './lib/http.mjs';
import { getDevice, setDevice, touchSeen } from './lib/store.mjs';

function safeEqual(a, b) {
  const ha = createHash('sha256').update(String(a)).digest();
  const hb = createHash('sha256').update(String(b)).digest();
  return timingSafeEqual(ha, hb);
}

export default wrap(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method tidak diizinkan' });
  const { device_id, token, hotspot, error, done } = await readBody(req);
  const dev = await getDevice(device_id);
  if (!dev || !safeEqual(token, dev.token)) {
    return json(403, { error: 'Device tidak dikenal' });
  }
  await touchSeen(device_id);
  if (['ON', 'OFF', 'ERROR'].includes(hotspot)) {
    dev.hotspot = hotspot;
    dev.error = hotspot === 'ERROR' ? String(error || 'Gagal mengubah status hotspot').slice(0, 300) : null;
    // Hapus pending hanya kalau laporan ini memang hasil eksekusi perintah
    // yang sedang menunggu (jangan hapus perintah baru yang belum dieksekusi).
    if ((hotspot === 'ON' || hotspot === 'OFF') && done && dev.pending === done) {
      dev.pending = null;
    }
  }
  await setDevice(dev);
  return json(200, { ok: true });
});

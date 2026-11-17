import { wrap, json, readBody } from './lib/http.mjs';
import { verifyToken, authFrom } from './lib/auth.mjs';
import { removeDevice } from './lib/store.mjs';

export default wrap(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method tidak diizinkan' });
  if (!verifyToken(authFrom(req))) return json(401, { error: 'Login admin diperlukan' });
  const { device_id } = await readBody(req);
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(String(device_id || ''))) {
    return json(400, { error: 'device_id tidak valid' });
  }
  const removed = await removeDevice(device_id);
  if (!removed) return json(404, { error: 'Device tidak ditemukan' });
  return json(200, { ok: true, device_id });
});

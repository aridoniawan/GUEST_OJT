import { wrap, json, readBody } from './lib/http.mjs';
import { verifyToken, authFrom } from './lib/auth.mjs';
import { getDevice, setDevice } from './lib/store.mjs';

export default wrap(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method tidak diizinkan' });
  if (!verifyToken(authFrom(req))) return json(401, { error: 'Login admin diperlukan' });
  const { device_id, action } = await readBody(req);
  if (!['ON', 'OFF'].includes(action)) {
    return json(400, { error: 'action harus ON atau OFF' });
  }
  const dev = await getDevice(device_id);
  if (!dev) return json(404, { error: 'Device tidak ditemukan' });
  dev.pending = action;
  await setDevice(dev);
  return json(200, { ok: true, device_id, pending: action });
});

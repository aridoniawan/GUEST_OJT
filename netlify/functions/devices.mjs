import { wrap, json } from './lib/http.mjs';
import { verifyToken, authFrom } from './lib/auth.mjs';
import { listDevices, publicDevice } from './lib/store.mjs';

export default wrap(async (req) => {
  if (req.method !== 'GET') return json(405, { error: 'Method tidak diizinkan' });
  if (!verifyToken(authFrom(req))) return json(401, { error: 'Login admin diperlukan' });
  const devices = await listDevices();
  return json(200, { ok: true, devices: devices.map(publicDevice) });
});

import { wrap, json, readBody } from './lib/http.mjs';
import { checkLogin, signToken } from './lib/auth.mjs';

export default wrap(async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method tidak diizinkan' });
  const { user, pw } = await readBody(req);
  if (!checkLogin(user, pw)) {
    return json(401, { error: 'Username atau password salah' });
  }
  return json(200, { ok: true, token: signToken() });
});

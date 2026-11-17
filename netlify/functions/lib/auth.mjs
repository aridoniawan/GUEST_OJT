import { createHash, createHmac, timingSafeEqual } from 'crypto';

export const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD_HASH =
  process.env.ADMIN_PASSWORD_HASH ||
  'a36e59f79a97121a53c7c93bcc0b401138bb0284b124cca5916078385127b340';
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

function secret() {
  return process.env.SESSION_SECRET || 'wifi-guest:' + ADMIN_PASSWORD_HASH;
}

export function checkLogin(user, pw) {
  const h = createHash('sha256').update(String(pw || '')).digest('hex');
  return user === ADMIN_USER && timingSafeEqual(Buffer.from(h), Buffer.from(ADMIN_PASSWORD_HASH));
}

export function signToken() {
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = `admin.${exp}`;
  const sig = createHmac('sha256', secret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'admin') return false;
  const exp = Number(parts[1]);
  if (!exp || exp < Date.now()) return false;
  const payload = `${parts[0]}.${parts[1]}`;
  const expect = createHmac('sha256', secret()).update(payload).digest('hex');
  return timingSafeEqual(Buffer.from(parts[2]), Buffer.from(expect));
}

export function authFrom(req) {
  const h = req.headers.get('authorization') || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

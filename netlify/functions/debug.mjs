import { createHash } from 'crypto';
import { wrap, json, readBody } from './lib/http.mjs';
import { getDevice } from './lib/store.mjs';

export default wrap(async (req) => {
  const body = await readBody(req);
  const deviceId = String(body.device_id || '');
  const dev = await getDevice(deviceId);
  return json(200, {
    reqUrl: String(req.url || ''),
    method: req.method,
    body,
    deviceId,
    devFound: !!dev,
    devTokenHash: dev ? createHash('sha256').update(String(dev.token)).digest('hex').slice(0, 16) : null,
    sentTokenHash: body.token ? createHash('sha256').update(String(body.token)).digest('hex').slice(0, 16) : null,
    env: {
      blobs: !!process.env.NETLIFY_BLOBS_CONTEXT,
      siteId: (process.env.SITE_ID || '').slice(0, 12),
      deployId: (process.env.DEPLOY_ID || '').slice(0, 16)
    }
  });
});

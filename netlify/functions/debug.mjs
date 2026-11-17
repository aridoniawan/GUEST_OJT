import { wrap, json } from './lib/http.mjs';
import report from './report.mjs';
import { getDevice } from './lib/store.mjs';

export default wrap(async (req) => {
  const direct = await getDevice('ARI-TEST-f716c79e');
  const r = await report(req);
  let respBody = null;
  try { respBody = await r.json(); } catch { }
  return json(200, {
    directDevFound: !!direct,
    directTokenHash: direct ? String(direct.token).slice(0, 8) : null,
    reportStatus: r.status,
    reportBody: respBody
  });
});

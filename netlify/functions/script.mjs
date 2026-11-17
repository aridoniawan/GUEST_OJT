import { wrap } from './lib/http.mjs';
import template from './lib/install-template.mjs';

export default wrap(async (req) => {
  if (req.method !== 'GET') return new Response('Method tidak diizinkan', { status: 405 });
  const host = req.headers.get('host') || 'localhost:8888';
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const serverUrl = `${proto}://${host}`;
  const script = template.script.replaceAll('__SERVER_URL__', serverUrl);
  return new Response(script, {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="install-agent.ps1"',
      'Cache-Control': 'no-store'
    }
  });
});

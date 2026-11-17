import { createServer } from 'http';
import { readFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pub = path.join(root, 'public');
const fns = path.join(root, 'netlify', 'functions');
const PORT = process.env.PORT || 8787;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ps1': 'application/octet-stream',
  '.bat': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8'
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).split('/')[0] || '';
      const modPath = path.join(fns, name + '.mjs');
      let mod;
      try {
        mod = await import(pathToFileURL(modPath).href);
      } catch {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Endpoint tidak ditemukan' }));
        return;
      }
      const headers = new Headers(req.headers);
      headers.set('host', req.headers.host || `localhost:${PORT}`);
      const fakeReq = {
        method: req.method,
        url: req.url,
        headers,
        json: async () => {
          const chunks = [];
          for await (const c of req) chunks.push(c);
          try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return {}; }
        }
      };
      const resp = await mod.default(fakeReq, {});
      res.writeHead(resp.status, Object.fromEntries(resp.headers.entries()));
      res.end(await resp.text());
      return;
    }
    let filePath = path.normalize(path.join(pub, decodeURIComponent(url.pathname)));
    if (!filePath.startsWith(pub)) { res.writeHead(403); res.end('Forbidden'); return; }
    if (filePath.endsWith(path.sep)) filePath = path.join(filePath, 'index.html');
    let body;
    try {
      body = await readFile(filePath);
    } catch {
      filePath = path.join(pub, 'index.html');
      try { body = await readFile(filePath); } catch { res.writeHead(404); res.end('Not found'); return; }
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    console.error(e);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server error' }));
  }
});

server.listen(PORT, () => {
  console.log(`WifiGuest dev server: http://localhost:${PORT}`);
  console.log('API routes: /api/* (dengan fallback penyimpanan file lokal di .data/)');
});

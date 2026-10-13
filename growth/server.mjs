// Local control server for Compound Wahala growth tools.
//   npm run growth:server   →  http://127.0.0.1:8787/dashboard  and  /review
// - Runs the same analytics Worker code as production, on a local SQLite file (growth/data/analytics.sqlite).
// - Serves the dashboard and the content review queue (approve / reject / record manual posts).
// Listens on 127.0.0.1 only. Admin API calls need ADMIN_TOKEN (growth/.env).
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import worker from './analytics/worker.mjs';
import { sqliteD1 } from './analytics/sqlite-d1.mjs';
import { config, DATA, GROWTH } from './lib/env.mjs';
import * as queue from './lib/queue.mjs';

const PORT = Number(process.env.GROWTH_PORT || 8787);
const env = {
  DB: sqliteD1(process.env.ANALYTICS_DB || join(DATA, 'analytics.sqlite')),
  ADMIN_TOKEN: process.env.ADMIN_TOKEN || '',
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '*',
  // Payments stay off unless all of these are set (see growth/MONETIZATION.md).
  PAYMENTS_ENABLED: process.env.PAYMENTS_ENABLED || 'false',
  PAYSTACK_SECRET_KEY: process.env.PAYSTACK_SECRET_KEY || '',
  ENTITLEMENT_SECRET: process.env.ENTITLEMENT_SECRET || '',
  PAYSTACK_API_BASE: process.env.PAYSTACK_API_BASE || '', // tests only
};
if ((env.ADMIN_TOKEN || '').length < 16) console.warn('⚠ ADMIN_TOKEN missing or shorter than 16 characters: admin API is locked. Copy growth/.env.example to growth/.env.');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webm': 'video/webm', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };

function sendFile(res, file) {
  if (!existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end('not found'); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(file).pipe(res);
}

const isAdmin = (req) => {
  const got = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  return env.ADMIN_TOKEN.length >= 16 && got === env.ADMIN_TOKEN;
};

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;
  try {
    if (p === '/' || p === '/dashboard') return sendFile(res, join(GROWTH, 'dashboard', 'index.html'));
    if (p === '/review') return sendFile(res, join(GROWTH, 'dashboard', 'review.html'));
    if (p.startsWith('/media/')) {
      const [, , id, file] = p.split('/');
      if (!/^[a-z0-9-]+$/.test(id || '') || !/^[\w.-]+$/.test(file || '')) return res.writeHead(400).end();
      return sendFile(res, normalize(join(queue.dir(id), file)));
    }

    // Content queue + config (local only)
    if (p.startsWith('/api/content') || p === '/api/config') {
      if (!isAdmin(req)) return json(res, 401, { ok: false, error: 'unauthorized' });
      if (p === '/api/config') {
        const c = config();
        return json(res, 200, { publishing: c.publishing, workflows: c.workflows, spend: c.spend, recurringCosts: c.recurringCosts, links: c.links, spent: JSON.parse(safeRead(join(DATA, 'spend.json')) || '{}') });
      }
      if (p === '/api/content' && req.method === 'GET') return json(res, 200, queue.list());
      const m = p.match(/^\/api\/content\/([a-z0-9-]+)\/(approve|reject|published)$/);
      if (m && req.method === 'POST') {
        const b = JSON.parse((await body(req)).toString() || '{}');
        if (m[2] === 'approve') return json(res, 200, queue.setStatus(m[1], 'approved', b.note || 'approved in review UI'));
        if (m[2] === 'reject') return json(res, 200, queue.setStatus(m[1], 'rejected', b.note || 'rejected in review UI'));
        return json(res, 200, queue.markPublished(m[1], b.platform, b.url));
      }
      return json(res, 404, { ok: false });
    }

    // Everything else → the analytics Worker (identical to production)
    const buf = req.method === 'GET' || req.method === 'HEAD' ? undefined : await body(req);
    const r = await worker.fetch(new Request(url, { method: req.method, headers: req.headers, body: buf }), env);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    json(res, 500, { ok: false, error: String(e.message || e) });
  }
});

function json(res, status, data) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}
function safeRead(f) {
  try { return readFileSync(f, 'utf8'); } catch { return ''; }
}

server.listen(PORT, '127.0.0.1', () => console.log(`Growth server: http://127.0.0.1:${PORT}/dashboard  ·  review queue: /review`));

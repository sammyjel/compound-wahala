// Compound Wahala analytics API — a Cloudflare Worker backed by D1 (both have free tiers).
// The very same module runs locally under Node (growth/server.mjs) with a SQLite shim, so what
// is tested locally is what gets deployed.
//
// Public:  POST /e        {events:[...]}  ingest (no IP address or user agent is stored)
//          POST /delete   {pid}           erase everything for an anonymous id
//          GET  /health
// Admin (Authorization: Bearer $ADMIN_TOKEN):
//          GET  /api/stats?days=30        players, DAU/WAU/MAU, retention, funnel, campaigns
//          GET  /api/finance              ledger + measured vs estimated revenue / costs
//          POST /api/ledger               add a ledger row (revenue, refund, fee or cost)
//          DELETE /api/ledger?id=N
// Payments (off by default): /pay/catalog, /pay/init, /pay/verify, /pay/restore, /pay/webhook — see payments.mjs
// Env: DB (D1 binding), ADMIN_TOKEN (secret), ALLOWED_ORIGINS (comma list), RETENTION_DAYS (default 400),
//      PAYMENTS_ENABLED, PAYSTACK_SECRET_KEY, ENTITLEMENT_SECRET (secrets; payments stay off without them)

import { computeFinance, computeStats, dayOf } from './metrics.mjs';
import { handlePay } from './payments.mjs';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, day TEXT NOT NULL, pid TEXT NOT NULL, sid TEXT, e TEXT NOT NULL, p TEXT, v TEXT, src TEXT, med TEXT, cmp TEXT, ref TEXT, dev TEXT)`,
  `CREATE INDEX IF NOT EXISTS events_day ON events(day)`,
  `CREATE INDEX IF NOT EXISTS events_pid ON events(pid)`,
  `CREATE TABLE IF NOT EXISTS ledger (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, kind TEXT NOT NULL, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL, source TEXT NOT NULL, provider TEXT, note TEXT, created INTEGER)`,
];
const KINDS = new Set(['ad_revenue', 'purchase_revenue', 'refund', 'platform_fee', 'hosting', 'ai', 'marketing', 'other_cost']);
const EVENT_NAME = /^[a-z][a-z0-9_]{1,39}$/;
const ID = /^[a-f0-9]{8,64}$/;

const ready = new WeakSet();
async function ensureSchema(db) {
  if (ready.has(db)) return;
  for (const sql of SCHEMA) await db.prepare(sql).run();
  ready.add(db);
}

function cors(req, env) {
  const origin = req.headers.get('origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes('*') || allowed.includes(origin) || origin.startsWith('http://localhost') || origin === 'null';
  return {
    'access-control-allow-origin': ok ? origin || '*' : allowed[0] || 'null',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization',
    vary: 'origin',
  };
}

const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });

function isAdmin(req, env) {
  const want = env.ADMIN_TOKEN || '';
  const got = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (want.length < 16 || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}

const clip = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);

/** Validate one incoming event. Returns a clean row or null. Never trusts the client blindly. */
export function cleanEvent(x, now = Date.now()) {
  if (!x || typeof x !== 'object') return null;
  if (!EVENT_NAME.test(x.e) || !ID.test(x.pid) || (x.sid && !ID.test(x.sid))) return null;
  const t = Number(x.t);
  if (!Number.isFinite(t) || t > now + 3600000 || t < now - 7 * 86400000) return null;
  let p = {};
  if (x.p && typeof x.p === 'object') {
    for (const [k, v] of Object.entries(x.p).slice(0, 12)) {
      if (!/^[a-z_]{1,24}$/.test(k)) continue;
      if (typeof v === 'number' && Number.isFinite(v)) p[k] = v;
      else if (typeof v === 'boolean') p[k] = v;
      else if (typeof v === 'string') p[k] = v.slice(0, 120);
    }
  }
  const dev = ['phone', 'tablet', 'desktop'].includes(x.dev) ? x.dev : null;
  return { t, day: dayOf(t), pid: x.pid, sid: x.sid || null, e: x.e, p: JSON.stringify(p), v: clip(x.v, 12), src: clip(x.src, 40), med: clip(x.med, 40), cmp: clip(x.cmp, 40), ref: clip(x.ref, 60), dev };
}

async function readJson(req, max = 64000) {
  const text = await req.text();
  if (text.length > max) throw new Error('too large');
  return JSON.parse(text);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const h = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    try {
      await ensureSchema(env.DB);
      const db = env.DB;

      if (url.pathname === '/health') return json({ ok: true }, 200, h);

      const pay = await handlePay(req, env, url, json, h);
      if (pay) return pay;

      if (url.pathname === '/e' && req.method === 'POST') {
        const body = await readJson(req);
        const list = Array.isArray(body?.events) ? body.events.slice(0, 100) : [];
        const rows = list.map((x) => cleanEvent(x)).filter(Boolean);
        for (const r of rows) {
          await db.prepare('INSERT INTO events (t, day, pid, sid, e, p, v, src, med, cmp, ref, dev) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
            .bind(r.t, r.day, r.pid, r.sid, r.e, r.p, r.v, r.src, r.med, r.cmp, r.ref, r.dev).run();
        }
        // Privacy: old raw events are deleted automatically.
        if (Math.random() < 0.02) {
          const keep = Number(env.RETENTION_DAYS || 400);
          await db.prepare('DELETE FROM events WHERE t < ?').bind(Date.now() - keep * 86400000).run();
        }
        return json({ ok: true, stored: rows.length, rejected: list.length - rows.length }, 200, h);
      }

      if (url.pathname === '/delete' && req.method === 'POST') {
        const body = await readJson(req, 2000);
        if (!ID.test(body?.pid)) return json({ ok: false, error: 'bad id' }, 400, h);
        await db.prepare('DELETE FROM events WHERE pid = ?').bind(body.pid).run();
        return json({ ok: true }, 200, h);
      }

      if (url.pathname.startsWith('/api/')) {
        if (!isAdmin(req, env)) return json({ ok: false, error: 'unauthorized' }, 401, h);
        const days = Math.max(7, Math.min(90, Number(url.searchParams.get('days')) || 30));
        if (url.pathname === '/api/stats') {
          const since = dayOf(Date.now() - 120 * 86400000);
          const { results } = await db.prepare('SELECT t, day, pid, sid, e, p, src, med, cmp, ref, dev FROM events WHERE day >= ? ORDER BY t').bind(since).all();
          const rows = results.map((r) => ({ ...r, p: safeParse(r.p) }));
          return json(computeStats(rows, { days }), 200, h);
        }
        if (url.pathname === '/api/finance') {
          const { results: ledger } = await db.prepare('SELECT * FROM ledger ORDER BY date DESC, id DESC').all();
          const since = dayOf(Date.now() - 120 * 86400000);
          const { results } = await db.prepare('SELECT t, day, pid, sid, e, p, src, med, cmp, ref, dev FROM events WHERE day >= ?').bind(since).all();
          const stats = computeStats(results.map((r) => ({ ...r, p: safeParse(r.p) })), { days });
          return json({ ledger, summary: computeFinance(ledger, stats) }, 200, h);
        }
        if (url.pathname === '/api/ledger' && req.method === 'POST') {
          const b = await readJson(req, 4000);
          const amount = Math.round(Number(b.amount_cents));
          if (!KINDS.has(b.kind) || !Number.isFinite(amount) || amount < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(b.date) || !['measured', 'estimate'].includes(b.source) || !/^[A-Z]{3}$/.test(b.currency || '')) {
            return json({ ok: false, error: 'invalid ledger row' }, 400, h);
          }
          await db.prepare('INSERT INTO ledger (date, kind, amount_cents, currency, source, provider, note, created) VALUES (?,?,?,?,?,?,?,?)')
            .bind(b.date, b.kind, amount, b.currency, b.source, clip(b.provider, 40), clip(b.note, 200), Date.now()).run();
          return json({ ok: true }, 200, h);
        }
        if (url.pathname === '/api/ledger' && req.method === 'DELETE') {
          await db.prepare('DELETE FROM ledger WHERE id = ?').bind(Number(url.searchParams.get('id'))).run();
          return json({ ok: true }, 200, h);
        }
      }
      return json({ ok: false, error: 'not found' }, 404, h);
    } catch (e) {
      return json({ ok: false, error: String(e?.message || e).slice(0, 200) }, 400, h);
    }
  },
};

function safeParse(s) {
  try { return JSON.parse(s || '{}'); } catch { return {}; }
}

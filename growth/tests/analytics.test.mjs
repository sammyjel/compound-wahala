// Analytics Worker + metrics, run against an in-memory SQLite "D1". Synthetic test events only.
// Run: npm run growth:test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { cleanEvent } from '../analytics/worker.mjs';
import { computeFinance, computeStats } from '../analytics/metrics.mjs';
import { sqliteD1 } from '../analytics/sqlite-d1.mjs';

const TOKEN = 'test-admin-token-123456';
const env = () => ({ DB: sqliteD1(':memory:'), ADMIN_TOKEN: TOKEN, ALLOWED_ORIGINS: 'https://sammyjel.github.io' });
const id = (n) => n.toString(16).padStart(24, '0');
const call = (e, path, { method = 'GET', body, admin = false, origin } = {}) =>
  worker.fetch(new Request('http://x' + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { ...(admin ? { authorization: 'Bearer ' + TOKEN } : {}), ...(origin ? { origin } : {}) } }), e);

test('ingest validates events and never stores junk', async () => {
  const e = env();
  const now = Date.now();
  const good = { e: 'level_start', t: now, pid: id(1), sid: id(99), v: '2.0.0', p: { level: 1 }, dev: 'phone', src: 'tiktok' };
  const r = await call(e, '/e', { method: 'POST', body: { events: [good, { ...good, e: 'DROP TABLE' }, { ...good, pid: 'me@mail.com' }, { ...good, t: now - 30 * 86400000 }, { ...good, p: { email: 'x', level: 1, 'bad key': 2 } }] } });
  const j = await r.json();
  assert.equal(j.stored, 2);
  assert.equal(j.rejected, 3);
  assert.deepEqual(JSON.parse(cleanEvent({ ...good, p: { nested: { a: 1 }, level: 2 } }).p), { level: 2 });
});

test('admin API needs the token; CORS only echoes allowed origins', async () => {
  const e = env();
  assert.equal((await call(e, '/api/stats')).status, 401);
  assert.equal((await call(e, '/api/stats', { admin: true })).status, 200);
  const ok = await call(e, '/health', { origin: 'https://sammyjel.github.io' });
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://sammyjel.github.io');
  const bad = await call(e, '/health', { origin: 'https://evil.example' });
  assert.notEqual(bad.headers.get('access-control-allow-origin'), 'https://evil.example');
});

test('delete erases every event for an anonymous id', async () => {
  const e = env();
  const now = Date.now();
  await call(e, '/e', { method: 'POST', body: { events: [1, 2, 3].map((k) => ({ e: 'session_start', t: now - k, pid: id(7), sid: id(8), p: {} })) } });
  await call(e, '/e', { method: 'POST', body: { events: [{ e: 'session_start', t: now, pid: id(9), sid: id(8), p: {} }] } });
  assert.equal((await (await call(e, '/delete', { method: 'POST', body: { pid: id(7) } })).json()).ok, true);
  const s = await (await call(e, '/api/stats', { admin: true })).json();
  assert.equal(s.players, 1);
});

test('metrics: DAU/WAU/MAU, funnel, retention with sample sizes, campaigns', () => {
  const today = '2026-10-14';
  const at = (d, h = 12) => Date.parse(`${d}T${String(h).padStart(2, '0')}:00:00Z`);
  const ev = (pid, day, e, p = {}, extra = {}) => ({ t: at(day), day, pid, sid: pid + day, e, p, ...extra });
  const rows = [
    // A: arrives from TikTok on Oct 6, returns Oct 7 and Oct 13 (day 1 and day 7)
    ev('a', '2026-10-06', 'session_start', {}, { src: 'tiktok', cmp: 'nepa-1', dev: 'phone' }),
    ev('a', '2026-10-06', 'tutorial_start'), ev('a', '2026-10-06', 'level_start', { level: 1 }), ev('a', '2026-10-06', 'level_complete', { level: 1, stars: 3, seconds: 80 }),
    ev('a', '2026-10-06', 'tutorial_complete'),
    ev('a', '2026-10-07', 'session_start'), ev('a', '2026-10-13', 'session_start'),
    // B: direct, Oct 6, starts level 1 but never finishes, never returns
    ev('b', '2026-10-06', 'session_start', {}, { dev: 'desktop' }), ev('b', '2026-10-06', 'tutorial_start'), ev('b', '2026-10-06', 'level_start', { level: 1 }),
    // C: new today
    ev('c', today, 'session_start', {}, { src: 'youtube', dev: 'phone' }),
  ];
  const s = computeStats(rows, { today, days: 30 });
  assert.equal(s.players, 3);
  assert.equal(s.dau, 1);
  assert.equal(s.wau, 2); // a (Oct 13) + c
  assert.equal(s.mau, 3);
  assert.equal(s.newToday, 1);
  assert.equal(s.tutorial.rate, 0.5);
  assert.equal(s.levels[0].started, 2);
  assert.equal(s.levels[0].completed, 1);
  assert.equal(s.levels[0].abandonRate, 0.5);
  assert.deepEqual(s.retention.d1, { eligible: 2, retained: 1, rate: 0.5 });
  assert.deepEqual(s.retention.d7, { eligible: 2, retained: 1, rate: 0.5 });
  assert.equal(s.retention.d30.eligible, 0);
  assert.equal(s.retention.d30.rate, null);
  const tik = s.campaigns.find((c) => c.source === 'tiktok');
  assert.equal(tik.players, 1);
  assert.equal(tik.level1Done, 1);
  assert.equal(s.sessions.total, 5); // a: 3 sessions, b: 1, c: 1
});

test('finance keeps measured and estimated money apart and never invents revenue', async () => {
  const e = env();
  const bad = await call(e, '/api/ledger', { method: 'POST', admin: true, body: { date: '2026-10-14', kind: 'free_money', amount_cents: 100, currency: 'USD', source: 'measured' } });
  assert.equal(bad.status, 400);
  for (const row of [
    { date: '2026-10-10', kind: 'hosting', amount_cents: 0, currency: 'USD', source: 'measured', provider: 'GitHub Pages' },
    { date: '2026-10-11', kind: 'ad_revenue', amount_cents: 500, currency: 'USD', source: 'estimate', provider: 'guess' },
  ]) assert.equal((await call(e, '/api/ledger', { method: 'POST', admin: true, body: row })).status, 200);
  const f = await (await call(e, '/api/finance', { admin: true })).json();
  assert.equal(f.summary.measured.gross, 0);
  assert.equal(f.summary.hasMeasuredRevenue, false);
  assert.equal(f.summary.estimate.ad_revenue, 500);
  const fin = computeFinance([{ kind: 'purchase_revenue', amount_cents: 1000, currency: 'NGN', source: 'measured' }, { kind: 'refund', amount_cents: 200, currency: 'NGN', source: 'measured' }, { kind: 'platform_fee', amount_cents: 150, currency: 'NGN', source: 'measured' }], { mau: 10, store: { completed: 2 }, ads: { completed: 0 }, players: 10 });
  assert.equal(fin.measured.net, 650);
  assert.equal(fin.perActivePlayer, 100);
  assert.equal(fin.perPayingPlayer, 500);
  assert.equal(fin.adEcpm, null);
});

// Cosmetic purchases via Paystack (web), verified on the server. DISABLED unless
// PAYMENTS_ENABLED="true" AND PAYSTACK_SECRET_KEY is set (Worker secrets).
// - Prices live HERE (server), never trusted from the client.
// - A purchase counts only after Paystack's verify API says success with the exact amount/currency.
// - Webhooks are accepted only with a valid x-paystack-signature (HMAC-SHA512 of the raw body).
// - Each Paystack reference is recorded once (idempotent); refunds revoke the item.
// - Measured revenue, Paystack fees and refunds are written to the ledger automatically.
// - No card details ever touch this code (Paystack's hosted checkout handles them).

/** Cosmetic only. Nothing here affects winning. `available: false` items are not sold until the art exists. */
export const CATALOG = {
  'decor-owambe': { name: 'Owambe canopy', kind: 'decoration', amount: 50000, currency: 'NGN', available: true },   // ₦500.00 (kobo)
  'decor-naija-flags': { name: 'Green-white flags', kind: 'decoration', amount: 30000, currency: 'NGN', available: true }, // ₦300.00
  'gen-gold': { name: 'Golden generator skin', kind: 'generator-skin', amount: 50000, currency: 'NGN', available: false },
  'outfits-owambe': { name: 'Owambe outfits pack', kind: 'outfits', amount: 80000, currency: 'NGN', available: false },
  'pack-missions-2': { name: 'More compound stories (5 levels)', kind: 'mission-pack', amount: 100000, currency: 'NGN', available: false },
};

export const PAY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS purchases (reference TEXT PRIMARY KEY, sku TEXT NOT NULL, pid TEXT, amount INTEGER NOT NULL, currency TEXT NOT NULL, fees INTEGER, status TEXT NOT NULL, created INTEGER, updated INTEGER)`,
];

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hmac(alg, secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: alg }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** A signed receipt the game stores; restore works by asking the server to re-issue it. */
export async function entitlement(env, sku, reference) {
  const body = `${sku}.${reference}`;
  return `${body}.${(await hmac('SHA-256', env.ENTITLEMENT_SECRET, body)).slice(0, 32)}`;
}

const enabled = (env) => env.PAYMENTS_ENABLED === 'true' && !!env.PAYSTACK_SECRET_KEY && (env.ENTITLEMENT_SECRET || '').length >= 16;
const PAYSTACK = 'https://api.paystack.co';

async function paystack(env, path, init = {}) {
  const r = await fetch((env.PAYSTACK_API_BASE || PAYSTACK) + path, { ...init, headers: { authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'content-type': 'application/json', ...(init.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.status === false) throw new Error(`Paystack ${r.status}: ${j.message || 'error'}`);
  return j.data;
}

async function ledger(db, kind, amount, currency, note) {
  if (!amount) return;
  await db.prepare('INSERT INTO ledger (date, kind, amount_cents, currency, source, provider, note, created) VALUES (?,?,?,?,?,?,?,?)')
    .bind(new Date().toISOString().slice(0, 10), kind, amount, currency, 'measured', 'Paystack', note, Date.now()).run();
}

/** Record a verified successful charge exactly once. Returns the purchase row. */
async function recordSuccess(db, data) {
  const sku = data.metadata?.sku;
  const item = CATALOG[sku];
  if (!item) throw new Error('unknown sku in transaction');
  if (data.status !== 'success') throw new Error('payment not successful: ' + data.status);
  if (data.amount !== item.amount || data.currency !== item.currency) throw new Error('amount/currency mismatch');
  const existing = await db.prepare('SELECT * FROM purchases WHERE reference = ?').bind(data.reference).first();
  if (existing) return existing;
  await db.prepare('INSERT INTO purchases (reference, sku, pid, amount, currency, fees, status, created, updated) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(data.reference, sku, data.metadata?.pid || null, data.amount, data.currency, data.fees || 0, 'paid', Date.now(), Date.now()).run();
  await ledger(db, 'purchase_revenue', data.amount, data.currency, `${sku} ${data.reference}`);
  await ledger(db, 'platform_fee', data.fees || 0, data.currency, `Paystack fee ${data.reference}`);
  return await db.prepare('SELECT * FROM purchases WHERE reference = ?').bind(data.reference).first();
}

/** Routes under /pay/*. Returns a Response, or null when the path isn't ours. */
export async function handlePay(req, env, url, json, h) {
  if (!url.pathname.startsWith('/pay/')) return null;
  for (const sql of PAY_SCHEMA) await env.DB.prepare(sql).run();
  const db = env.DB;
  if (url.pathname === '/pay/catalog') {
    return json({ enabled: enabled(env), items: Object.entries(CATALOG).filter(([, v]) => v.available).map(([sku, v]) => ({ sku, name: v.name, kind: v.kind, amount: v.amount, currency: v.currency })) }, 200, h);
  }
  if (!enabled(env)) return json({ ok: false, error: 'payments are not enabled' }, 403, h);

  if (url.pathname === '/pay/init' && req.method === 'POST') {
    const b = JSON.parse(await req.text());
    const item = CATALOG[b.sku];
    if (!item?.available) return json({ ok: false, error: 'not for sale' }, 400, h);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email || '')) return json({ ok: false, error: 'a parent email is needed for the receipt' }, 400, h);
    const data = await paystack(env, '/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({ email: b.email, amount: item.amount, currency: item.currency, callback_url: b.callback_url, metadata: { sku: b.sku, pid: /^[a-f0-9]{8,64}$/.test(b.pid || '') ? b.pid : null } }),
    });
    return json({ ok: true, authorization_url: data.authorization_url, reference: data.reference }, 200, h);
  }

  if (url.pathname === '/pay/verify' && req.method === 'GET') {
    const ref = url.searchParams.get('reference') || '';
    if (!/^[\w-]{6,100}$/.test(ref)) return json({ ok: false, error: 'bad reference' }, 400, h);
    try {
      const data = await paystack(env, `/transaction/verify/${encodeURIComponent(ref)}`);
      const row = await recordSuccess(db, data);
      if (row.status !== 'paid') return json({ ok: false, error: 'refunded' }, 409, h);
      return json({ ok: true, sku: row.sku, receipt: await entitlement(env, row.sku, row.reference) }, 200, h);
    } catch (e) {
      return json({ ok: false, error: String(e.message).slice(0, 160) }, 402, h);
    }
  }

  if (url.pathname === '/pay/restore' && req.method === 'POST') {
    const b = JSON.parse(await req.text());
    const row = await db.prepare('SELECT * FROM purchases WHERE reference = ?').bind(String(b.reference || '')).first();
    if (!row || row.status !== 'paid') return json({ ok: false, error: 'no active purchase with that receipt code' }, 404, h);
    return json({ ok: true, sku: row.sku, receipt: await entitlement(env, row.sku, row.reference) }, 200, h);
  }

  if (url.pathname === '/pay/webhook' && req.method === 'POST') {
    const raw = await req.text();
    const sig = req.headers.get('x-paystack-signature') || '';
    if (!safeEqual(await hmac('SHA-512', env.PAYSTACK_SECRET_KEY, raw), sig)) return json({ ok: false }, 401, h);
    const ev = JSON.parse(raw);
    if (ev.event === 'charge.success') {
      // Never trust the webhook body alone: re-verify with Paystack.
      const data = await paystack(env, `/transaction/verify/${encodeURIComponent(ev.data.reference)}`);
      await recordSuccess(db, data);
    } else if (ev.event === 'refund.processed') {
      const ref = ev.data?.transaction_reference || ev.data?.transaction?.reference;
      const row = ref && (await db.prepare('SELECT * FROM purchases WHERE reference = ?').bind(ref).first());
      if (row && row.status !== 'refunded') {
        await db.prepare('UPDATE purchases SET status = ?, updated = ? WHERE reference = ?').bind('refunded', Date.now(), ref).run();
        await ledger(db, 'refund', Number(ev.data.amount) || row.amount, row.currency, `refund ${ref}`);
      }
    }
    return json({ ok: true }, 200, h);
  }
  return json({ ok: false, error: 'not found' }, 404, h);
}

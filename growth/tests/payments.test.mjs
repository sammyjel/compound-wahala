// Server-side purchase verification against a FAKE Paystack (no real money, no real account).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import worker from '../analytics/worker.mjs';
import { sqliteD1 } from '../analytics/sqlite-d1.mjs';
import { CATALOG } from '../analytics/payments.mjs';

const SECRET = 'sk_test_fake_key';
const TOKEN = 'test-admin-token-123456';
const realFetch = globalThis.fetch;
// Fake Paystack: references starting with "ok" succeed at the catalog price; "cheap" pays less.
const fake = new Map();
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (!u.startsWith('https://api.paystack.co')) return realFetch(url, init);
  assert.equal(init?.headers?.authorization, `Bearer ${SECRET}`);
  if (u.endsWith('/transaction/initialize')) {
    const b = JSON.parse(init.body);
    const ref = 'ok-' + Math.random().toString(36).slice(2, 10);
    fake.set(ref, { reference: ref, status: 'success', amount: b.amount, currency: b.currency, fees: 750, metadata: b.metadata });
    return Response.json({ status: true, data: { authorization_url: 'https://checkout.paystack.com/x', reference: ref } });
  }
  const ref = decodeURIComponent(u.split('/transaction/verify/')[1] || '');
  if (ref.startsWith('cheap')) return Response.json({ status: true, data: { reference: ref, status: 'success', amount: 100, currency: 'NGN', metadata: { sku: 'decor-owambe' } } });
  if (fake.has(ref)) return Response.json({ status: true, data: fake.get(ref) });
  return Response.json({ status: false, message: 'Transaction reference not found' }, { status: 400 });
};

const env = (on = true) => ({ DB: sqliteD1(':memory:'), ADMIN_TOKEN: TOKEN, ...(on ? { PAYMENTS_ENABLED: 'true', PAYSTACK_SECRET_KEY: SECRET, ENTITLEMENT_SECRET: 'entitlement-secret-xyz-123' } : {}) });
const call = (e, path, { method = 'GET', body, headers = {} } = {}) => worker.fetch(new Request('http://x' + path, { method, body: typeof body === 'string' ? body : body ? JSON.stringify(body) : undefined, headers }), e);
const pid = 'a'.repeat(24);

test('payments are off by default: catalog says disabled, init refuses', async () => {
  const e = env(false);
  const c = await (await call(e, '/pay/catalog')).json();
  assert.equal(c.enabled, false);
  assert.ok(c.items.every((i) => CATALOG[i.sku].available));
  assert.equal((await call(e, '/pay/init', { method: 'POST', body: { sku: 'decor-owambe', email: 'p@x.com' } })).status, 403);
});

test('init uses the server price; unavailable items and missing email are refused', async () => {
  const e = env();
  assert.equal((await call(e, '/pay/init', { method: 'POST', body: { sku: 'gen-gold', email: 'p@x.com' } })).status, 400);
  assert.equal((await call(e, '/pay/init', { method: 'POST', body: { sku: 'decor-owambe' } })).status, 400);
  const r = await (await call(e, '/pay/init', { method: 'POST', body: { sku: 'decor-owambe', email: 'parent@example.com', pid, amount: 1 } })).json();
  assert.ok(r.ok);
  assert.equal(fake.get(r.reference).amount, CATALOG['decor-owambe'].amount);
});

test('verify: one receipt per reference, ledger gets measured revenue + fee once; tampered amount rejected', async () => {
  const e = env();
  const init = await (await call(e, '/pay/init', { method: 'POST', body: { sku: 'decor-naija-flags', email: 'parent@example.com', pid } })).json();
  const v1 = await (await call(e, `/pay/verify?reference=${init.reference}`)).json();
  const v2 = await (await call(e, `/pay/verify?reference=${init.reference}`)).json();
  assert.ok(v1.ok && v2.ok);
  assert.equal(v1.receipt, v2.receipt);
  assert.equal((await call(e, '/pay/verify?reference=cheap-123')).status, 402);
  assert.equal((await call(e, '/pay/verify?reference=nope-123456')).status, 402);
  const f = await (await call(e, '/api/finance', { headers: { authorization: 'Bearer ' + TOKEN } })).json();
  assert.equal(f.summary.measured.purchase_revenue, CATALOG['decor-naija-flags'].amount);
  assert.equal(f.summary.measured.platform_fee, 750);
  assert.equal(f.ledger.length, 2);
  // restore with the receipt code
  const rs = await (await call(e, '/pay/restore', { method: 'POST', body: { reference: init.reference } })).json();
  assert.equal(rs.receipt, v1.receipt);
});

test('webhooks need a valid signature; refunds revoke the item and add a refund to the ledger', async () => {
  const e = env();
  const init = await (await call(e, '/pay/init', { method: 'POST', body: { sku: 'decor-owambe', email: 'parent@example.com', pid } })).json();
  const sign = (b) => createHmac('sha512', SECRET).update(b).digest('hex');
  const charge = JSON.stringify({ event: 'charge.success', data: { reference: init.reference } });
  assert.equal((await call(e, '/pay/webhook', { method: 'POST', body: charge, headers: { 'x-paystack-signature': 'forged' } })).status, 401);
  assert.equal((await call(e, '/pay/webhook', { method: 'POST', body: charge, headers: { 'x-paystack-signature': sign(charge) } })).status, 200);
  const refund = JSON.stringify({ event: 'refund.processed', data: { transaction_reference: init.reference, amount: CATALOG['decor-owambe'].amount } });
  await call(e, '/pay/webhook', { method: 'POST', body: refund, headers: { 'x-paystack-signature': sign(refund) } });
  await call(e, '/pay/webhook', { method: 'POST', body: refund, headers: { 'x-paystack-signature': sign(refund) } }); // duplicate delivery
  assert.equal((await call(e, '/pay/restore', { method: 'POST', body: { reference: init.reference } })).status, 404);
  const f = await (await call(e, '/api/finance', { headers: { authorization: 'Bearer ' + TOKEN } })).json();
  assert.equal(f.summary.measured.refund, CATALOG['decor-owambe'].amount, 'refund recorded once');
  assert.equal(f.summary.measured.net, -750, 'revenue − refund − fee');
});

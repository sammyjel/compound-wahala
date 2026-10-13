// Purchase flow through the real game UI against a FAKE Paystack (no money, no real account):
// shop shows premium items only when enabled → grown-up check → checkout page → back to game →
// server verifies → item owned and drawn → restore on a "new device" with the receipt code.
// Also: with payments off, no premium section and no ad button appear.
import assert from 'node:assert/strict';
import { execSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromePath, loadChromium } from '../../tests/pw.mjs';
import { DATA, ROOT } from '../lib/env.mjs';

const API_PORT = 8798, FAKE_PORT = 8797, GAME_PORT = 8796;
const OUT = join(DATA, 'game-store-test');
const DB = join(DATA, 'store-test.sqlite');
rmSync(DB, { force: true });
let ok = 0, fail = 0;
const check = async (name, fn) => { try { await fn(); ok++; console.log('  ✔', name); } catch (e) { fail++; console.log('  ✖', name, '\n     ', e.message.split('\n').filter((l) => !/retrying|waiting \d/.test(l)).slice(0, 6).join(' | ')); } };

// Fake Paystack: initialize → hosted page that "pays" and redirects back with ?reference=
const tx = new Map();
const fake = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (o) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/transaction/initialize') {
    let b = ''; for await (const c of req) b += c;
    const j = JSON.parse(b);
    const ref = 'T' + Date.now();
    tx.set(ref, { reference: ref, status: 'success', amount: j.amount, currency: j.currency, fees: 750, metadata: j.metadata, callback: j.callback_url });
    return send({ status: true, data: { authorization_url: `http://127.0.0.1:${FAKE_PORT}/checkout/${ref}`, reference: ref } });
  }
  if (u.pathname.startsWith('/checkout/')) {
    const t = tx.get(u.pathname.split('/')[2]);
    res.writeHead(302, { location: `${t.callback}?reference=${t.reference}` });
    return res.end();
  }
  if (u.pathname.startsWith('/transaction/verify/')) return send({ status: true, data: tx.get(u.pathname.split('/')[3]) });
  res.writeHead(404).end();
});
fake.listen(FAKE_PORT, '127.0.0.1');

// Serve the built game over http (Paystack redirects need a real URL)
const { createReadStream } = await import('node:fs');
const game = createServer((req, res) => {
  const f = join(OUT, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : f.endsWith('.webp') ? 'image/webp' : 'application/octet-stream' });
  createReadStream(f).on('error', () => res.end()).pipe(res);
});
game.listen(GAME_PORT, '127.0.0.1');

execSync(`npx vite build --outDir "${OUT}" --emptyOutDir`, { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_ANALYTICS_URL: `http://127.0.0.1:${API_PORT}`, VITE_PAYMENTS: 'on' } });
const srv = spawn(process.execPath, [join(ROOT, 'growth', 'server.mjs')], {
  env: { ...process.env, GROWTH_PORT: String(API_PORT), ADMIN_TOKEN: 'store-test-token-0123456789', ANALYTICS_DB: DB, PAYMENTS_ENABLED: 'true', PAYSTACK_SECRET_KEY: 'sk_test_fake', ENTITLEMENT_SECRET: 'entitlement-secret-for-tests', PAYSTACK_API_BASE: `http://127.0.0.1:${FAKE_PORT}` },
  stdio: 'ignore',
});

try {
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${API_PORT}/health`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const chromium = await loadChromium();
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const seed = () => { localStorage.setItem('compoundWahala.consent.v1', 'no'); if (!localStorage.getItem('compoundWahala.story.v1')) localStorage.setItem('compoundWahala.story.v1', JSON.stringify({ v: 1, stars: [3, 0, 0, 0, 0], coins: 10, owned: [], look: 0 })); };

  await check('payments OFF build: no premium section, no ad button', async () => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(seed);
    const p = await ctx.newPage();
    await p.goto(pathToFileURL(join(ROOT, 'dist', 'index.html')).href);
    await p.click('#btn-levels');
    await p.click('#btn-shop');
    await p.waitForTimeout(800);
    assert.equal(await p.locator('.premium-h').count(), 0);
    assert.equal(await p.locator('#btn-ad').count(), 0);
    await ctx.close();
  });

  let receipt;
  await check('grown-up gate blocks a wrong answer, then checkout → verify → item owned', async () => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(seed);
    const p = await ctx.newPage();
    p.on('dialog', (d) => d.accept());
    await p.goto(`http://127.0.0.1:${GAME_PORT}/`);
    await p.click('#btn-levels');
    await p.click('#btn-shop');
    await p.waitForSelector('.premium-h');
    await p.click('.premium .shop-item:has-text("Owambe canopy") button');
    await p.fill('.gate-input[type=number]', '1');
    await p.fill('.gate-input[type=email]', 'parent@example.com');
    await p.click('.modal:has(.gate-input) .choice.primary');
    assert.ok(await p.isVisible('.gate-input[type=number]'), 'wrong answer keeps the gate open');
    const q = await p.textContent('.modal:has(.gate-input) .modal-body p');
    const [x, y] = q.match(/(\d+) × (\d+)/).slice(1).map(Number);
    await p.fill('.gate-input[type=number]', String(x * y));
    await p.click('.modal:has(.gate-input) .choice.primary');
    await p.waitForURL(/127\.0\.0\.1:8796\/(\?|$)/, { timeout: 15000 });
    await p.waitForFunction(() => !!JSON.parse(localStorage.getItem('compoundWahala.receipts.v1') || '{}')['decor-owambe'], null, { timeout: 15000 });
    receipt = [...tx.keys()][0];
    await ctx.close();
  });

  await check('restore on a new device with the receipt code', async () => {
    const ctx = await browser.newContext();
    await ctx.addInitScript(seed);
    const p = await ctx.newPage();
    p.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(receipt) : d.accept()));
    await p.goto(`http://127.0.0.1:${GAME_PORT}/`);
    await p.click('#btn-levels');
    await p.click('#btn-shop');
    await p.waitForSelector('.premium-h');
    await p.click('text=Restore a purchase');
    await p.waitForFunction(() => !!JSON.parse(localStorage.getItem('compoundWahala.receipts.v1') || '{}')['decor-owambe'], null, { timeout: 15000 });
    await ctx.close();
  });

  await check('measured revenue and Paystack fee reached the ledger', async () => {
    const f = await (await fetch(`http://127.0.0.1:${API_PORT}/api/finance`, { headers: { authorization: 'Bearer store-test-token-0123456789' } })).json();
    assert.equal(f.summary.measured.purchase_revenue, 50000);
    assert.equal(f.summary.measured.platform_fee, 750);
  });
  await browser.close();
} finally {
  srv.kill(); fake.close(); game.close();
}
console.log(`\n${ok}/${ok + fail} store checks passed`);
process.exit(fail ? 1 : 0);

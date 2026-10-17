// Plays the CrazyGames portal build on localhost, where the real CrazyGames SDK runs in "local" mode
// (demo ad overlays). Checks: SDK starts, no links off the portal, no statistics prompt, gameplay events,
// midgame ad between levels and the game continues afterwards, rewarded coins only after the ad.
// Usage: node scripts/portal-build.mjs crazygames && node tests/portal.mjs
import assert from 'node:assert/strict';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromePath, loadChromium } from './pw.mjs';

const DIR = resolve(fileURLToPath(import.meta.url), '../../dist-portal/crazygames');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webp': 'image/webp', '.png': 'image/png', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  const p = join(DIR, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = existsSync(p) && statSync(p).isDirectory() ? join(p, 'index.html') : p;
  if (!f.startsWith(DIR) || !existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' });
  createReadStream(f).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const URL0 = `http://localhost:${server.address().port}/`;

const chromium = await loadChromium();
const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(45000);
const logs = [];
page.on('console', (m) => logs.push(m.text()));
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
let pass = 0;
const check = async (name, fn) => { await fn(); pass++; console.log('  ✔', name); };

async function finishLevel() {
  for (let i = 0; i < 400; i++) {
    if (await page.locator('#s-card:not([hidden]) #btn-next').count()) return;
    const quick = { timeout: 1500 };
    if (await page.locator('#s-banner:not([hidden])').count()) { await page.click('#s-banner', quick).catch(() => {}); continue; }
    const btn = page.locator('#s-actions .act:not([disabled])');
    if (await btn.count()) {
      const hinted = page.locator('#s-actions .act.hint:not([disabled])');
      const fresh = page.locator('#s-actions .act:not(.tried):not([disabled])');
      await ((await hinted.count()) ? hinted.first() : (await fresh.count()) ? fresh.first() : btn.first()).click(quick).catch(() => {});
      await page.waitForTimeout(60);
      continue;
    }
    if (await page.locator('#s-say:not(:empty)').count()) await page.click('#s-say', quick).catch(() => {});
    await page.waitForTimeout(80);
  }
  throw new Error('level did not finish');
}

try {
  await check('CrazyGames SDK loads and runs in local mode', async () => {
    await page.goto(URL0);
    await page.waitForSelector('#btn-play');
    await page.waitForFunction(() => window.CrazyGames?.SDK?.environment === 'local', null, { timeout: 60000 });
    // Spy on the SDK's gameplay calls (it does not log them).
    await page.evaluate(() => {
      // SDK.game is a getter returning a fresh object each time, so wrap the getter itself.
      const sdk = window.CrazyGames.SDK;
      const real = Object.getOwnPropertyDescriptor(sdk, 'game') ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(sdk), 'game');
      window.__gp = [];
      Object.defineProperty(sdk, 'game', { configurable: true, get() {
        const g = real.get ? real.get.call(sdk) : real.value;
        for (const k of ['gameplayStart', 'gameplayStop']) { const f = g[k].bind(g); g[k] = () => { window.__gp.push(k); return f(); }; }
        return g;
      } });
    });
  });

  await check('no statistics prompt and no links that leave the portal', async () => {
    assert.equal(await page.locator('.consent-bar').count(), 0);
    assert.equal(await page.locator('#screen-title a[href]').count(), 0);
    await page.click('#btn-settings');
    assert.equal(await page.locator('#btn-delete-data').count(), 0);
    await page.click('.modal .choice.primary');
  });

  await check('level 1 plays to the end', async () => {
    await page.click('#btn-play');
    await page.evaluate(() => { window.__cw.story.speed = 0.15; });
    await finishLevel();
  });

  await check('optional rewarded ad grants +20 coins only after the ad', async () => {
    const btn = page.locator('#btn-ad');
    assert.equal(await btn.count(), 1, 'rewarded button shown after a level');
    const before = await page.evaluate(() => window.__cw.story.p.coins);
    await btn.click();
    await page.waitForFunction(() => /\+20 coins|No reward/.test(document.querySelector('#btn-ad')?.textContent ?? ''), null, { timeout: 60000 });
    const after = await page.evaluate(() => window.__cw.story.p.coins);
    const text = await btn.textContent();
    assert.equal(after - before, /\+20 coins/.test(text) ? 20 : 0, `coins ${before} -> ${after}, button "${text}"`);
    console.log(`      button now: "${text}"`);
  });

  await check('NEXT LEVEL asks for a midgame ad, then level 2 starts', async () => {
    await page.click('#btn-next');
    await page.waitForFunction(() => /Level 2/.test(document.querySelector('#s-level')?.textContent ?? ''), null, { timeout: 60000 });
    assert.ok(logs.some((l) => /midgame/i.test(l)), 'SDK logged a midgame request');
  });

  await check('gameplayStart / gameplayStop were reported to the SDK', async () => {
    const g = await page.evaluate(() => window.__gp);
    console.log(`      calls: ${g.join(' → ')}`);
    assert.deepEqual(g.slice(0, 4), ['gameplayStart', 'gameplayStop', 'gameplayStart', 'gameplayStop'].slice(0, Math.min(4, g.length)));
    assert.ok(g.length >= 3, 'start (L1) → stop (level done) → start (L2)');
    for (let i = 1; i < g.length; i++) assert.notEqual(g[i], g[i - 1], 'never two starts or two stops in a row');
  });

  assert.deepEqual(errors, [], 'no page errors');
  console.log(`\n${pass}/6 portal checks passed`);
  console.log('SDK log sample:', logs.filter((l) => /crazy|ad|gameplay/i.test(l)).slice(0, 8).join(' | '));
} finally {
  await browser.close();
  server.close();
}

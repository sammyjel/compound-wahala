// Full path test: game (built with an analytics URL) → consent → play → events reach the
// local analytics server → /api/stats counts them → "delete my data" erases them.
// Also checks that saying "No thanks" sends nothing.  Run: npm run growth:integration
import assert from 'node:assert/strict';
import { execSync, spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromePath, loadChromium } from '../../tests/pw.mjs';
import { DATA, ROOT } from '../lib/env.mjs';

const PORT = 8799;
const TOKEN = 'integration-token-0123456789';
const OUT = join(DATA, 'game-test');
const DB = join(DATA, 'integration.sqlite');
rmSync(DB, { force: true });

console.log('building game with VITE_ANALYTICS_URL …');
execSync(`npx vite build --outDir "${OUT}" --emptyOutDir`, { cwd: ROOT, stdio: 'ignore', env: { ...process.env, VITE_ANALYTICS_URL: `http://127.0.0.1:${PORT}` } });

const srv = spawn(process.execPath, [join(ROOT, 'growth', 'server.mjs')], { env: { ...process.env, GROWTH_PORT: String(PORT), ADMIN_TOKEN: TOKEN, ANALYTICS_DB: DB }, stdio: 'ignore' });
const stats = async () => (await fetch(`http://127.0.0.1:${PORT}/api/stats`, { headers: { authorization: 'Bearer ' + TOKEN } })).json();
let ok = 0, fail = 0;
const check = async (name, fn) => {
  try { await fn(); ok++; console.log('  ✔', name); } catch (e) { fail++; console.log('  ✖', name, '\n     ', e.message.split('\n')[0]); }
};

try {
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/health`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const chromium = await loadChromium();
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const url = pathToFileURL(join(OUT, 'index.html')).href + '?utm_source=tiktok&utm_medium=video&utm_campaign=nepa-test';

  await check('declining sends nothing', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(url);
    await page.click('#consent-no');
    await page.click('#btn-play');
    await page.waitForTimeout(5000);
    await ctx.close();
    await new Promise((r) => setTimeout(r, 500));
    assert.equal((await stats()).players, 0);
  });

  let pid;
  await check('consenting player: session, tutorial, level 1 and campaign are counted', async () => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(url);
    await page.click('#consent-yes');
    await page.evaluate(() => { window.__cw.story.speed = 0.15; });
    await page.click('#btn-play');
    for (let i = 0; i < 300 && !(await page.locator('#s-card:not([hidden]) #btn-next').count()); i++) {
      const b = page.locator('#s-actions .act.hint:not([disabled]), #s-actions .act:not(.tried):not([disabled])');
      if (await b.count()) await b.first().click({ timeout: 1500 }).catch(() => {});
      else if (await page.locator('#s-banner:not([hidden])').count()) await page.click('#s-banner', { timeout: 1500 }).catch(() => {});
      else await page.click('#s-say', { timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(60);
    }
    pid = await page.evaluate(() => localStorage.getItem('compoundWahala.pid.v1'));
    await page.close(); // pagehide → sendBeacon flush
    await ctx.close();
    await new Promise((r) => setTimeout(r, 1500));
    const s = await stats();
    assert.equal(s.players, 1, 'one player');
    assert.equal(s.tutorial.completed, 1, 'tutorial complete');
    assert.equal(s.levels[0].completed, 1, 'level 1 complete');
    assert.equal(s.campaigns[0].source, 'tiktok');
    assert.equal(s.campaigns[0].campaign, 'nepa-test');
    assert.ok(s.sessions.total >= 1);
  });

  await check('"delete my data" erases the player on the server', async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/delete`, { method: 'POST', body: JSON.stringify({ pid }) });
    assert.equal(r.status, 200);
    assert.equal((await stats()).players, 0);
  });
  await browser.close();
} finally {
  srv.kill();
}
console.log(`\n${ok}/${ok + fail} integration checks passed`);
process.exit(fail ? 1 : 0);

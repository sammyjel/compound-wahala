// Live check: the deployed game sends opt-in events to the Cloudflare Worker, and "Delete my data" removes them.
// Usage: node tests/live-analytics.mjs   (reads ADMIN_TOKEN from growth/.env; cleans up after itself)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromePath, loadChromium } from './pw.mjs';

const GAME = process.env.GAME_URL || 'https://sammyjel.github.io/compound-wahala/';
const WORKER = process.env.WORKER_URL || 'https://compound-wahala-analytics.sammyjel.workers.dev';
const TOKEN = readFileSync(new URL('../growth/.env', import.meta.url), 'utf8').match(/^ADMIN_TOKEN=(\S+)/m)?.[1];
assert.ok(TOKEN, 'ADMIN_TOKEN missing in growth/.env');

const stats = async () => (await (await fetch(`${WORKER}/api/stats`, { headers: { authorization: `Bearer ${TOKEN}` } })).json());
const before = (await stats()).players;

const chromium = await loadChromium();
const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const sent = [];
page.on('request', (r) => { if (r.url().startsWith(WORKER)) sent.push(r.url().replace(WORKER, '')); });
try {
  await page.goto(GAME, { timeout: 300000, waitUntil: 'load' });
  await page.click('#consent-yes', { timeout: 120000 });
  await page.click('#btn-play', { timeout: 30000 });
  await page.waitForTimeout(4000);
  // Leaving the page flushes queued events (sendBeacon on pagehide).
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(3000);
  const pid = await page.evaluate(() => localStorage.getItem('compoundWahala.pid.v1'));
  assert.ok(sent.some((u) => u.startsWith('/e')), `no events sent to the Worker (saw: ${sent.join(', ') || 'nothing'})`);
  let after = before;
  for (let i = 0; i < 10 && after <= before; i++) { await new Promise((r) => setTimeout(r, 1500)); after = (await stats()).players; }
  assert.ok(after > before, `Worker did not record the player (before ${before}, after ${after})`);
  console.log(`ok - live game sent events; players ${before} -> ${after} (test pid ${pid})`);
  // Clean up through the same endpoint the in-game "Delete my statistics data" button uses.
  const del = await fetch(`${WORKER}/delete`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ pid }) });
  assert.equal(del.status, 200);
  const end = (await stats()).players;
  assert.equal(end, before, `cleanup failed: ${end} players left (expected ${before})`);
  console.log(`ok - test data deleted; players back to ${end}`);
} finally {
  await browser.close();
}

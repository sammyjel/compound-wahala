// Visual smoke check: screenshots of key screens at desktop and phone sizes.
// Usage: node tests/shots.mjs [outDir]
import { mkdirSync } from 'node:fs';
import { chromePath, GAME_URL, loadChromium } from './pw.mjs';

const out = process.argv[2] ?? 'tests/screens';
mkdirSync(out, { recursive: true });
const chromium = await loadChromium();
const browser = await chromium.launch({ executablePath: chromePath(), headless: true });

async function run(name, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(GAME_URL);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${out}/${name}-1-title.png` });
  await page.click('#btn-new');
  await page.fill('#name-input', 'Ada');
  await page.click('.modal .choice.primary');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}-2-arrival.png` });
  await page.click('.modal .choice[data-key="1"]');
  await page.click('.modal .choice.primary');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/${name}-3-tutorial.png` });
  for (let i = 0; i < 6; i++) await page.click('.coach-modal .choice.primary');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}-4-compound.png` });
  console.log(name, 'errors:', errors.length ? errors : 'none');
  await ctx.close();
}

await run('desktop', { width: 1366, height: 768 });
await run('phone', { width: 390, height: 844 });
await browser.close();

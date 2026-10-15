// Captures real gameplay stills at 1200x630 (the social-preview size) for the SEO pages:
// title, level map and one mid-level moment per level → public/media/og/*.jpg
// Usage: npm run build && npm run seo:shots   (re-run only when the levels or art change)
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromePath, GAME_URL, loadChromium } from '../tests/pw.mjs';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const OUT = join(ROOT, 'public', 'media', 'og');
const TMP = join(ROOT, 'seo', '.shots');
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const chromium = await loadChromium();
const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
page.setDefaultTimeout(30000);

async function save(name) {
  const png = join(TMP, `${name}.png`);
  await page.screenshot({ path: png });
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', png, '-q:v', '3', join(OUT, `${name}.jpg`)]);
  console.log('saved', `public/media/og/${name}.jpg`);
}

/** Same "curious kid" driver as tests/story.mjs; saves a still after the `at`-th button press. */
async function playLevel(n, at) {
  let presses = 0, saved = false;
  for (let i = 0; i < 400; i++) {
    if (await page.locator('#s-card:not([hidden]) #btn-next').count()) return;
    const quick = { timeout: 1500 };
    if (await page.locator('#s-banner:not([hidden])').count()) { await page.click('#s-banner', quick).catch(() => {}); continue; }
    const btn = page.locator('#s-actions .act:not([disabled])');
    if (await btn.count()) {
      if (!saved && presses === at) {
        await page.waitForTimeout(700); // let the scene settle so the still is not mid-tween
        await save(`level-${n}`);
        saved = true;
      }
      const hinted = page.locator('#s-actions .act.hint:not([disabled])');
      const fresh = page.locator('#s-actions .act:not(.tried):not([disabled])');
      const target = (await hinted.count()) ? hinted.first() : (await fresh.count()) ? fresh.first() : btn.first();
      await target.click(quick).catch(() => {});
      presses++;
      await page.waitForTimeout(60);
      continue;
    }
    if (await page.locator('#s-say:not(:empty)').count()) await page.click('#s-say', quick).catch(() => {});
    await page.waitForTimeout(80);
  }
  throw new Error(`level ${n} did not finish`);
}

try {
  await page.goto(GAME_URL);
  await page.waitForSelector('#btn-play');
  await page.click('#consent-no');
  await page.waitForTimeout(500);
  await save('title');
  await page.click('#btn-play');
  // Which button press makes the best still differs per level (a choice on screen, not a transition).
  const AT = [0, 1, 1, 1, 1];
  for (let n = 1; n <= 5; n++) {
    if (n > 1) await page.click('#btn-next');
    await page.evaluate(() => { window.__cw.story.speed = 0.4; });
    await playLevel(n, AT[n - 1]);
  }
  await page.click('#btn-next');
  await page.waitForSelector('#screen-levels:not([hidden]) .lvl');
  await page.waitForTimeout(500);
  await save('map');
} finally {
  await browser.close();
  rmSync(TMP, { recursive: true, force: true });
}

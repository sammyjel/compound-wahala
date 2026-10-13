// Story Mode end-to-end: plays all 5 levels through the real UI like a first-time player would —
// including wrong guesses — on a desktop and a phone viewport.
// Usage: npm run build && npm run e2e:story   (SHOTS=1 saves screenshots to tests/screens/)
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromePath, GAME_URL, loadChromium } from './pw.mjs';

const SHOTS = !!process.env.SHOTS;
if (SHOTS) mkdirSync(new URL('./screens/', import.meta.url), { recursive: true });
const shot = (page, name) => (SHOTS ? page.screenshot({ path: new URL(`./screens/story-${name}.png`, import.meta.url).pathname.replace(/^\/(\w:)/, '$1') }) : null);

const chromium = await loadChromium();
const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
const TIMEOUT = GAME_URL.startsWith('http') ? 90000 : 15000;
const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push(['PASS', name]);
    console.log('  ✔', name);
  } catch (e) {
    results.push(['FAIL', name, e.message]);
    console.log('  ✖', name, '\n     ', e.message.split('\n')[0]);
  }
};

/** Act like a curious kid: skip talk, press a hinted button if there is one, otherwise the first untried one. */
async function playLevel(page, label, maxSteps = 400) {
  let wrongPicks = 0;
  for (let i = 0; i < maxSteps; i++) {
    if (await page.locator('#s-card:not([hidden]) #btn-next').count()) return wrongPicks;
    // Talk and banners auto-advance, so they can vanish between the check and the click: never wait long.
    const quick = { timeout: 1500 };
    if (await page.locator('#s-banner:not([hidden])').count()) { await page.click('#s-banner', quick).catch(() => {}); continue; }
    const btn = page.locator('#s-actions .act:not([disabled])');
    if (await btn.count()) {
      const hinted = page.locator('#s-actions .act.hint:not([disabled])');
      const fresh = page.locator('#s-actions .act:not(.tried):not([disabled])');
      const target = (await hinted.count()) ? hinted.first() : (await fresh.count()) ? fresh.first() : btn.first();
      if (!(await target.evaluate((b) => b.classList.contains('primary') || b.classList.contains('hint') || b.classList.contains('chip')))) wrongPicks++;
      await target.click(quick).catch(() => {});
      await page.waitForTimeout(60);
      continue;
    }
    if (await page.locator('#s-say:not(:empty)').count()) await page.click('#s-say', quick).catch(() => {});
    await page.waitForTimeout(80);
  }
  throw new Error(`${label}: level did not finish`);
}

for (const [tag, viewport, touch] of [['desktop', { width: 1366, height: 768 }, false], ['phone', { width: 390, height: 844 }, true]]) {
  const ctx = await browser.newContext({ viewport, hasTouch: touch });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.setDefaultTimeout(TIMEOUT);
  page.setDefaultNavigationTimeout(TIMEOUT);

  await check(`[${tag}] title shows one big PLAY button and a privacy choice`, async () => {
    await page.goto(GAME_URL);
    await page.waitForSelector('#btn-play');
    assert.ok(await page.isVisible('#consent-yes'));
    await shot(page, `${tag}-title`);
    await page.click('#consent-no');
    assert.equal(await page.evaluate(() => localStorage.getItem('compoundWahala.consent.v1')), 'no');
  });

  await check(`[${tag}] PLAY starts Level 1 straight away; first choice in about 10s even without skipping`, async () => {
    await page.evaluate(() => { window.__cw.story.speed = 1; });
    const t0 = Date.now();
    await page.click('#btn-play');
    await page.waitForSelector('#s-actions .act', { timeout: 30000 });
    const secs = (Date.now() - t0) / 1000;
    console.log(`      first choice after ${secs.toFixed(1)}s with no skipping`);
    assert.ok(secs < 13, 'intro too long');
    assert.match(await page.textContent('#s-level'), /Level 1/);
    assert.equal(await page.locator('#s-actions .act').count(), 3);
    await shot(page, `${tag}-l1-choice`);
  });

  await check(`[${tag}] a wrong answer gets a funny reply, no penalty, and a hint`, async () => {
    const coins = await page.evaluate(() => window.__cw.story.p.coins);
    await page.click('#s-actions .act >> nth=1'); // START GENERATOR before fuel
    await page.waitForSelector('#s-actions .act.hint:not([disabled])');
    assert.match(await page.textContent('#s-actions .act.hint'), /FIND FUEL/);
    assert.equal(await page.evaluate(() => window.__cw.story.p.coins), coins);
  });

  await check(`[${tag}] tapping the highlighted kiosk in the picture also works`, async () => {
    const box = await page.evaluate(() => {
      const st = window.__cw.story;
      const s = st.scene.toScreen(304, 420);
      const r = document.querySelector('#s-scene').getBoundingClientRect();
      return { x: r.left + s.x, y: r.top + s.y };
    });
    await page.mouse.click(box.x, box.y);
    await page.waitForFunction(() => window.__cw.story.p.coins > 0, null, { timeout: 30000 });
  });

  for (let lvl = 1; lvl <= 5; lvl++) {
    await check(`[${tag}] level ${lvl} can be finished by a first-time player`, async () => {
      if (lvl > 1) await page.click('#btn-next');
      await page.evaluate(() => { window.__cw.story.speed = 0.15; });
      await playLevel(page, `level ${lvl}`);
      const p = await page.evaluate(() => window.__cw.story.p);
      assert.ok(p.stars[lvl - 1] >= 1, 'stars recorded');
      await shot(page, `${tag}-l${lvl}-complete`);
    });
  }

  await check(`[${tag}] progress saved: 5 levels, coins, Full Week unlocked`, async () => {
    const p = await page.evaluate(() => JSON.parse(localStorage.getItem('compoundWahala.story.v1')));
    assert.ok(p.stars.every((s) => s >= 1));
    assert.ok(p.coins > 150, `coins ${p.coins}`);
    await page.click('#btn-next'); // "All levels" on the last card
    await page.waitForSelector('#screen-levels:not([hidden]) .lvl');
    assert.match(await page.textContent('#btn-week'), /Full Week mode/);
    assert.ok(!(await page.textContent('#btn-week')).includes('🔒'));
    await shot(page, `${tag}-map`);
  });

  await check(`[${tag}] decorations can be bought with game coins and show up`, async () => {
    await page.click('#btn-shop');
    const before = await page.evaluate(() => window.__cw.story.p.coins);
    await page.click('.shop-item button.primary >> nth=0');
    const p = await page.evaluate(() => window.__cw.story.p);
    assert.equal(p.owned.length, 1);
    assert.ok(p.coins < before);
    await page.click('.modal .choice.primary');
  });

  await check(`[${tag}] replay a level from the map, pause and quit to title`, async () => {
    await page.click('.lvl >> nth=0');
    await page.waitForSelector('#screen-story:not([hidden])');
    await page.click('#s-menu');
    await page.getByRole('button', { name: /Title screen/ }).click();
    await page.waitForSelector('#btn-play');
    assert.ok(await page.isHidden('#screen-story'));
  });

  await check(`[${tag}] Full Week mode still starts from the level map`, async () => {
    await page.click('#btn-levels');
    await page.click('#btn-week');
    await page.click('#btn-new');
    await page.click('.modal .choice.primary'); // Move in!
    await page.waitForSelector('#screen-game:not([hidden])');
    assert.equal(await page.evaluate(() => window.__cw.app.game.s.day), 1);
  });

  await check(`[${tag}] no console errors`, async () => {
    assert.deepEqual(errors, []);
  });
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} story checks passed`);
process.exit(failed.length ? 1 : 0);

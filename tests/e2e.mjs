// End-to-end test: plays the built game in headless Chrome through the real UI.
// Usage: npm run build && npm run e2e
import assert from 'node:assert/strict';
import { chromePath, GAME_URL, loadChromium } from './pw.mjs';

const chromium = await loadChromium();
const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
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

const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.setDefaultTimeout(8000);

const S = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__cw.app.game?.s ?? null)));
const modalVisible = () => page.locator('.modal-backdrop').count().then((n) => n > 0);

/** Resolve whatever event modals are open by picking the first allowed choice. */
async function drainEvents(max = 10) {
  for (let i = 0; i < max; i++) {
    await page.waitForTimeout(120);
    if (!(await modalVisible())) return;
    if (await page.locator('.meeting-modal, .summary-modal, .coach-modal').count()) return;
    const first = page.locator('.modal .choice:not([disabled])').first();
    await first.click();
    await page.waitForTimeout(80);
    const cont = page.getByRole('button', { name: 'Continue' });
    if (await cont.count()) await cont.first().click();
  }
}

await check('title screen loads with New Game', async () => {
  await page.goto(GAME_URL);
  await page.waitForSelector('#btn-new');
  assert.ok(await page.isVisible('.logo'));
});

await check('new game: name entry, arrival event, keyboard choice', async () => {
  await page.click('#btn-new');
  await page.fill('#name-input', 'Testy');
  await page.click('.modal .choice.primary');
  await page.waitForSelector('.event-modal');
  assert.match(await page.textContent('.event-modal .modal-title'), /Welcome to Unity Compound/);
  await page.keyboard.press('1'); // keyboard shortcut picks choice 1
  await page.getByRole('button', { name: 'Continue' }).click();
  const s = await S();
  assert.equal(s.playerName, 'Testy');
  assert.equal(s.day, 1);
});

await check('tutorial shows 6 steps and can be completed', async () => {
  await page.waitForSelector('.coach-modal');
  for (let i = 1; i <= 6; i++) {
    assert.match(await page.textContent('.coach-modal .modal-title'), new RegExp(`\\(${i}/6\\)`));
    await page.click('.coach-modal .choice.primary');
  }
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.coach-modal').count(), 0);
  assert.equal((await S()).tutorialDone, true);
});

await check('talk to Aunty Kemi via the residents bar: dialogue choice changes trust', async () => {
  const before = (await S()).trust.kemi;
  await page.click('.res[aria-label^="Aunty Kemi"]');
  await page.waitForSelector('#panel .choice:has-text("Introduce yourself")');
  await page.click('#panel .choice:has-text("Introduce yourself")');
  await page.click('#panel .choice[data-key="1"]');
  const s = await S();
  assert.ok(s.flags.met_kemi, 'met flag set');
  assert.ok(s.trust.kemi > before, `trust ${before} -> ${s.trust.kemi}`);
  assert.ok(await page.isVisible('#panel .line.you'));
});

await check('greet the other present residents (Chief, Amaka, Iya Bisi, Tobi)', async () => {
  for (const name of ['Chief', 'Nurse Amaka', 'Iya Bisi', 'Tobi']) {
    await drainEvents();
    await page.click(`.res[aria-label^="${name}"]`);
    const intro = page.locator('#panel .choice:has-text("Introduce yourself")');
    await intro.waitFor();
    await intro.click();
    await drainEvents(); // a timed event (e.g. the 9am power cut) may interrupt the chat
    await page.click('#panel .choice[data-key="1"]');
  }
  const s = await S();
  assert.ok(s.flags.met_chief && s.flags.met_amaka && s.flags.met_bisi && s.flags.met_tobi);
});

await check('power cut event fires, buy fuel, start generator → mission complete', async () => {
  await drainEvents();
  let s = await S();
  if (s.hour < 9) {
    await page.click('.place:has-text("Chairs")');
    await page.click('#panel .choice:has-text("Sit and relax")');
    await drainEvents();
  }
  s = await S();
  assert.ok(s.seenEvents.includes('nepa_cut'), 'nepa_cut seen at ' + s.hour);
  await page.click('.place:has-text("Kiosk")');
  await page.click('#panel .choice:has-text("Buy 3L fuel")');
  await drainEvents();
  await page.click('.place:has-text("Generator")');
  await page.click('#panel .choice:has-text("Start the generator")');
  await drainEvents();
  s = await S();
  assert.equal(s.missions.m_light, 'done');
  assert.ok(s.power.genOn || s.stats.fuel >= 0);
});

await check('phone repair job earns cash and advances time', async () => {
  const before = await S();
  await page.click('.place:has-text("Your room")');
  await page.click('#panel .choice:has-text("Do phone repairs")');
  await drainEvents();
  const after = await S();
  assert.ok(after.earnedTotal > before.earnedTotal);
  assert.ok(after.hour >= before.hour + 3);
});

await check('NEPA bill: pay own share from the Bills panel', async () => {
  await drainEvents();
  let s = await S();
  if (!s.bills.find((b) => b.id === 'nepa')) {
    await page.click('.place:has-text("Chairs")');
    await page.click('#panel .choice:has-text("Sit and relax")');
    await drainEvents();
  }
  await page.click('#btn-bills');
  const pay = page.locator('#panel .mini.primary:has-text("Pay")');
  if (await pay.count()) await pay.first().click();
  s = await S();
  assert.equal(s.bills.find((b) => b.id === 'nepa').paid.you, true);
});

await check('compound meeting: support, persuade, vote reveal, outcome applied', async () => {
  await drainEvents();
  await page.click('#btn-sleep');
  await page.getByRole('button', { name: 'Go to the meeting' }).click();
  for (let i = 0; i < 6 && !(await page.locator('.meeting-modal').count()); i++) await drainEvents(1);
  await page.waitForSelector('.meeting-modal');
  await page.getByRole('button', { name: 'Hear the motion' }).click();
  await page.click('.meeting-modal .choice:has-text("Support the motion")');
  await page.waitForSelector('.rgrid .rcard');
  assert.equal(await page.locator('.rgrid .rcard').count(), 6);
  const movesBefore = Number(await page.textContent('.moves b'));
  await page.locator('.rcard:has-text("Aunty Kemi") button:has-text("Persuade")').click();
  await page.locator('.rcard:has-text("Aunty Kemi") .arg').first().click();
  assert.equal(Number(await page.textContent('.moves b')), movesBefore - 1);
  await page.locator('.rcard').first().locator('summary').click(); // "Why?" breakdown opens
  assert.ok((await page.locator('.rcard .why li').count()) > 0);
  await page.getByRole('button', { name: /Call the vote/ }).click();
  await page.waitForSelector('.banner', { timeout: 10000 });
  assert.equal(await page.locator('.vchip').count(), 7);
  await page.getByRole('button', { name: 'Continue' }).click();
  const s = await S();
  assert.ok(s.meetings.fuel_fund, 'meeting recorded');
  assert.equal(s.meetings.fuel_fund.playerSide, 'yes');
});

await check('day ends with a summary and Day 2 starts', async () => {
  for (let i = 0; i < 8 && !(await page.locator('.summary-modal').count()); i++) {
    await drainEvents(1);
    if (!(await modalVisible())) {
      await page.click('#btn-sleep');
      const ok = page.locator('.modal .choice.primary');
      if (await ok.count()) await ok.click();
    }
    await page.waitForTimeout(150);
  }
  await page.waitForSelector('.summary-modal');
  assert.match(await page.textContent('.summary-modal .modal-title'), /Day 1 complete/);
  assert.ok(await page.locator('.summary-modal .sum-stat').count() === 6);
  await page.getByRole('button', { name: /Sleep → Day 2/ }).click();
  await drainEvents();
  assert.equal((await S()).day, 2);
});

let snapshot;
await check('autosave + resume after reload restores the same game', async () => {
  snapshot = await S();
  await page.reload();
  await page.waitForSelector('#btn-continue');
  assert.match(await page.textContent('#btn-continue'), /Day 2 \(Testy\)/);
  await page.click('#btn-continue');
  await page.waitForTimeout(300);
  const s = await S();
  assert.equal(s.day, snapshot.day);
  assert.equal(s.stats.cash, snapshot.stats.cash);
  assert.deepEqual(s.trust, snapshot.trust);
});

await check('restart asks for confirmation (cancel keeps progress)', async () => {
  await drainEvents();
  await page.click('#btn-menu');
  await page.getByRole('button', { name: 'Restart the week' }).click();
  await page.waitForSelector('.modal:has-text("Restart from Day 1?")');
  await page.getByRole('button', { name: 'Cancel' }).click();
  assert.equal((await S()).day, 2);
});

await check('new game from title asks before erasing the save', async () => {
  await page.click('#btn-menu');
  await page.getByRole('button', { name: 'Save and quit to title' }).click();
  await page.click('#btn-new');
  await page.waitForSelector('.modal:has-text("Start a new game?")');
  await page.getByRole('button', { name: 'Cancel' }).click();
  assert.ok(await page.isVisible('#btn-continue'));
  await page.click('#btn-continue');
});

await check('play to the end of the week: all meetings held, results screen shown', async () => {
  for (let step = 0; step < 120; step++) {
    if (await page.isVisible('#screen-results')) break;
    if (await page.locator('.meeting-modal').count()) {
      const hear = page.getByRole('button', { name: 'Hear the motion' });
      if (await hear.count()) { await hear.click(); continue; }
      const support = page.locator('.meeting-modal .choice:has-text("Support the motion")');
      if (await support.count()) { await support.click(); continue; }
      const vote = page.getByRole('button', { name: /Call the vote/ });
      if (await vote.count()) { await vote.click(); await page.waitForSelector('.banner', { timeout: 10000 }); continue; }
      const cont = page.getByRole('button', { name: 'Continue' });
      if (await cont.count()) { await cont.click(); continue; }
    }
    if (await page.locator('.summary-modal').count()) {
      await page.locator('.summary-modal .choice.primary').click();
      continue;
    }
    if (await modalVisible()) { await drainEvents(1); continue; }
    await page.click('#btn-sleep');
    const ok = page.locator('.modal .choice.primary');
    if (await ok.count()) await ok.click();
    await page.waitForTimeout(100);
  }
  await page.waitForSelector('#screen-results:not([hidden])');
  assert.ok((await page.textContent('.res-hero h1')).length > 2);
  const meetings = await page.locator('.res-missions li').allTextContents();
  assert.ok(meetings.filter((t) => /passed|failed/.test(t)).length === 4, 'four meetings recorded');
});

await check('no uncaught errors on desktop run', async () => {
  assert.deepEqual(errors, []);
});

// ── Music ──
await check('music: title track after first tap, day track in game, meeting music + sting', async () => {
  const c = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  await c.addInitScript(() => {
    window.__played = [];
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { window.__played.push(this.src.split('/').pop()); return orig.call(this); };
  });
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(GAME_URL);
  await p.click('#btn-new');
  const played = () => p.evaluate(() => window.__played);
  assert.ok((await played()).includes('title.mp3'), 'title after first tap: ' + (await played()));
  await p.click('.modal .choice.primary');
  await p.waitForSelector('.event-modal');
  assert.ok((await played()).includes('day.mp3'), 'day track: ' + (await played()));
  await p.evaluate(() => { const g = window.__cw.app.game; g.s.eventQueue = []; g.s.tutorialDone = true; g.spend(11); window.__cw.app.pump(); });
  for (let i = 0; i < 8 && !(await p.locator('.meeting-modal').count()); i++) {
    const ch = p.locator('.modal .choice:not([disabled])').first();
    if (await ch.count()) await ch.click();
    await p.waitForTimeout(150);
  }
  await p.waitForSelector('.meeting-modal');
  assert.ok((await played()).includes('meeting.mp3'), 'meeting track');
  await p.getByRole('button', { name: 'Hear the motion' }).click();
  await p.click('.meeting-modal .choice:has-text("Support")');
  await p.getByRole('button', { name: /Call the vote/ }).click();
  await p.waitForSelector('.banner', { timeout: 10000 });
  const pl = await played();
  assert.ok(pl.includes('win.mp3') || pl.includes('lose.mp3'), 'sting: ' + pl);
  // Turning music off must not break anything.
  await p.evaluate(() => { const a = window.__cw.app; a.settings.music = false; a.applySettings(); });
  assert.deepEqual(errs, []);
  await c.close();
});

// ── Mobile layout ──
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
const m = await mctx.newPage();
const merrors = [];
m.on('pageerror', (e) => merrors.push(String(e)));
await check('mobile: playable, no horizontal scroll, touch targets ≥ 36px', async () => {
  await m.goto(GAME_URL);
  await m.tap('#btn-new');
  await m.fill('#name-input', 'Phone');
  await m.tap('.modal .choice.primary');
  await m.waitForSelector('.event-modal');
  await m.tap('.modal .choice[data-key="1"]');
  await m.getByRole('button', { name: 'Continue' }).tap();
  await m.getByRole('button', { name: 'Skip tutorial' }).tap();
  await m.waitForTimeout(200);
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, 'horizontal overflow ' + overflow);
  await m.tap('.res[aria-label^="Aunty Kemi"]');
  await m.locator('#panel .choice:has-text("Introduce yourself")').tap();
  await m.locator('#panel .choice[data-key="1"]').tap();
  assert.ok(await m.evaluate(() => window.__cw.app.game.s.flags.met_kemi));
  const small = await m.evaluate(() => [...document.querySelectorAll('#dock button, #panel button, #hud button')]
    .map((b) => b.getBoundingClientRect()).filter((r) => r.width > 0 && (r.height < 36 || r.width < 36)).length);
  assert.equal(small, 0, `${small} buttons smaller than 36px`);
  await m.screenshot({ path: process.env.SHOT_DIR ? process.env.SHOT_DIR + '/e2e-mobile.png' : 'tests/e2e-mobile.png' });
  assert.deepEqual(merrors, []);
});

await browser.close();
const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);

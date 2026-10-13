// Record real gameplay footage (vertical, phone layout) with a timeline of key moments.
//   node growth/marketing/capture.mjs --level 1        → growth/data/footage/level-1.webm + level-1.json
//   node growth/marketing/capture.mjs --week           → growth/data/footage/week.webm + week.json
// Uses the built game (npm run build) by default; GAME_URL can point elsewhere.
// Note: browser recordings have no sound; render.mjs adds the game's own soundtrack.
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromePath, loadChromium } from '../../tests/pw.mjs';
import { DATA, ROOT, writeJson } from '../lib/env.mjs';
import { probe } from './render.mjs';

export const FOOTAGE = join(DATA, 'footage');

export async function capture({ level = 1, week = false, url } = {}) {
  const name = week ? 'week' : `level-${level}`;
  const tmp = join(FOOTAGE, 'tmp-' + name);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  const gameUrl = url || process.env.GAME_URL || pathToFileURL(join(ROOT, 'dist', 'index.html')).href;
  if (!process.env.GAME_URL && !existsSync(join(ROOT, 'dist', 'index.html'))) throw new Error('Build the game first: npm run build');

  const chromium = await loadChromium();
  const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
  const ctx = await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 1, hasTouch: true, recordVideo: { dir: tmp, size: { width: 540, height: 960 } } });
  await ctx.addInitScript(([lvl, wk]) => {
    localStorage.setItem('compoundWahala.consent.v1', 'no'); // recordings never send analytics
    const stars = [0, 0, 0, 0, 0].map((_, i) => (wk || i < lvl - 1 ? 3 : 0));
    if (!localStorage.getItem('compoundWahala.story.v1')) localStorage.setItem('compoundWahala.story.v1', JSON.stringify({ v: 1, stars, coins: 40, owned: ['bunting', 'plants'], look: 0 }));
  }, [level, week]);
  const t0 = Date.now();
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  const marks = [];
  const mark = (type, text = '') => marks.push({ t: (Date.now() - t0) / 1000, type, text: String(text).trim().slice(0, 140) });

  await page.goto(gameUrl);
  await page.waitForSelector('#btn-play');
  await page.waitForTimeout(1200);
  mark('title');
  if (week) await recordWeek(page, mark);
  else await recordLevel(page, level, mark, marks);
  await page.waitForTimeout(1500);
  mark('end');
  await ctx.close();
  await browser.close();

  mkdirSync(FOOTAGE, { recursive: true });
  const vid = readdirSync(tmp).find((f) => f.endsWith('.webm'));
  if (!vid) throw new Error('no video recorded');
  renameSync(join(tmp, vid), join(FOOTAGE, name + '.webm'));
  rmSync(tmp, { recursive: true, force: true });
  // The recording starts a few seconds after our clock (browser start-up): align marks to the real video.
  const real = probe(join(FOOTAGE, name + '.webm')).duration;
  const offset = Math.max(0, marks[marks.length - 1].t - real);
  for (const m of marks) m.t = Math.max(0, +(m.t - offset).toFixed(2));
  writeJson(join(FOOTAGE, name + '.json'), { name, level: week ? null : level, recordedAt: new Date().toISOString(), size: [540, 960], marks });
  return { video: join(FOOTAGE, name + '.webm'), marks };
}

/** Play like a curious kid at normal speed: read the talk, try one wrong answer per choice, then the right one. */
async function recordLevel(page, level, mark, marks) {
  await page.evaluate((l) => { window.__cw.story.play(l - 1); }, level);
  mark('level_start');
  let lastGoal = '', lastSay = '', lastBanner = '', wrongTried = new Set();
  for (let i = 0; i < 900; i++) {
    if (await page.locator('#s-card:not([hidden]) #btn-next').count()) { mark('complete'); break; }
    const say = await page.locator('#s-say .say-line').textContent().catch(() => '');
    if (say && say !== lastSay) { lastSay = say; mark('say', say); }
    if (await page.locator('#s-banner:not([hidden])').count()) { const b = await page.textContent('#s-banner').catch(() => ''); if (b !== lastBanner) { lastBanner = b; mark('banner', b); } await page.waitForTimeout(150); continue; }
    const goal = (await page.locator('#s-goal:not([hidden]) .goal-text').textContent().catch(() => '')) || '';
    const acts = page.locator('#s-actions .act:not([disabled])');
    if (goal && (await acts.count())) {
      if (goal !== lastGoal) { lastGoal = goal; mark('goal', goal); await page.waitForTimeout(1200); continue; }
      const hint = page.locator('#s-actions .act.hint:not([disabled])');
      const n = await acts.count();
      // Search / interview chips: go through the ones not tried yet.
      const fresh = page.locator('#s-actions .act:not(.tried):not([disabled])');
      let pick = n > 3 || (await page.locator('#s-actions .act.chip').count()) ? await acts.evaluateAll((els) => els.findIndex((e) => !e.classList.contains('tried'))) : 0;
      if (pick < 0) pick = 0;
      void fresh;
      if (await hint.count()) pick = -1;
      else if (n === 3 && !wrongTried.has(goal)) {
        // first, a funny wrong answer (the last button that isn't primary)
        wrongTried.add(goal);
        pick = n - 1;
        const label = await acts.nth(pick).textContent();
        mark('wrong', label);
      }
      const btn = pick === -1 ? hint.first() : acts.nth(pick);
      const label = await btn.textContent().catch(() => '');
      mark('tap', label);
      await btn.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(pick === -1 || n === 1 ? 450 : 300);
      continue;
    }
    await page.waitForTimeout(120);
  }
  if (!marks.some((m) => m.type === 'complete')) throw new Error(`level ${level} did not finish during recording — footage discarded`);
  await page.waitForTimeout(2200);
  mark('card');
}

/** A short tour of Full Week mode: move in, meet a neighbour, a power cut, buy fuel, the generator. */
async function recordWeek(page, mark) {
  await page.click('#btn-levels');
  await page.click('#btn-week');
  await page.click('#btn-new');
  await page.fill('#name-input', 'Ade');
  await page.waitForTimeout(600);
  await page.click('.modal .choice.primary');
  mark('goal', 'Move in to Room 4');
  const settle = async () => {
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(700);
      const c = page.locator('.modal .choice:not([disabled])');
      if (!(await c.count())) return;
      const skip = page.getByRole('button', { name: 'Skip tutorial' });
      if (await skip.count()) { await skip.click(); continue; }
      mark('say', await page.locator('.modal-title').first().textContent().catch(() => ''));
      await c.first().click();
    }
  };
  await settle();
  for (const [sel, choice, label] of [
    ['.res[aria-label^="Aunty Kemi"]', '#panel .choice >> nth=0', 'Meet Aunty Kemi'],
    ['.place:has-text("Kiosk")', '#panel .choice:has-text("fuel")', 'Buy fuel at the kiosk'],
    ['.place:has-text("Generator")', '#panel .choice:has-text("Start")', 'Start the generator'],
    ['.place:has-text("Your room")', '#panel .choice:has-text("phone repairs")', 'Fix phones for money'],
  ]) {
    mark('goal', label);
    await page.click(sel).catch(() => {});
    await page.waitForTimeout(1500);
    await page.locator(choice).first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1800);
    await settle();
  }
  mark('complete');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const week = a.includes('--week');
  const level = Number(a[a.indexOf('--level') + 1]) || 1;
  const all = a.includes('--all');
  const jobs = all ? [1, 2, 3, 4, 5].map((l) => ({ level: l })).concat([{ week: true }]) : [{ level, week }];
  for (const j of jobs) {
    const r = await capture(j);
    console.log('recorded', r.video, `${r.marks.length} marks, ${r.marks[r.marks.length - 1].t.toFixed(1)}s`);
  }
}

// WORKFLOW A — content generation.
//   npm run growth:generate                 → plan the next 7 days and make drafts for them
//   npm run growth:generate -- --days 3     → fewer days
//   npm run growth:generate -- --series nepa --date 2026-10-20   → one specific item
// Steps: read calendar → pick series → write copy → record/reuse real gameplay → render video +
// thumbnail → validate → save to the review queue (status "draft") → notify you.
// Idempotent: an item id is <date>-<series>; existing items are never regenerated (use --force).
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, GROWTH, notify, readJson, ROOT, writeJson } from '../lib/env.mjs';
import * as queue from '../lib/queue.mjs';
import { capture, FOOTAGE } from './capture.mjs';
import { aiHooks, templateCopy, validateCopy } from './copy.mjs';
import { probe, render, thumbnail } from './render.mjs';

const SERIES_FILE = join(GROWTH, 'content', 'series.json');
const CAL_FILE = join(GROWTH, 'content', 'calendar.json');
/** Starting hypothesis only — Workflow D suggests changes once real data exists. */
export const DEFAULT_POST_TIME_UTC = '18:00'; // 7pm in Lagos (WAT, UTC+1)

export function planCalendar(days, from = new Date()) {
  const cfg = readJson(SERIES_FILE);
  const cal = readJson(CAL_FILE, { slots: [], next: 0 });
  const have = new Set(cal.slots.map((s) => s.date));
  for (let i = 1; i <= days; i++) {
    const date = new Date(from.getTime() + i * 86400000).toISOString().slice(0, 10);
    if (have.has(date)) continue;
    const s = cfg.series[cal.next % cfg.series.length];
    cal.next++;
    cal.slots.push({ date, series: s.id, timeUTC: DEFAULT_POST_TIME_UTC, hookIndex: Math.floor(cal.next / cfg.series.length) });
  }
  cal.slots.sort((a, b) => a.date.localeCompare(b.date));
  writeJson(CAL_FILE, cal);
  return cal;
}

function footageFor(series) {
  const name = series.feature.kind === 'week' ? 'week' : `level-${series.feature.level}`;
  const vid = join(FOOTAGE, name + '.webm');
  const built = join(ROOT, 'dist', 'index.html');
  const fresh = existsSync(vid) && existsSync(join(FOOTAGE, name + '.json')) && (!existsSync(built) || statSync(vid).mtimeMs > statSync(built).mtimeMs);
  return { name, vid, fresh, json: join(FOOTAGE, name + '.json') };
}

export async function generateItem(slot, { force = false } = {}) {
  const cfg = readJson(SERIES_FILE);
  const series = cfg.series.find((s) => s.id === slot.series);
  if (!series) throw new Error('unknown series ' + slot.series);
  const id = `${slot.date}-${series.id}`;
  if (queue.get(id) && !force) return { id, skipped: true };
  const links = config().links;

  // 1. Copy (free template; optional AI hooks)
  const copy = templateCopy(series, { id, hookIndex: slot.hookIndex ?? 0, label: cfg.label, baseHashtags: cfg.baseHashtags, landing: links.landing });
  let aiUsed = false;
  try {
    const alt = await aiHooks(series);
    if (alt?.length) { copy.altHooks = alt; aiUsed = true; }
  } catch (e) { copy.aiError = String(e.message); }

  // 2. Real gameplay footage (re-recorded when the game build is newer)
  const f = footageFor(series);
  if (!f.fresh) await capture(series.feature.kind === 'week' ? { week: true } : { level: series.feature.level });
  const marks = readJson(f.json).marks;

  // 3. Render video + thumbnail
  const dir = queue.dir(id);
  const music = { nepa: 'night', 'refuse-to-pay': 'meeting', 'meeting-wrong': 'meeting', 'survive-7': 'day' }[series.id] || 'day';
  const r = render({ video: f.vid, marks, hook: copy.hook, title: series.title, label: cfg.label, cta: 'PLAY FREE IN YOUR BROWSER', url: links.game.replace(/^https:\/\//, '').replace(/\/$/, ''), music, out: join(dir, 'video.mp4') });
  const win = marks.find((m) => m.type === 'complete')?.t ?? marks[marks.length - 1].t;
  thumbnail({ video: f.vid, at: Math.max(0, win - 2.5), title: series.title, out: join(dir, 'thumb.png') });

  // 4. Validate
  const v = probe(join(dir, 'video.mp4'));
  const issues = validateCopy(copy, cfg.label);
  if (v.width !== 1080 || v.height !== 1920) issues.push(`video is ${v.width}x${v.height}, expected 1080x1920`);
  if (!(v.duration >= 8 && v.duration <= 60)) issues.push(`video length ${v.duration.toFixed(1)}s (Shorts/Reels need 8–60s)`);
  if (!v.audio) issues.push('video has no audio track');

  // 5. Save as a draft for review
  const platforms = Object.fromEntries(Object.keys(config().publishing.platforms).map((p) => [p, { status: 'pending', attempts: 0 }]));
  const meta = {
    id, series: series.id, title: series.title, created: new Date().toISOString(), status: 'draft',
    scheduleAt: `${slot.date}T${slot.timeUTC || DEFAULT_POST_TIME_UTC}:00Z`,
    copy, files: { video: 'video.mp4', thumb: 'thumb.png' }, video: { ...v, speed: r.speed, source: f.name },
    validation: { ok: issues.length === 0, issues }, aiUsed, platforms,
    history: [{ t: new Date().toISOString(), status: 'draft', note: 'generated' }],
  };
  writeJson(join(dir, 'script.md.json'), { script: copy.script });
  queue.save(meta);
  return { id, issues };
}

export async function run({ days = 7, series, date, force = false } = {}) {
  if (config().workflows?.paused) { console.log('Workflows are paused (config.json → workflows.paused). Nothing done.'); return []; }
  const slots = series ? [{ date: date || new Date().toISOString().slice(0, 10), series, timeUTC: DEFAULT_POST_TIME_UTC, hookIndex: 0 }] : planCalendar(days).slots.filter((s) => s.date > new Date().toISOString().slice(0, 10)).slice(0, days);
  const made = [];
  for (const s of slots) {
    const r = await generateItem(s, { force });
    console.log(r.skipped ? `= ${r.id} (exists)` : `+ ${r.id}${r.issues.length ? '  ⚠ ' + r.issues.join('; ') : '  ✓ valid'}`);
    if (!r.skipped) made.push(r);
  }
  if (made.length) await notify('Content ready for review', `${made.length} new draft(s). Open http://127.0.0.1:${process.env.GROWTH_PORT || 8787}/review`);
  return made;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const a = process.argv.slice(2);
  const arg = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
  await run({ days: Number(arg('--days')) || 7, series: arg('--series'), date: arg('--date'), force: a.includes('--force') });
}

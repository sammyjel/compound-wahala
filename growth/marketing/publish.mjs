// WORKFLOW B — publishing and scheduling.
//   npm run growth:publish            (respects config.json: kill switch, pause, per-platform mode)
//   npm run growth:publish -- --dry   (shows what would happen, changes nothing)
// Rules:
//  - Only APPROVED items that passed validation are touched. (With autoPublishRoutine on, drafts of
//    series you marked "approved" in series.json count as approved.)
//  - mode "manual" (default for every platform): a manual posting task is created once, with the
//    exact caption and file, and you are notified. Nothing is claimed as posted until you paste the
//    real URL in the review page.
//  - mode "api": only YouTube has an official-API adapter. Missing credentials → manual task.
//  - Idempotent: a platform that is published / scheduled / has a task is never repeated.
//  - Temporary failures (5xx, 429, network) are retried with backoff up to maxRetries.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, CONTENT, GROWTH, notify, readJson } from '../lib/env.mjs';
import * as queue from '../lib/queue.mjs';
import * as youtube from './platforms/youtube.mjs';

const TASKS = join(CONTENT, 'tasks');
const ADAPTERS = { youtube };
/** Manual tasks / API uploads are prepared this long before the scheduled time. */
const LEAD_MS = 24 * 3600000;

export async function run({ dry = false, now = Date.now() } = {}) {
  const cfg = config();
  if (cfg.workflows?.paused) return log('Workflows paused (config.json → workflows.paused). Nothing done.');
  if (cfg.publishing?.killSwitch) return log('Kill switch is ON (config.json → publishing.killSwitch). Nothing published. Turn it off after approving your first campaign.');
  const series = Object.fromEntries((readJson(join(GROWTH, 'content', 'series.json'))?.series ?? []).map((s) => [s.id, s]));
  const done = [];
  for (let item of queue.list()) {
    if (item.status === 'draft' && cfg.publishing.autoPublishRoutine && series[item.series]?.approved && item.validation?.ok) {
      if (!dry) item = queue.setStatus(item.id, 'approved', 'auto-approved: routine series (autoPublishRoutine on)');
      else item = { ...item, status: 'approved' };
    }
    if (!['approved', 'partial'].includes(item.status) || !item.validation?.ok) continue;
    if (Date.parse(item.scheduleAt) - now > LEAD_MS) continue;
    for (const [platform, st] of Object.entries(item.platforms)) {
      if (['published', 'scheduled', 'manual_task'].includes(st.status)) continue;
      const mode = cfg.publishing.platforms?.[platform]?.mode ?? 'manual';
      const adapter = ADAPTERS[platform];
      if (mode === 'api' && adapter?.configured()) {
        if (dry) { done.push(`${item.id}/${platform}: would upload via API`); continue; }
        const r = await withRetries(() => adapter.upload(uploadArgs(item, platform, cfg)), cfg.publishing.maxRetries ?? 3);
        const m = queue.get(item.id);
        if (r.ok) {
          m.platforms[platform] = { ...st, status: r.value.status, url: r.value.url, remoteId: r.value.id, attempts: (st.attempts ?? 0) + r.attempts, at: new Date().toISOString(), via: 'api' };
          done.push(`${item.id}/${platform}: ${r.value.status} ${r.value.url}`);
        } else {
          m.platforms[platform] = { ...st, status: 'failed', lastError: r.error, attempts: (st.attempts ?? 0) + r.attempts };
          await notify('Publishing failed', `${item.id} on ${platform}: ${r.error}`);
          done.push(`${item.id}/${platform}: FAILED ${r.error}`);
        }
        queue.save(queue.rollup(m));
      } else {
        const why = mode === 'api' ? `${platform} API not configured or not supported` : 'manual mode';
        if (dry) { done.push(`${item.id}/${platform}: would create manual task (${why})`); continue; }
        const file = manualTask(item, platform, why, cfg.publishing.platforms?.[platform]?.account);
        const m = queue.get(item.id);
        m.platforms[platform] = { ...st, status: 'manual_task', task: file, note: why };
        queue.save(m);
        await notify('Post this manually', `${item.title} → ${platform} at ${item.scheduleAt.slice(0, 16)} UTC. Task: ${file}`);
        done.push(`${item.id}/${platform}: manual task`);
      }
    }
  }
  for (const d of done) log(d);
  if (!done.length) log('Nothing to do (no approved items due in the next 24h).');
  return done;
}

function uploadArgs(item, platform, cfg) {
  const c = item.copy.platforms[platform];
  return { file: join(queue.dir(item.id), item.files.video), title: c.title, description: c.description, tags: c.tags ?? [], publishAt: item.scheduleAt, madeForKids: !!cfg.publishing.platforms?.[platform]?.madeForKids };
}

async function withRetries(fn, max) {
  let attempts = 0, last;
  while (attempts < max) {
    attempts++;
    try { return { ok: true, value: await fn(), attempts }; } catch (e) {
      last = e;
      const transient = e instanceof youtube.TransientError || e.name === 'TypeError' /* network */;
      if (!transient) break;
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempts));
    }
  }
  return { ok: false, error: String(last?.message || last).slice(0, 200), attempts };
}

/** A checklist you can follow on your phone: what to upload, the caption, and where to record the URL. */
function manualTask(item, platform, why, account) {
  mkdirSync(TASKS, { recursive: true });
  const c = item.copy.platforms[platform];
  const f = join(TASKS, `${item.id}-${platform}.md`);
  if (existsSync(f)) return f;
  const steps = {
    tiktok: ['Open TikTok → + → Upload → choose the video', 'Paste the caption below', 'Turn ON "AI-generated content" label (character art is AI-made)', 'Post (or schedule in TikTok Studio)'],
    instagram: ['Instagram → + → Reel → choose the video', 'Paste the caption below; set cover to the thumbnail', 'Advanced settings → turn ON "AI info" label', 'Share'],
    facebook: ['Facebook Page → Reel → upload the video', 'Paste the caption (it already includes the tracked link)', 'Mark as AI-generated content if prompted', 'Publish or schedule'],
    youtube: ['YouTube Studio → Create → Upload → choose the video', 'Title and description below; Audience: decide "made for kids" honestly', 'Altered or synthetic content → Yes (AI character art)', 'Schedule for the time below'],
  }[platform] ?? ['Upload the video', 'Paste the caption'];
  const caption = c.caption ?? `${c.title}\n\n${c.description}`;
  writeFileSync(f, [
    `# Post "${item.title}" on ${platform}`,
    '',
    ...(account ? [`Account: ${account}`] : []),
    `When: ${item.scheduleAt.replace('T', ' ').slice(0, 16)} UTC (${why})`,
    `Video: ${join(queue.dir(item.id), item.files.video)}`,
    `Thumbnail: ${join(queue.dir(item.id), item.files.thumb)}`,
    '',
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    `${steps.length + 1}. Paste the post URL into the review page (http://127.0.0.1:8787/review) → "Mark posted"`,
    '',
    '## Caption',
    '```',
    caption,
    '```',
  ].join('\n'));
  return f;
}

function log(s) { console.log(s); return []; }

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run({ dry: process.argv.includes('--dry') });
}

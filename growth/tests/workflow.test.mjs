// Publishing workflow rules, in a throwaway folder (never touches your real queue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = mkdtempSync(join(tmpdir(), 'cw-growth-'));
process.env.GROWTH_QUEUE = join(root, 'queue');
process.env.GROWTH_CONFIG = join(root, 'config.json');
delete process.env.NOTIFY_WEBHOOK;
delete process.env.YOUTUBE_REFRESH_TOKEN;
const setConfig = (publishing, workflows = { paused: false }) => writeFileSync(process.env.GROWTH_CONFIG, JSON.stringify({ publishing: { maxRetries: 1, autoPublishRoutine: false, platforms: { youtube: { mode: 'manual' }, tiktok: { mode: 'manual' } }, ...publishing }, workflows }));

const queue = await import('../lib/queue.mjs');
const { run } = await import('../marketing/publish.mjs');

function item(id, status, ok = true, scheduleAt = new Date(Date.now() + 3600000).toISOString()) {
  mkdirSync(join(process.env.GROWTH_QUEUE, id), { recursive: true });
  const cap = { caption: 'Hi. Gameplay from Compound Wahala · fictional characters. Character art is AI-generated.' };
  return queue.save({ id, series: 'nepa', title: 'NEPA', status, scheduleAt, created: new Date().toISOString(), validation: { ok, issues: [] }, files: { video: 'video.mp4', thumb: 'thumb.png' },
    copy: { platforms: { youtube: { title: 't', description: 'd', tags: [] }, tiktok: cap } }, platforms: { youtube: { status: 'pending' }, tiktok: { status: 'pending' } }, history: [] });
}

test('kill switch and pause stop everything', async () => {
  item('a-approved', 'approved');
  setConfig({ killSwitch: true });
  assert.deepEqual(await run(), []);
  setConfig({ killSwitch: false }, { paused: true });
  assert.deepEqual(await run(), []);
  assert.equal(queue.get('a-approved').platforms.tiktok.status, 'pending');
});

test('only approved, valid, due items get manual tasks — once', async () => {
  item('b-draft', 'draft');
  item('c-invalid', 'approved', false);
  item('d-later', 'approved', true, new Date(Date.now() + 5 * 86400000).toISOString());
  setConfig({ killSwitch: false });
  const out = await run();
  assert.equal(out.length, 2); // a-approved: youtube + tiktok
  assert.equal(queue.get('a-approved').platforms.tiktok.status, 'manual_task');
  assert.equal(queue.get('b-draft').platforms.tiktok.status, 'pending');
  assert.equal(queue.get('c-invalid').platforms.tiktok.status, 'pending');
  assert.equal(queue.get('d-later').platforms.tiktok.status, 'pending');
  assert.equal(readdirSync(join(root, 'tasks')).length, 2);
  assert.ok(existsSync(join(root, 'INBOX.md')));
  assert.equal((await run()).length, 0, 'idempotent: second run does nothing new');
});

test('API mode without credentials falls back to a manual task (never pretends to post)', async () => {
  item('e-api', 'approved');
  setConfig({ killSwitch: false, platforms: { youtube: { mode: 'api' }, tiktok: { mode: 'manual' } } });
  await run();
  const yt = queue.get('e-api').platforms.youtube;
  assert.equal(yt.status, 'manual_task');
  assert.match(yt.note, /not configured/);
  assert.equal(yt.url, undefined);
});

test('a post only counts as published with its real URL; overall status rolls up', () => {
  assert.throws(() => queue.markPublished('e-api', 'tiktok', 'not a url'));
  queue.markPublished('e-api', 'tiktok', 'https://www.tiktok.com/@x/video/1');
  assert.equal(queue.get('e-api').status, 'partial');
  queue.markPublished('e-api', 'youtube', 'https://youtube.com/shorts/abc');
  assert.equal(queue.get('e-api').status, 'published');
});

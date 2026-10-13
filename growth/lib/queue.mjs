// The content review queue: one folder per piece of content under growth/content/queue/<id>/
// meta.json holds copy, validation results, approval state and per-platform publishing status.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { QUEUE, readJson, writeJson } from './env.mjs';

export const STATUSES = ['draft', 'approved', 'rejected', 'published', 'partial'];

export function list() {
  if (!existsSync(QUEUE)) return [];
  return readdirSync(QUEUE)
    .map((id) => readJson(join(QUEUE, id, 'meta.json')))
    .filter(Boolean)
    .sort((a, b) => (a.scheduleAt || a.created).localeCompare(b.scheduleAt || b.created));
}

export const get = (id) => (/^[a-z0-9-]+$/.test(id) ? readJson(join(QUEUE, id, 'meta.json')) : null);
export const dir = (id) => join(QUEUE, id);

export function save(meta) {
  writeJson(join(QUEUE, meta.id, 'meta.json'), meta);
  return meta;
}

export function setStatus(id, status, note = '') {
  const m = get(id);
  if (!m) throw new Error('no such item ' + id);
  if (!STATUSES.includes(status)) throw new Error('bad status ' + status);
  m.status = status;
  m.history = [...(m.history ?? []), { t: new Date().toISOString(), status, note }];
  return save(m);
}

/** Mark one platform done after a manual post (records the real URL you pasted). */
export function markPublished(id, platform, url) {
  const m = get(id);
  if (!m) throw new Error('no such item ' + id);
  if (!/^https:\/\/\S+$/.test(url)) throw new Error('need the https:// post URL');
  m.platforms[platform] = { ...(m.platforms[platform] ?? {}), status: 'published', url, publishedAt: new Date().toISOString(), via: 'manual' };
  return save(rollup(m));
}

/** Overall status from the platform statuses. */
export function rollup(m) {
  const st = Object.values(m.platforms ?? {}).map((p) => p.status);
  if (st.length && st.every((s) => s === 'published')) m.status = 'published';
  else if (st.some((s) => s === 'published')) m.status = 'partial';
  return m;
}

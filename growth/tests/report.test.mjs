// Workflow D suggestion rules (synthetic test posts only).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse, parseCsv } from '../marketing/report.mjs';

const post = (series, views, players, hour = 18, duration = 30) => ({ series, platform: 'youtube', views, players, postedAt: `2026-10-0${1 + (views % 8)}T${hour}:00:00Z`, duration, shares: 1, completion_rate: 0.5 });

test('no suggestions without enough evidence', () => {
  const a = analyse([post('nepa', 900, 3), post('last-meat', 100, 0)]);
  assert.ok(a.suggestions.every((s) => /Not enough/.test(s)));
});

test('a clear winner is suggested only with 3+ posts and 300+ views per group', () => {
  const posts = [...[1000, 1200, 900].map((v) => post('nepa', v, 4)), ...[200, 150, 180].map((v) => post('last-meat', v, 0))];
  const a = analyse(posts);
  assert.match(a.suggestions[0], /"nepa" averages 1033 views\/post/);
  assert.match(a.suggestions[3], /Best at bringing players: "nepa"/);
  assert.equal(a.top[0].series, 'nepa');
});

test('close results are called a tie, not a winner', () => {
  const posts = [...[500, 520, 510].map((v) => post('nepa', v, 0)), ...[480, 470, 490].map((v) => post('last-meat', v, 0))];
  assert.match(analyse(posts).suggestions[0], /No clear winner/);
});

test('metrics CSV parsing keeps blanks as unknown, not zero', () => {
  const rows = parseCsv('item_id,platform,date,views,watch_time_s,completion_rate,shares,comments,link_clicks,followers_gained\nx,tiktok,2026-10-20,1500,,0.42,12,3,,5\n');
  assert.equal(rows[0].views, 1500);
  assert.equal(rows[0].watch_time_s, null);
  assert.equal(rows[0].link_clicks, null);
  assert.equal(rows[0].completion_rate, 0.42);
});

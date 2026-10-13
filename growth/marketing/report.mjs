// WORKFLOW C — performance reporting, and WORKFLOW D — evidence-based suggestions.
//   npm run growth:report
// Sources (only real data; missing sources are listed, never filled in):
//   1. YouTube Data/Analytics API for our uploads (when YOUTUBE_* credentials exist)
//   2. growth/content/metrics.csv — paste numbers from TikTok / Instagram / Facebook insights
//   3. Game analytics (/api/stats campaigns): players who arrived via each post's tracked link
// Output: growth/content/reports/<date>.md and latest.json. Suggestions never change settings by themselves.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, CONTENT, writeJson } from '../lib/env.mjs';
import * as queue from '../lib/queue.mjs';
import * as youtube from './platforms/youtube.mjs';

export const METRICS_CSV = join(CONTENT, 'metrics.csv');
export const CSV_HEADER = 'item_id,platform,date,views,watch_time_s,completion_rate,shares,comments,link_clicks,followers_gained';
/** Minimum evidence before suggesting anything. */
export const MIN = { postsPerGroup: 3, viewsPerGroup: 300 };

export function parseCsv(text) {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  if (!head || !lines.length) return [];
  const keys = head.split(',').map((k) => k.trim());
  return lines.filter((l) => l.trim()).map((l) => {
    const v = l.split(',');
    const o = Object.fromEntries(keys.map((k, i) => [k, (v[i] ?? '').trim()]));
    for (const k of ['views', 'watch_time_s', 'completion_rate', 'shares', 'comments', 'link_clicks', 'followers_gained']) o[k] = o[k] === '' ? null : Number(o[k]);
    return o;
  });
}

/** Combine per-post rows; group by series / length / hour; pick top posts; make cautious suggestions. */
export function analyse(posts) {
  const withViews = posts.filter((p) => p.views != null);
  const group = (key) => {
    const g = {};
    for (const p of withViews) {
      const k = key(p);
      g[k] ??= { key: k, posts: 0, views: 0, players: 0, shares: 0, completion: [] };
      g[k].posts++;
      g[k].views += p.views;
      g[k].players += p.players ?? 0;
      g[k].shares += p.shares ?? 0;
      if (p.completion_rate != null) g[k].completion.push(p.completion_rate);
    }
    return Object.values(g).map((x) => ({ ...x, viewsPerPost: x.views / x.posts, playersPer1kViews: x.views ? (x.players / x.views) * 1000 : null, avgCompletion: x.completion.length ? x.completion.reduce((a, b) => a + b, 0) / x.completion.length : null }))
      .sort((a, b) => b.viewsPerPost - a.viewsPerPost);
  };
  const bySeries = group((p) => p.series);
  const byLength = group((p) => (p.duration < 20 ? 'under 20s' : p.duration <= 35 ? '20–35s' : 'over 35s'));
  const byHour = group((p) => `${String(new Date(p.postedAt).getUTCHours()).padStart(2, '0')}:00 UTC`);
  const byPlatform = group((p) => p.platform);
  const top = [...withViews].sort((a, b) => (b.players ?? 0) - (a.players ?? 0) || b.views - a.views).slice(0, 5);

  const suggestions = [];
  const enough = (g) => g.filter((x) => x.posts >= MIN.postsPerGroup && x.views >= MIN.viewsPerGroup);
  const compare = (groups, what) => {
    const e = enough(groups);
    if (e.length < 2) return `Not enough data yet to compare ${what} (need at least ${MIN.postsPerGroup} posts and ${MIN.viewsPerGroup} views in two groups).`;
    const [best, worst] = [e[0], e[e.length - 1]];
    if (best.viewsPerPost < worst.viewsPerPost * 1.3) return `No clear winner between ${what} yet (difference under 30%). Keep testing.`;
    return `${what}: "${best.key}" averages ${Math.round(best.viewsPerPost)} views/post vs ${Math.round(worst.viewsPerPost)} for "${worst.key}" (${best.posts} vs ${worst.posts} posts). Consider more "${best.key}".`;
  };
  suggestions.push(compare(bySeries, 'series'));
  suggestions.push(compare(byLength, 'video lengths'));
  suggestions.push(compare(byHour, 'posting times'));
  const conv = enough(bySeries).filter((g) => g.playersPer1kViews != null).sort((a, b) => b.playersPer1kViews - a.playersPer1kViews);
  if (conv.length >= 2 && conv[0].players >= 5) suggestions.push(`Best at bringing players: "${conv[0].key}" (${conv[0].playersPer1kViews.toFixed(1)} players per 1,000 views). Use its hook style more.`);
  else suggestions.push('Not enough tracked players yet to say which content brings people into the game.');
  return { bySeries, byLength, byHour, byPlatform, top, suggestions };
}

async function gameCampaigns() {
  const base = (process.env.ANALYTICS_URL || `http://127.0.0.1:${process.env.GROWTH_PORT || 8787}`).replace(/\/$/, '');
  if (!process.env.ADMIN_TOKEN) return { error: 'ADMIN_TOKEN not set' };
  try {
    const r = await fetch(base + '/api/stats?days=90', { headers: { authorization: 'Bearer ' + process.env.ADMIN_TOKEN } });
    if (!r.ok) return { error: 'analytics ' + r.status };
    return { campaigns: (await r.json()).campaigns };
  } catch (e) { return { error: 'analytics unreachable (' + e.message + ')' }; }
}

export async function run() {
  if (config().workflows?.paused) { console.log('Workflows paused.'); return null; }
  const items = queue.list().filter((i) => Object.values(i.platforms ?? {}).some((p) => p.url));
  const sources = [];
  // 1. YouTube API
  let yt = {};
  const ytIds = items.map((i) => i.platforms.youtube?.remoteId).filter(Boolean);
  if (youtube.configured() && ytIds.length) { try { yt = await youtube.stats(ytIds); sources.push('YouTube API'); } catch (e) { sources.push('YouTube API failed: ' + e.message); } }
  else sources.push(youtube.configured() ? 'YouTube API (no API uploads yet)' : 'YouTube API not connected');
  // 2. Manual CSV
  const csv = existsSync(METRICS_CSV) ? parseCsv(readFileSync(METRICS_CSV, 'utf8')) : [];
  sources.push(`metrics.csv: ${csv.length} row(s)`);
  // 3. Game analytics
  const g = await gameCampaigns();
  sources.push(g.error ? 'Game analytics: ' + g.error : 'Game analytics: connected');
  const playersBy = (cmp, src) => (g.campaigns ?? []).filter((c) => c.campaign === cmp && (!src || c.source === src)).reduce((a, c) => a + c.players, 0);

  const posts = [];
  for (const i of items) {
    for (const [platform, p] of Object.entries(i.platforms)) {
      if (!p.url) continue;
      const row = csv.filter((r) => r.item_id === i.id && r.platform === platform).sort((a, b) => b.date.localeCompare(a.date))[0];
      const api = platform === 'youtube' && p.remoteId ? yt[p.remoteId] : null;
      const m = { ...(row ?? {}), ...(api ?? {}) };
      posts.push({
        id: i.id, series: i.series, platform, url: p.url, postedAt: p.publishedAt || p.at || i.scheduleAt, duration: i.video?.duration ?? 0,
        views: m.views ?? null, completion_rate: m.completionRate ?? m.completion_rate ?? null, shares: m.shares ?? null, comments: m.comments ?? null,
        link_clicks: m.link_clicks ?? null, followers_gained: m.followersGained ?? m.followers_gained ?? null, watch_time_s: m.watchTimeSeconds ?? m.watch_time_s ?? null,
        // per-post links carry utm_campaign=<item id> (YouTube/Facebook); TikTok/Instagram use the bio link
        players: ['youtube', 'facebook'].includes(platform) ? playersBy(i.id, platform) : null,
        source: api ? 'api' : row ? 'csv' : 'none',
      });
    }
  }
  const a = analyse(posts);
  const date = new Date().toISOString().slice(0, 10);
  const bio = ['tiktok', 'instagram'].map((s) => `${s}: ${playersBy('bio', s)}`).join(', ');
  const fmt = (n) => (n == null ? '—' : typeof n === 'number' && n < 1 && n > 0 ? (n * 100).toFixed(0) + '%' : Math.round(n));
  const md = [
    `# Weekly performance report — ${date}`,
    '',
    `Data sources: ${sources.join(' · ')}`,
    `Posts with a recorded URL: ${posts.length} · with view numbers: ${posts.filter((p) => p.views != null).length}`,
    `Players from bio links: ${bio}`,
    '',
    '## Top posts (by players brought, then views)',
    a.top.length ? '| Post | Platform | Views | Completion | Shares | Players |\n|---|---|---|---|---|---|\n' + a.top.map((p) => `| [${p.id}](${p.url}) | ${p.platform} | ${fmt(p.views)} | ${fmt(p.completion_rate)} | ${fmt(p.shares)} | ${fmt(p.players)} |`).join('\n') : '_No view numbers yet. Add rows to growth/content/metrics.csv or connect YouTube._',
    '',
    '## By series',
    a.bySeries.length ? a.bySeries.map((s) => `- **${s.key}**: ${s.posts} post(s), ${Math.round(s.viewsPerPost)} views/post, ${s.players} players`).join('\n') : '_No data._',
    '',
    '## By platform',
    a.byPlatform.length ? a.byPlatform.map((s) => `- **${s.key}**: ${s.posts} post(s), ${Math.round(s.viewsPerPost)} views/post`).join('\n') : '_No data._',
    '',
    '## Suggestions (Workflow D — for you to decide; nothing changes automatically)',
    ...a.suggestions.map((s) => `- ${s}`),
    '',
    '_All numbers come from the sources listed above. Missing numbers are shown as — and are never estimated._',
  ].join('\n');
  const out = join(CONTENT, 'reports', `${date}.md`);
  writeJson(join(CONTENT, 'reports', 'latest.json'), { date, sources, posts, ...a });
  (await import('node:fs')).writeFileSync(out, md);
  console.log(md);
  return { out, ...a };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await run();

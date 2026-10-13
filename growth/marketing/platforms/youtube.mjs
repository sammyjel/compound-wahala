// YouTube Shorts via the official YouTube Data API v3 (resumable upload) + stats.
// Needs YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN (run youtube-auth.mjs once).
// Upload quota: 1,600 units per upload of 10,000/day (≈6 uploads/day on the free quota).
import { readFileSync, statSync } from 'node:fs';

export const configured = () => !!(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET && process.env.YOUTUBE_REFRESH_TOKEN);

export class TransientError extends Error {}

async function token() {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.YOUTUBE_CLIENT_ID, client_secret: process.env.YOUTUBE_CLIENT_SECRET, refresh_token: process.env.YOUTUBE_REFRESH_TOKEN, grant_type: 'refresh_token' }),
  });
  if (r.status >= 500 || r.status === 429) throw new TransientError('Google auth ' + r.status);
  if (!r.ok) throw new Error('Google auth failed (' + r.status + '). Re-run youtube-auth.mjs.');
  return (await r.json()).access_token;
}

/**
 * Upload a Short. If publishAt is in the future the video is uploaded private and YouTube
 * publishes it at that time (the official scheduling mechanism).
 */
export async function upload({ file, title, description, tags, publishAt, madeForKids = false }) {
  const at = await token();
  const future = publishAt && Date.parse(publishAt) > Date.now() + 15 * 60000;
  const meta = {
    snippet: { title, description, tags: tags.slice(0, 15), categoryId: '20' /* Gaming */ },
    status: {
      privacyStatus: future ? 'private' : 'public',
      ...(future ? { publishAt: new Date(publishAt).toISOString() } : {}),
      selfDeclaredMadeForKids: madeForKids,
      containsSyntheticMedia: true, // residents are AI-generated photoreal art
    },
  };
  const size = statSync(file).size;
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + at, 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-length': String(size), 'x-upload-content-type': 'video/mp4' },
    body: JSON.stringify(meta),
  });
  if (init.status >= 500 || init.status === 429) throw new TransientError('YouTube init ' + init.status);
  if (!init.ok) throw new Error('YouTube init failed ' + init.status + ': ' + (await init.text()).slice(0, 200));
  const loc = init.headers.get('location');
  const put = await fetch(loc, { method: 'PUT', headers: { 'content-type': 'video/mp4', 'content-length': String(size) }, body: readFileSync(file) });
  if (put.status >= 500 || put.status === 429) throw new TransientError('YouTube upload ' + put.status);
  if (!put.ok) throw new Error('YouTube upload failed ' + put.status + ': ' + (await put.text()).slice(0, 200));
  const v = await put.json();
  return { id: v.id, url: `https://youtube.com/shorts/${v.id}`, status: future ? 'scheduled' : 'published' };
}

/** Public stats for our uploaded videos (views, likes, comments). */
export async function stats(ids) {
  if (!ids.length) return {};
  const at = await token();
  const r = await fetch('https://www.googleapis.com/youtube/v3/videos?part=statistics&id=' + ids.join(','), { headers: { authorization: 'Bearer ' + at } });
  if (!r.ok) throw new Error('YouTube stats ' + r.status);
  const out = {};
  for (const it of (await r.json()).items ?? []) {
    out[it.id] = { views: +it.statistics.viewCount || 0, likes: +it.statistics.likeCount || 0, comments: +it.statistics.commentCount || 0 };
  }
  // Watch time / average view % come from the YouTube Analytics API (scope yt-analytics.readonly).
  try {
    const end = new Date().toISOString().slice(0, 10);
    const q = new URLSearchParams({ ids: 'channel==MINE', startDate: '2020-01-01', endDate: end, metrics: 'estimatedMinutesWatched,averageViewPercentage,shares,subscribersGained', dimensions: 'video', filters: 'video==' + ids.join(',') });
    const a = await fetch('https://youtubeanalytics.googleapis.com/v2/reports?' + q, { headers: { authorization: 'Bearer ' + at } });
    if (a.ok) {
      for (const row of (await a.json()).rows ?? []) {
        const [vid, minutes, avgPct, shares, subs] = row;
        out[vid] = { ...(out[vid] ?? {}), watchTimeSeconds: Math.round(minutes * 60), completionRate: avgPct / 100, shares, followersGained: subs };
      }
    }
  } catch { /* analytics scope not granted: basic stats only */ }
  return out;
}

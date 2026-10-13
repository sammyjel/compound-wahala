// One-time YouTube authorisation (OAuth "installed app" loopback flow).
//   1. Google Cloud Console → new project → enable "YouTube Data API v3" and "YouTube Analytics API"
//   2. OAuth consent screen (External, add yourself as test user) → Credentials → OAuth client ID → Desktop app
//   3. Put YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in growth/.env
//   4. node growth/marketing/youtube-auth.mjs  → open the printed link, allow access
// The refresh token is written straight into growth/.env (never printed).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { GROWTH } from '../lib/env.mjs';

const id = process.env.YOUTUBE_CLIENT_ID, secret = process.env.YOUTUBE_CLIENT_SECRET;
if (!id || !secret) { console.error('Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in growth/.env first.'); process.exit(1); }
const scopes = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly', 'https://www.googleapis.com/auth/yt-analytics.readonly'];

const srv = createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const code = u.searchParams.get('code');
  if (!code) { res.end('Waiting…'); return; }
  const redirect = `http://127.0.0.1:${srv.address().port}`;
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: 'authorization_code' }) });
  const j = await r.json();
  if (!j.refresh_token) { res.end('No refresh token returned. Remove the app at myaccount.google.com/permissions and try again.'); console.error('No refresh token returned.'); process.exit(1); }
  const envFile = join(GROWTH, '.env');
  let text = existsSync(envFile) ? readFileSync(envFile, 'utf8') : '';
  text = /^YOUTUBE_REFRESH_TOKEN=.*$/m.test(text) ? text.replace(/^YOUTUBE_REFRESH_TOKEN=.*$/m, `YOUTUBE_REFRESH_TOKEN=${j.refresh_token}`) : text + `\nYOUTUBE_REFRESH_TOKEN=${j.refresh_token}\n`;
  writeFileSync(envFile, text);
  res.end('Done! You can close this tab. The token was saved to growth/.env.');
  console.log('✓ Saved YOUTUBE_REFRESH_TOKEN to growth/.env');
  srv.close();
});
srv.listen(0, '127.0.0.1', () => {
  const redirect = `http://127.0.0.1:${srv.address().port}`;
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: id, redirect_uri: redirect, response_type: 'code', scope: scopes.join(' '), access_type: 'offline', prompt: 'consent' });
  console.log('Open this link and allow access:\n\n' + url + '\n');
});

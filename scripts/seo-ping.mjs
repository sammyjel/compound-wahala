// After a deploy: tell IndexNow search engines (Bing, Yandex, Seznam, Naver, Yep) which pages changed.
// Reads the LIVE sitemap, compares lastmod with seo/.pinged.json and submits only new/changed URLs.
// Google does not accept pings — it reads the sitemap you submit once in Search Console.
// Usage: npm run seo:ping  [-- --all]  [-- --dry]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const SITE = JSON.parse(readFileSync(join(ROOT, 'seo', 'site.json'), 'utf8'));
const KEY = readFileSync(join(ROOT, 'seo', 'indexnow-key.txt'), 'utf8').trim();
const STATE = join(ROOT, 'seo', '.pinged.json');
const all = process.argv.includes('--all');
const dry = process.argv.includes('--dry');

const keyLocation = new URL(`${KEY}.txt`, SITE.siteUrl).href;
const live = await fetch(keyLocation).then((r) => (r.ok ? r.text() : '')).catch(() => '');
if (live.trim() !== KEY) {
  console.error(`IndexNow key file is not live at ${keyLocation} yet (deploy first, then wait for GitHub Pages).`);
  process.exit(1);
}

const xml = await (await fetch(new URL('sitemap.xml', SITE.siteUrl))).text();
const urls = [...xml.matchAll(/<loc>([^<]+)<\/loc><lastmod>([^<]+)<\/lastmod>/g)].map((m) => ({ url: m[1], lastmod: m[2] }));
const prev = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const changed = urls.filter((u) => all || prev[u.url] !== u.lastmod);
if (!changed.length) { console.log('Nothing changed since the last ping.'); process.exit(0); }

const host = new URL(SITE.siteUrl).host;
const body = { host, key: KEY, keyLocation, urlList: changed.map((u) => u.url) };
if (dry) { console.log('Would submit:', body.urlList); process.exit(0); }

const res = await fetch('https://api.indexnow.org/indexnow', { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
// 200 = accepted, 202 = accepted (key validation pending). Anything else is an error.
console.log(`IndexNow: HTTP ${res.status} for ${changed.length} URL(s)`);
if (res.status !== 200 && res.status !== 202) {
  console.error(await res.text());
  process.exit(1);
}
for (const u of changed) prev[u.url] = u.lastmod;
writeFileSync(STATE, JSON.stringify(prev, null, 2) + '\n');

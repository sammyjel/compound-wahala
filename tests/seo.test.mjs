// SEO tests: the built site passes, and the validator really catches each kind of breakage.
// Usage: npm run build && node --experimental-strip-types --test tests/seo.test.mjs
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { slug, validate } from '../scripts/seo.mjs';

const DIST = resolve(fileURLToPath(import.meta.url), '../../dist');
const read = (f) => readFileSync(join(DIST, f), 'utf8');

test('built site passes the SEO check', () => {
  const r = validate(DIST);
  assert.deepEqual(r.errs, []);
  assert.ok(r.pages >= 10);
});

test('every level has its own page, linked from the landing page and the sitemap', () => {
  const sm = read('sitemap.xml');
  for (const t of ['NEPA Don Take Light!', 'Where My Bucket?', 'Rain Dey Come!', 'Who Chop the Meat?', 'Fuel Palaver']) {
    const f = `${slug(t)}.html`;
    assert.ok(read(f).includes('<h1>'), f);
    assert.ok(read('home.html').includes(`href="${f}"`), `home links ${f}`);
    assert.ok(sm.includes(`/compound-wahala/${f}</loc>`), `sitemap has ${f}`);
  }
});

test('level pages carry real Pidgin lines from the game with English', () => {
  const html = read('nepa-don-take-light.html');
  assert.match(html, /NEPA don take light/i);
  assert.match(html, /class="en" lang="en"/);
  assert.ok(read('pidgin.html').split('class="line"').length > 5);
});

test('game page has rich structured data and a crawlable fallback', () => {
  const html = read('index.html');
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const game = ld.find((j) => j['@type'] === 'VideoGame');
  assert.equal(game.isAccessibleForFree, true);
  assert.equal(game.offers.price, '0');
  assert.match(html, /<noscript>[\s\S]*Level 1/);
  assert.equal((html.match(/<title>/g) ?? []).length, 1);
});

test('validator catches broken links, missing images, duplicate titles, bad JSON-LD and false "no ads" claims', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'seo-'));
  try {
    cpSync(DIST, tmp, { recursive: true });
    const edit = (f, a, b) => writeFileSync(join(tmp, f), readFileSync(join(tmp, f), 'utf8').replace(a, b));
    edit('home.html', 'href="where-my-bucket.html"', 'href="where-my-buckett.html"');
    edit('pidgin.html', /<title>[^<]*<\/title>/, `<title>${read('index.html').match(/<title>([^<]*)<\/title>/)[1]}</title>`);
    rmSync(join(tmp, 'media/og/level-3.jpg'));
    edit('fuel-palaver.html', 'application/ld+json">{', 'application/ld+json">{,');
    const errs = validate(tmp).errs.join('\n');
    assert.match(errs, /broken link where-my-buckett\.html/);
    assert.match(errs, /duplicate title/);
    assert.match(errs, /social image missing: .*level-3\.jpg/);
    assert.match(errs, /fuel-palaver\.html: invalid JSON-LD/);
    process.env.VITE_PAYMENTS = 'on';
    assert.match(validate(tmp).errs.join('\n'), /no ads\/purchases/);
  } finally {
    delete process.env.VITE_PAYMENTS;
    rmSync(tmp, { recursive: true, force: true });
  }
});

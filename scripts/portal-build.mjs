// Builds an upload-ready zip for a game portal.
//   node scripts/portal-build.mjs crazygames
//   node scripts/portal-build.mjs gamedistribution <gameId-from-GD-dashboard>
// Portal builds: the portal's own ads (between levels + optional rewarded coins), NO own analytics,
// NO Paystack store, NO AdSense, NO links off the portal, no website pages. Output: dist-portal/<portal>.zip
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '../..');
const [portal, gdId] = process.argv.slice(2);
if (!['crazygames', 'gamedistribution'].includes(portal)) {
  console.error('Usage: node scripts/portal-build.mjs crazygames | gamedistribution <gameId>');
  process.exit(1);
}
if (portal === 'gamedistribution' && !/^[0-9a-f]{32}$/.test(gdId ?? '')) {
  console.error('GameDistribution needs the 32-character gameId from your GD dashboard (Add game → copy the ID).');
  process.exit(1);
}

const OUT = join(ROOT, 'dist-portal', portal);
rmSync(OUT, { recursive: true, force: true });
const env = { ...process.env, VITE_PORTAL: portal, VITE_GD_GAME_ID: gdId ?? '' };
for (const k of ['VITE_ANALYTICS_URL', 'VITE_PAYMENTS', 'VITE_ADS_PROVIDER', 'VITE_ADSENSE_CLIENT']) delete env[k];
const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
execFileSync(process.execPath, [vite, 'build', '--outDir', OUT, '--emptyOutDir'], { cwd: ROOT, env, stdio: 'inherit' });

// Keep only what the game itself loads.
for (const f of readdirSync(OUT)) {
  if (f.endsWith('.html') && f !== 'index.html') rmSync(join(OUT, f));
}
for (const d of ['media']) rmSync(join(OUT, d), { recursive: true, force: true });

// Checks: nothing that sends players or data off the portal, and the right SDK is in.
const html = readFileSync(join(OUT, 'index.html'), 'utf8');
const errs = [];
if (/workers\.dev/.test(html)) errs.push('own analytics endpoint present');
if (portal === 'crazygames' && !html.includes('sdk.crazygames.com/crazygames-sdk-v3.js')) errs.push('CrazyGames SDK URL missing');
if (portal === 'gamedistribution' && !html.includes(gdId)) errs.push('GD gameId missing');
const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
walk(OUT);
const bytes = files.reduce((n, f) => n + statSync(f).size, 0);
if (errs.length) { console.error('Portal build FAILED:\n - ' + errs.join('\n - ')); process.exit(1); }

const zip = join(ROOT, 'dist-portal', `compound-wahala-${portal}.zip`);
rmSync(zip, { force: true });
execFileSync('python', ['-c', `
import os, sys, zipfile
out, src = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, _, fs in os.walk(src):
        for f in fs:
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, src))
`, zip, OUT]);
console.log(`\n${portal}: ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB → ${relative(ROOT, zip)} (${(statSync(zip).size / 1048576).toFixed(1)} MB zipped)`);
console.log(existsSync(zip) ? 'Ready to upload. index.html is at the root of the zip.' : 'zip missing?');

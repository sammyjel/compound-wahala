// Locate a Playwright install and a Chrome/Edge binary without adding dependencies.
// Override with PLAYWRIGHT_CORE=/path/to/playwright-core and CHROME_PATH=/path/to/chrome.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export async function loadChromium() {
  const candidates = [
    process.env.PLAYWRIGHT_CORE,
    'playwright-core',
    'playwright',
    resolve(here, '../../suno-api/node_modules/playwright-core'),
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      const mod = c.includes('/') || c.includes('\\') ? await import(pathToFileURL(resolve(c, 'index.js')).href) : require(c);
      if (mod?.chromium) return mod.chromium;
    } catch { /* try next */ }
  }
  throw new Error('playwright-core not found. Run: npm i -D playwright-core  (or set PLAYWRIGHT_CORE)');
}

export function chromePath() {
  const list = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return list.find((p) => existsSync(p));
}

export const GAME_URL = process.env.GAME_URL ?? pathToFileURL(resolve(here, '../dist/index.html')).href;

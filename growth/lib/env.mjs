// Shared helpers for the growth tools: paths, .env loading, config, notifications, spend guard.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const GROWTH = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = resolve(GROWTH, '..');
export const DATA = join(GROWTH, 'data');
/** Overridable for tests: GROWTH_QUEUE and GROWTH_CONFIG. */
export const QUEUE = process.env.GROWTH_QUEUE || join(GROWTH, 'content', 'queue');
export const CONTENT = join(QUEUE, '..');
mkdirSync(DATA, { recursive: true });
mkdirSync(QUEUE, { recursive: true });

/** Load growth/.env into process.env (never committed; see .env.example). Existing env wins. */
export function loadEnv(file = join(GROWTH, '.env')) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const v = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv();

export const readJson = (f, fallback = null) => {
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return fallback; }
};
export const writeJson = (f, data) => {
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(data, null, 2) + '\n');
};

/** growth/config.json — the switches you control (kill switch, auto-publish, limits). */
export function config() {
  return readJson(process.env.GROWTH_CONFIG || join(GROWTH, 'config.json'), {});
}

/** Never print secrets: show only that a value exists. */
export const has = (k) => !!process.env[k];
export const redact = (s) => String(s).replace(/(token|key|secret)=([^&\s]+)/gi, '$1=***');

/** Tell the owner something needs attention: always written to growth/content/INBOX.md,
 *  and pushed to NOTIFY_WEBHOOK (e.g. a private https://ntfy.sh/<topic>) when configured. */
export async function notify(title, text) {
  const line = `- [ ] ${new Date().toISOString().slice(0, 16).replace('T', ' ')} — **${title}** — ${text}\n`;
  const inbox = join(CONTENT, 'INBOX.md');
  const prev = existsSync(inbox) ? readFileSync(inbox, 'utf8') : '# Things that need you\n\n';
  writeFileSync(inbox, prev + line);
  const hook = process.env.NOTIFY_WEBHOOK;
  if (!hook) return;
  try {
    await fetch(hook, { method: 'POST', body: `${title}: ${text}`, headers: { Title: title.slice(0, 80) } });
  } catch { /* the inbox file is the source of truth */ }
}

/** Spend guard for paid APIs (AI, TTS). Refuses calls that would pass the monthly cap in config.json. */
export function spend(kind, usd) {
  const f = join(DATA, 'spend.json');
  const month = new Date().toISOString().slice(0, 7);
  const s = readJson(f, {});
  if (s.month !== month) { s.month = month; s.byKind = {}; }
  const cap = Number(config().spend?.[`${kind}MonthlyLimitUSD`] ?? 0);
  const used = s.byKind[kind] ?? 0;
  if (used + usd > cap) return { ok: false, used, cap };
  s.byKind[kind] = +(used + usd).toFixed(4);
  writeJson(f, s);
  return { ok: true, used: s.byKind[kind], cap };
}

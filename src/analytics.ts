// Privacy-first analytics.
// - Nothing is sent unless the player says yes (consent prompt) AND an endpoint is configured.
// - Only an anonymous random id; no names, no device fingerprinting, no third-party ad trackers.
// - Endpoint: build with VITE_ANALYTICS_URL=https://... (see server/README.md). Without it, events
//   stay in memory only (handy for tests via window.__cw.analytics).
// - "Delete my data" asks the server to erase every event for this id, then makes a new id.

const CONSENT_KEY = 'compoundWahala.consent.v1';
const ID_KEY = 'compoundWahala.pid.v1';
const VISIT_KEY = 'compoundWahala.visits.v1';
const ATTR_KEY = 'compoundWahala.attr.v1';
export const APP_VERSION = '2.0.0';

export type Consent = 'yes' | 'no' | null;

export interface AEvent {
  e: string;
  t: number;
  pid: string;
  sid: string;
  v: string;
  p: Record<string, string | number | boolean>;
  src?: string;
  med?: string;
  cmp?: string;
  ref?: string;
  dev: 'phone' | 'tablet' | 'desktop';
}

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const ENDPOINT = (env.VITE_ANALYTICS_URL || (globalThis as { CW_ANALYTICS_URL?: string }).CW_ANALYTICS_URL || '').replace(/\/$/, '');

const sid = rid();
const buffer: AEvent[] = [];
/** Last 200 events, in memory only — for tests and the debug overlay. */
export const recent: AEvent[] = [];
let sessionStart = Date.now();

function ls(): Storage | null {
  try { return localStorage; } catch { return null; }
}
function rid(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function consent(): Consent {
  const v = ls()?.getItem(CONSENT_KEY);
  return v === 'yes' || v === 'no' ? v : null;
}

export function setConsent(c: 'yes' | 'no'): void {
  ls()?.setItem(CONSENT_KEY, c);
  if (c === 'no') {
    buffer.length = 0;
    ls()?.removeItem(ID_KEY);
  } else {
    flush();
  }
}

export const analyticsConfigured = () => !!ENDPOINT;

function pid(): string {
  const s = ls();
  let id = s?.getItem(ID_KEY);
  if (!id) {
    id = rid();
    s?.setItem(ID_KEY, id);
  }
  return id;
}

/** First-touch campaign attribution from ?utm_source=…&utm_medium=…&utm_campaign=… (or ?ref=…). */
function attribution(): { src?: string; med?: string; cmp?: string; ref?: string } {
  const s = ls();
  const saved = s?.getItem(ATTR_KEY);
  if (saved) {
    try { return JSON.parse(saved); } catch { /* fall through */ }
  }
  const q = new URLSearchParams(location.search);
  const clean = (x: string | null) => (x ? x.toLowerCase().replace(/[^a-z0-9_\-.]/g, '').slice(0, 40) : undefined);
  let ref: string | undefined;
  try { ref = document.referrer ? new URL(document.referrer).hostname.slice(0, 60) : undefined; } catch { ref = undefined; }
  if (ref === location.hostname) ref = undefined;
  const a = { src: clean(q.get('utm_source') ?? q.get('ref')), med: clean(q.get('utm_medium')), cmp: clean(q.get('utm_campaign')), ref };
  s?.setItem(ATTR_KEY, JSON.stringify(a));
  return a;
}

function device(): AEvent['dev'] {
  const w = Math.min(screen.width, screen.height);
  return w < 600 ? 'phone' : w < 900 && matchMedia('(pointer: coarse)').matches ? 'tablet' : 'desktop';
}

/** Record an event. Props must not contain personal data. */
export function track(e: string, p: AEvent['p'] = {}): void {
  if (consent() === 'no') return;
  const ev: AEvent = { e, t: Date.now(), pid: consent() === 'yes' ? pid() : 'pending', sid, v: APP_VERSION, p, ...attribution(), dev: device() };
  recent.push(ev);
  if (recent.length > 200) recent.shift();
  buffer.push(ev);
  if (buffer.length > 500) buffer.shift();
  if (consent() === 'yes') scheduleFlush();
}

let flushTimer = 0;
function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = window.setTimeout(() => { flushTimer = 0; flush(); }, 4000);
}

/** Send buffered events. Uses sendBeacon on page hide so nothing is lost when the tab closes. */
export function flush(beacon = false): void {
  if (!ENDPOINT || consent() !== 'yes' || !buffer.length) return;
  const id = pid();
  const batch = buffer.splice(0, buffer.length).map((x) => ({ ...x, pid: id }));
  const body = JSON.stringify({ events: batch });
  try {
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon(`${ENDPOINT}/e`, new Blob([body], { type: 'text/plain' }));
      return;
    }
    // text/plain avoids a CORS preflight; the server parses JSON from it.
    fetch(`${ENDPOINT}/e`, { method: 'POST', body, headers: { 'content-type': 'text/plain' }, keepalive: true }).catch(() => {
      buffer.unshift(...batch.slice(-200)); // retry next time
    });
  } catch {
    /* offline: drop quietly */
  }
}

/** Ask the server to delete everything recorded for this player, then forget the id. */
export async function deleteMyData(): Promise<'deleted' | 'nothing-sent' | 'failed'> {
  const s = ls();
  const id = s?.getItem(ID_KEY);
  buffer.length = 0;
  s?.removeItem(ID_KEY);
  s?.removeItem(ATTR_KEY);
  if (!id || !ENDPOINT) return 'nothing-sent';
  try {
    const r = await fetch(`${ENDPOINT}/delete`, { method: 'POST', body: JSON.stringify({ pid: id }), headers: { 'content-type': 'text/plain' } });
    return r.ok ? 'deleted' : 'failed';
  } catch {
    return 'failed';
  }
}

/** Call once at boot: session start, return-visit detection, session end on page hide. */
export function startSession(): void {
  sessionStart = Date.now();
  const s = ls();
  const today = new Date().toISOString().slice(0, 10);
  let visits: { first: string; last: string; days: number } | null = null;
  try { visits = JSON.parse(s?.getItem(VISIT_KEY) ?? 'null'); } catch { visits = null; }
  if (!visits) {
    visits = { first: today, last: today, days: 1 };
    track('first_open');
  } else if (visits.last !== today) {
    const since = Math.round((Date.parse(today) - Date.parse(visits.first)) / 86400000);
    visits = { ...visits, last: today, days: visits.days + 1 };
    track('return_visit', { days_since_first: since, active_days: visits.days });
  }
  s?.setItem(VISIT_KEY, JSON.stringify(visits));
  track('session_start');
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    track('session_end', { seconds: Math.round((Date.now() - sessionStart) / 1000) });
    flush(true);
  };
  addEventListener('pagehide', end);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { flush(true); }
    else if (ended) { ended = false; sessionStart = Date.now(); track('session_start', { resumed: true }); }
  });
  window.addEventListener('error', (ev) => track('client_error', { msg: String(ev.message).slice(0, 120) }));
}

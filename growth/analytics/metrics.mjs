// Pure metric calculations from raw event rows and the money ledger.
// No I/O here: the same code runs in the Cloudflare Worker and in local tests.
//
// Event row: { t, day: 'YYYY-MM-DD', pid, sid, e, p: object, src, med, cmp, ref, dev }
// Ledger row: { date, kind, amount_cents, currency, source: 'measured'|'estimate', provider, note }

const DAY = 86400000;
export const dayOf = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (d, n) => dayOf(Date.parse(d) + n * DAY);

/** Distinct players active in [from, to] (inclusive day strings). */
function activeBetween(rows, from, to) {
  const s = new Set();
  for (const r of rows) if (r.day >= from && r.day <= to) s.add(r.pid);
  return s.size;
}

export function computeStats(rows, { today = dayOf(Date.now()), days = 30 } = {}) {
  const firstSeen = new Map();
  const daysActive = new Map(); // pid -> Set(day)
  const sessions = new Map(); // pid -> Set(sid)
  const attr = new Map(); // pid -> {src, cmp}
  for (const r of rows) {
    if (!firstSeen.has(r.pid) || r.day < firstSeen.get(r.pid)) firstSeen.set(r.pid, r.day);
    if (!daysActive.has(r.pid)) daysActive.set(r.pid, new Set());
    daysActive.get(r.pid).add(r.day);
    if (!sessions.has(r.pid)) sessions.set(r.pid, new Set());
    sessions.get(r.pid).add(r.sid);
    if (!attr.has(r.pid) && (r.src || r.cmp || r.ref)) attr.set(r.pid, { src: r.src || r.ref || 'direct', cmp: r.cmp || '' });
  }
  const players = firstSeen.size;

  // Daily series
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    let fresh = 0;
    for (const f of firstSeen.values()) if (f === d) fresh++;
    series.push({ day: d, dau: activeBetween(rows, d, d), new: fresh });
  }

  // Funnel (players who ever did each step)
  const did = (name, pred = () => true) => {
    const s = new Set();
    for (const r of rows) if (r.e === name && pred(r)) s.add(r.pid);
    return s;
  };
  const tutStart = did('tutorial_start');
  const tutDone = did('tutorial_complete');
  const levels = [];
  for (let n = 1; n <= 5; n++) {
    const started = did('level_start', (r) => Number(r.p?.level) === n);
    const done = did('level_complete', (r) => Number(r.p?.level) === n);
    const stars = rows.filter((r) => r.e === 'level_complete' && Number(r.p?.level) === n).map((r) => Number(r.p?.stars) || 0);
    const secs = rows.filter((r) => r.e === 'level_complete' && Number(r.p?.level) === n).map((r) => Number(r.p?.seconds) || 0);
    levels.push({
      level: n,
      started: started.size,
      completed: done.size,
      completionRate: rate(done.size, started.size),
      abandonRate: started.size ? 1 - done.size / started.size : null,
      avgStars: avg(stars),
      medianSeconds: median(secs),
    });
  }

  // Retention: classic day-N retention per first-seen cohort, only for cohorts old enough.
  const retention = {};
  for (const n of [1, 7, 30]) {
    let eligible = 0, kept = 0;
    for (const [pid, f] of firstSeen) {
      if (addDays(f, n) > today) continue;
      eligible++;
      if (daysActive.get(pid).has(addDays(f, n))) kept++;
    }
    retention['d' + n] = { eligible, retained: kept, rate: eligible >= 1 ? kept / eligible : null };
  }

  // Sessions
  let totalSessions = 0;
  for (const s of sessions.values()) totalSessions += s.size;
  const sessionLens = rows.filter((r) => r.e === 'session_end').map((r) => Number(r.p?.seconds) || 0);

  // Acquisition: by source / campaign (first touch)
  const camp = new Map();
  const l1Done = did('level_complete', (r) => Number(r.p?.level) === 1);
  for (const [pid, f] of firstSeen) {
    const a = attr.get(pid) ?? { src: 'direct', cmp: '' };
    const key = `${a.src}|${a.cmp}`;
    if (!camp.has(key)) camp.set(key, { source: a.src, campaign: a.cmp, players: 0, tutorialDone: 0, level1Done: 0, d1Eligible: 0, d1Kept: 0 });
    const c = camp.get(key);
    c.players++;
    if (tutDone.has(pid)) c.tutorialDone++;
    if (l1Done.has(pid)) c.level1Done++;
    if (addDays(f, 1) <= today) { c.d1Eligible++; if (daysActive.get(pid).has(addDays(f, 1))) c.d1Kept++; }
  }
  const campaigns = [...camp.values()].map((c) => ({ ...c, d1Rate: c.d1Eligible ? c.d1Kept / c.d1Eligible : null })).sort((a, b) => b.players - a.players);

  // Optional ads / store events (counts only — revenue comes from the ledger)
  const count = (name) => rows.filter((r) => r.e === name).length;

  const devices = {};
  for (const r of rows) if (r.e === 'session_start') devices[r.dev] = (devices[r.dev] ?? 0) + 1;

  return {
    generatedFor: today,
    players,
    dau: activeBetween(rows, today, today),
    wau: activeBetween(rows, addDays(today, -6), today),
    mau: activeBetween(rows, addDays(today, -29), today),
    newToday: series[series.length - 1]?.new ?? 0,
    series,
    tutorial: { started: tutStart.size, completed: tutDone.size, rate: rate(tutDone.size, tutStart.size) },
    firstMission: did('first_mission_complete').size,
    levels,
    retention,
    sessions: { total: totalSessions, perPlayer: players ? totalSessions / players : null, medianSeconds: median(sessionLens) },
    returnVisits: count('return_visit'),
    campaigns,
    devices,
    ads: { offered: count('ad_offered'), started: count('ad_started'), completed: count('ad_completed') },
    store: { opened: count('store_opened'), initiated: count('purchase_initiated'), completed: count('purchase_completed'), failed: count('purchase_failed') },
    errors: count('client_error'),
  };
}

/** Money: measured vs estimated kept apart. Amounts are in minor units (kobo / cents). */
export function computeFinance(ledger, stats) {
  const kinds = ['ad_revenue', 'purchase_revenue', 'refund', 'platform_fee', 'hosting', 'ai', 'marketing', 'other_cost'];
  const by = (source) => {
    const o = Object.fromEntries(kinds.map((k) => [k, 0]));
    for (const l of ledger) if (l.source === source && o[l.kind] !== undefined) o[l.kind] += Number(l.amount_cents) || 0;
    const gross = o.ad_revenue + o.purchase_revenue;
    const costs = o.platform_fee + o.hosting + o.ai + o.marketing + o.other_cost;
    return { ...o, gross, net: gross - o.refund - costs };
  };
  const measured = by('measured');
  const estimate = by('estimate');
  const currencies = [...new Set(ledger.map((l) => l.currency))];
  const payers = stats?.store?.completed ?? 0;
  return {
    currencies,
    mixedCurrencies: currencies.length > 1,
    measured,
    estimate,
    perActivePlayer: stats?.mau ? measured.gross / stats.mau : null,
    perPayingPlayer: payers ? measured.purchase_revenue / payers : null,
    adEcpm: stats?.ads?.completed ? (measured.ad_revenue / stats.ads.completed) * 1000 : null,
    costPerNewPlayer: stats?.players ? measured.marketing / stats.players : null,
    hasMeasuredRevenue: measured.gross > 0,
    entries: ledger.length,
  };
}

function rate(a, b) { return b ? a / b : null; }
function avg(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }
function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

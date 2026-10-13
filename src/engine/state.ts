import { NPCS } from '../data/npcs.ts';
import { DAY_START, NPC_IDS } from '../types.ts';
import type { Effects, GameState, LogEntry, NpcId, Phase, StatKey } from '../types.ts';

/** Transient feedback for the UI (floating numbers, toasts). Never saved. */
export interface Feedback {
  text: string;
  tone: 'good' | 'bad' | 'neutral';
  npc?: NpcId;
}
export const feedback: Feedback[] = [];
export function drainFeedback(): Feedback[] {
  return feedback.splice(0, feedback.length);
}

export const STAT_LIMITS: Record<StatKey, [number, number]> = {
  cash: [0, 9_999_999],
  happiness: [0, 100],
  reputation: [0, 100],
  fuel: [0, 20],
  water: [0, 100],
  condition: [0, 100],
};

export const STAT_LABEL: Record<StatKey, string> = {
  cash: 'Cash',
  happiness: 'Mood',
  reputation: 'Reputation',
  fuel: 'Gen fuel',
  water: 'Water tank',
  condition: 'Compound',
};

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function naira(n: number): string {
  return '₦' + Math.round(n).toLocaleString('en-NG');
}

export function createState(playerName: string, seed = Math.floor(Math.random() * 2 ** 31)): GameState {
  const trust = {} as Record<NpcId, number>;
  for (const id of NPC_IDS) trust[id] = NPCS[id].baseTrust;
  const stats = { cash: 8000, happiness: 60, reputation: 30, fuel: 0, water: 45, condition: 55 };
  const s: GameState = {
    version: 1,
    seed,
    playerName: playerName.trim().slice(0, 18) || 'Tunde',
    day: 1,
    hour: DAY_START,
    stats,
    power: { genOn: false, disconnected: false, outages: [] },
    trust,
    flags: {},
    counters: {},
    bills: [],
    missions: {},
    log: [],
    dayStart: { stats: { ...stats }, trust: { ...trust } },
    firedToday: [],
    seenEvents: [],
    meetings: {},
    talkedToday: [],
    earnedTotal: 0,
    tutorialDone: false,
    todayRandom: null,
    ended: false,
    eventQueue: [],
    meetingPending: null,
  };
  return s;
}

export function phaseOf(hour: number): Phase {
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 20) return 'evening';
  return 'night';
}

export function nepaOn(s: GameState, hour = s.hour): boolean {
  if (s.power.disconnected) return false;
  return !s.power.outages.some(([a, b]) => hour >= a && hour < b);
}

export function hasPower(s: GameState): boolean {
  return nepaOn(s) || (s.power.genOn && s.stats.fuel > 0);
}

export function powerLabel(s: GameState): { label: string; tone: 'good' | 'warn' | 'bad' } {
  if (nepaOn(s)) return { label: 'NEPA light', tone: 'good' };
  if (s.power.genOn && s.stats.fuel > 0) return { label: 'Generator', tone: 'warn' };
  if (s.power.disconnected) return { label: 'Disconnected', tone: 'bad' };
  return { label: 'No light', tone: 'bad' };
}

export function fmtHour(h: number): string {
  const hh = Math.floor(h);
  const mm = h % 1 >= 0.5 ? '30' : '00';
  const ampm = hh >= 12 ? 'pm' : 'am';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${mm}${ampm}`;
}

export function addLog(s: GameState, text: string, kind: LogEntry['kind'] = 'info'): void {
  s.log.push({ day: s.day, hour: s.hour, text, kind });
  if (s.log.length > 300) s.log.splice(0, s.log.length - 300);
}

export function flag(s: GameState, f: string): boolean {
  return !!s.flags[f];
}

export function setFlag(s: GameState, f: string, v = true): void {
  if (v) s.flags[f] = true;
  else delete s.flags[f];
}

export function counter(s: GameState, c: string): number {
  return s.counters[c] ?? 0;
}

export function addTrust(s: GameState, id: NpcId, amount: number): void {
  if (!amount) return;
  // Reputation makes goodwill stick a little better.
  const scaled = amount > 0 ? amount * (0.85 + s.stats.reputation / 333) : amount;
  const v = Math.round(scaled);
  if (!v) return;
  s.trust[id] = clamp(s.trust[id] + v, 0, 100);
  feedback.push({ text: `${NPCS[id].short} ${v > 0 ? '♥ +' : '♥ '}${v}`, tone: v > 0 ? 'good' : 'bad', npc: id });
}

export function addStat(s: GameState, key: StatKey, amount: number, quiet = false): void {
  if (!amount) return;
  const [lo, hi] = STAT_LIMITS[key];
  const before = s.stats[key];
  s.stats[key] = clamp(Math.round((before + amount) * 100) / 100, lo, hi);
  const real = s.stats[key] - before;
  if (quiet || Math.abs(real) < 0.01) return;
  const text =
    key === 'cash'
      ? `${real > 0 ? '+' : '−'}${naira(Math.abs(real))}`
      : key === 'fuel'
        ? `${real > 0 ? '+' : '−'}${Math.abs(real)}L fuel`
        : `${STAT_LABEL[key]} ${real > 0 ? '+' : '−'}${Math.abs(Math.round(real))}`;
  feedback.push({ text, tone: real > 0 ? 'good' : 'bad' });
}

/** Can the player afford these effects? */
export function canAfford(s: GameState, e: Effects | undefined): boolean {
  return !e?.cash || e.cash >= 0 || s.stats.cash >= -e.cash;
}

/**
 * Apply effects to the state. Does NOT advance time — callers use Game.spend()
 * for that so that clock-driven events fire in one place.
 */
export function applyEffects(s: GameState, e: Effects | undefined): void {
  if (!e) return;
  for (const k of ['cash', 'happiness', 'reputation', 'fuel', 'water', 'condition'] as StatKey[]) {
    if (e[k]) addStat(s, k, e[k]!);
  }
  if (e.trustAll) for (const id of NPC_IDS) addTrust(s, id, e.trustAll);
  if (e.trust) for (const [id, v] of Object.entries(e.trust)) addTrust(s, id as NpcId, v!);
  e.flags?.forEach((f) => setFlag(s, f));
  e.unflags?.forEach((f) => setFlag(s, f, false));
  if (e.counters) for (const [c, v] of Object.entries(e.counters)) s.counters[c] = (s.counters[c] ?? 0) + v;
  if (e.gen === 'on') s.power.genOn = s.stats.fuel > 0;
  if (e.gen === 'off') s.power.genOn = false;
  if (e.log) addLog(s, e.log);
  e.run?.(s);
}

/** Describe effects compactly for choice buttons, e.g. "−₦1,000 · Amaka ♥+". */
export function describeEffects(e: Effects | undefined): string {
  if (!e) return '';
  const parts: string[] = [];
  if (e.time) parts.push(e.time >= 1 ? `${e.time}h` : `${e.time * 60}m`);
  if (e.cash) parts.push(`${e.cash > 0 ? '+' : '−'}${naira(Math.abs(e.cash))}`);
  if (e.fuel) parts.push(`${e.fuel > 0 ? '+' : '−'}${Math.abs(e.fuel)}L fuel`);
  if (e.water) parts.push(`Water ${e.water > 0 ? '+' : '−'}`);
  if (e.happiness) parts.push(`Mood ${e.happiness > 0 ? '+' : '−'}`);
  if (e.reputation) parts.push(`Rep ${e.reputation > 0 ? '+' : '−'}`);
  if (e.condition) parts.push(`Compound ${e.condition > 0 ? '+' : '−'}`);
  if (e.trustAll) parts.push(`Everyone ♥${e.trustAll > 0 ? '+' : '−'}`);
  if (e.trust)
    for (const [id, v] of Object.entries(e.trust)) parts.push(`${NPCS[id as NpcId].short} ♥${v! > 0 ? '+' : '−'}`);
  return parts.join(' · ');
}

export function trustTier(t: number): 'cold' | 'neutral' | 'warm' | 'close' {
  if (t < 35) return 'cold';
  if (t < 60) return 'neutral';
  if (t < 80) return 'warm';
  return 'close';
}

export function snapshot(s: GameState) {
  return { stats: { ...s.stats }, trust: { ...s.trust } };
}

// The Compound Meeting: a transparent, deterministic vote.
// Every resident's lean is a sum of visible parts; no dice are rolled.

import { motionById, type MotionDef, type MotionTerms } from '../data/meetings.ts';
import { NPCS } from '../data/npcs.ts';
import { NPC_IDS } from '../types.ts';
import type { GameState, NpcId, ValueKey } from '../types.ts';
import { addLog, addStat, addTrust, flag } from './state.ts';

export type Side = 'yes' | 'no' | 'none';

export interface MeetingSession {
  motionId: string;
  side: Side;
  movesLeft: number;
  amended: boolean;
  persuasion: Partial<Record<NpcId, number>>;
  pledged: NpcId[];
  tried: Partial<Record<NpcId, ValueKey[]>>;
  kemiRallied: boolean;
  walkedOut: boolean;
  notes: string[];
}

export interface LeanPart {
  label: string;
  value: number;
}

export interface Lean {
  npc: NpcId;
  total: number;
  vote: 'yes' | 'no';
  parts: LeanPart[];
}

export interface VoteResult {
  votes: Array<{ who: NpcId | 'you'; vote: 'yes' | 'no' }>;
  yes: number;
  no: number;
  passed: boolean;
  tieBreak: boolean;
  summary: string;
}

export function startMeeting(s: GameState, motionId: string): MeetingSession {
  return {
    motionId,
    side: 'none',
    movesLeft: (s.stats.reputation >= 60 ? 4 : 3) + (flag(s, 'insight') ? 1 : 0),
    amended: false,
    persuasion: {},
    pledged: [],
    tried: {},
    kemiRallied: false,
    walkedOut: false,
    notes: [],
  };
}

export function termsOf(m: MotionDef, session: MeetingSession): MotionTerms {
  return session.amended ? m.amendment.terms : m.terms;
}

/** Thrift changes with circumstances — a job or a brand deal makes a levy hurt less. */
export function effectiveThrift(s: GameState, id: NpcId): number {
  let t = NPCS[id].thrift;
  if (id === 'femi' && flag(s, 'femi_job')) t -= 1.5;
  if (id === 'tobi' && flag(s, 'tobi_deal')) t -= 1;
  return Math.max(0, t);
}

function repFactor(s: GameState): number {
  return 0.75 + s.stats.reputation / 200; // 0.75 .. 1.25
}

export function computeLean(s: GameState, session: MeetingSession, id: NpcId): Lean {
  const m = motionById(session.motionId);
  const t = termsOf(m, session);
  const npc = NPCS[id];
  const parts: LeanPart[] = [];

  let interest = 0;
  for (const [k, a] of Object.entries(t.appeals)) interest += npc.values[k as ValueKey] * (a ?? 0);
  parts.push({ label: 'What they think of the idea', value: Math.round(interest * 4) });

  if (id === 'chief') {
    if (t.chiefPain) parts.push({ label: 'His own money on the line', value: -t.chiefPain });
  } else if (t.costPerFlat > 0) {
    const pledgedFor = session.pledged.includes(id);
    const pain = pledgedFor ? 0 : (t.costPerFlat / 1000) * effectiveThrift(s, id) * 5;
    parts.push({ label: pledgedFor ? 'Cost (you pledged their share)' : 'Cost to their pocket', value: -Math.round(pain) });
  }

  const stake = t.stakes[id];
  if (stake) parts.push({ label: 'Personal stake', value: stake });

  const sign = session.side === 'yes' ? 1 : session.side === 'no' ? -1 : 0;
  if (sign) {
    const pull = Math.round(((s.trust[id] - 50) / 3) * repFactor(s));
    if (pull) parts.push({ label: pull > 0 ? 'Trusts you, follows your side' : 'Distrusts you, leans against you', value: sign * pull });
    const history = s.counters['mh_' + id] ?? 0;
    if (history) parts.push({ label: history > 0 ? 'Past meetings went well with you' : 'Old meeting grudge', value: sign * history });
    const p = session.persuasion[id] ?? 0;
    if (p) parts.push({ label: p > 0 ? 'Your arguments' : 'Your arguments backfired', value: sign * p });
  }

  const total = parts.reduce((a, b) => a + b.value, 0);
  return { npc: id, total, vote: total > 0 ? 'yes' : 'no', parts };
}

export function leanLabel(total: number): string {
  if (total >= 25) return 'Firm Yes';
  if (total > 8) return 'Leaning Yes';
  if (total > 0) return 'Wobbly Yes';
  if (total > -8) return 'Wobbly No';
  if (total > -25) return 'Leaning No';
  return 'Firm No';
}

export function chooseSide(session: MeetingSession, side: Side): void {
  session.side = side;
}

export interface MoveResult {
  ok: boolean;
  text: string;
}

export function persuade(s: GameState, session: MeetingSession, id: NpcId, value: ValueKey): MoveResult {
  if (session.movesLeft <= 0 || session.side === 'none') return { ok: false, text: 'No moves left.' };
  const tried = (session.tried[id] ??= []);
  if (tried.includes(value)) return { ok: false, text: `${NPCS[id].short} has already heard that argument.` };
  tried.push(value);
  session.movesLeft--;
  const v = NPCS[id].values[value];
  // Second and third arguments to the same person carry less weight.
  const fatigue = tried.length === 1 ? 1 : tried.length === 2 ? 0.6 : 0.35;
  const amount = Math.round(v * 6 * repFactor(s) * fatigue);
  session.persuasion[id] = (session.persuasion[id] ?? 0) + amount;
  const n = NPCS[id].short;
  const text =
    amount >= 12 ? `${n} nods slowly. "Hmm. You get point."` :
    amount > 0 ? `${n} considers it. "Okay... maybe."` :
    amount === 0 ? `${n} shrugs. That argument means nothing to them.` :
    `${n} frowns. "Is that supposed to convince me?" It backfired.`;
  session.notes.push(text);
  return { ok: true, text };
}

export function pledgeShare(s: GameState, session: MeetingSession, id: NpcId): MoveResult {
  const t = termsOf(motionById(session.motionId), session);
  if (session.movesLeft <= 0) return { ok: false, text: 'No moves left.' };
  if (session.side !== 'yes') return { ok: false, text: 'You can only cover shares for a motion you support.' };
  if (id === 'chief' || t.costPerFlat <= 0) return { ok: false, text: 'There is no share to cover here.' };
  if (session.pledged.includes(id)) return { ok: false, text: 'Already pledged.' };
  const committed = t.costPerFlat * (session.pledged.length + 2); // your share + existing + this one
  if (s.stats.cash < committed) return { ok: false, text: "You can't afford to cover another share." };
  session.pledged.push(id);
  session.movesLeft--;
  const text = `You pledge to cover ${NPCS[id].short}'s ₦${t.costPerFlat.toLocaleString()} share if it passes.`;
  session.notes.push(text);
  return { ok: true, text };
}

export function amend(s: GameState, session: MeetingSession): MoveResult {
  if (session.movesLeft <= 0) return { ok: false, text: 'No moves left.' };
  if (session.amended) return { ok: false, text: 'Already amended.' };
  if (session.pledged.length) return { ok: false, text: 'Amend before pledging money — the shares would change.' };
  session.amended = true;
  session.movesLeft--;
  addStat(s, 'reputation', 1);
  const text = 'Chief accepts your amendment. The motion on the floor has changed.';
  session.notes.push(text);
  return { ok: true, text };
}

export function kemiRally(s: GameState, session: MeetingSession): MoveResult {
  if (session.movesLeft <= 0 || session.side === 'none') return { ok: false, text: 'No moves left.' };
  if (session.kemiRallied) return { ok: false, text: 'Aunty Kemi already worked the room.' };
  if (s.trust.kemi < 65) return { ok: false, text: 'Aunty Kemi needs to trust you more (65+).' };
  session.kemiRallied = true;
  session.movesLeft--;
  for (const id of NPC_IDS) if (id !== 'kemi') session.persuasion[id] = (session.persuasion[id] ?? 0) + 5;
  session.persuasion.kemi = (session.persuasion.kemi ?? 0) + 10;
  const text = 'Aunty Kemi whispers into every ear in the courtyard. Opinions shift toward your side.';
  session.notes.push(text);
  return { ok: true, text };
}

export function walkOut(s: GameState, session: MeetingSession): void {
  session.walkedOut = true;
  session.side = 'none';
  session.movesLeft = 0;
  addStat(s, 'reputation', -4);
}

/** Pure tally (used for previews and tests). */
export function tally(s: GameState, session: MeetingSession): VoteResult {
  const votes: VoteResult['votes'] = NPC_IDS.map((id) => ({ who: id, vote: computeLean(s, session, id).vote }));
  if (session.side !== 'none') votes.push({ who: 'you', vote: session.side });
  const yes = votes.filter((v) => v.vote === 'yes').length;
  const no = votes.length - yes;
  let passed = yes > no;
  let tieBreak = false;
  if (yes === no) {
    tieBreak = true;
    passed = computeLean(s, session, 'chief').vote === 'yes';
  }
  return { votes, yes, no, passed, tieBreak, summary: '' };
}

/** Run the vote and apply all consequences. */
export function resolveMeeting(s: GameState, session: MeetingSession): VoteResult {
  const m = motionById(session.motionId);
  const r = tally(s, session);
  r.summary = r.passed ? m.onPass(s, session.amended, session.pledged) : m.onFail(s, session.amended);

  if (session.side !== 'none') {
    const won = (session.side === 'yes') === r.passed;
    addStat(s, 'reputation', won ? 6 : -1);
    addStat(s, 'happiness', won ? 6 : -4);
    for (const v of r.votes) {
      if (v.who === 'you') continue;
      const agreed = v.vote === session.side;
      s.counters['mh_' + v.who] = Math.max(-8, Math.min(8, (s.counters['mh_' + v.who] ?? 0) + (agreed ? 2 : won ? -2 : 0)));
      if (agreed) addTrust(s, v.who, 2);
    }
  }

  s.meetings[m.id] = {
    passed: r.passed,
    playerSide: session.side,
    yes: r.yes,
    no: r.no,
    amended: session.amended,
  };
  addLog(s, `Meeting "${m.title}": ${r.passed ? 'PASSED' : 'FAILED'} ${r.yes}–${r.no}.`, 'meeting');
  return r;
}

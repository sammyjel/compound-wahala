// Core shared types. Pure data — no DOM, no rendering.

export type NpcId = 'chief' | 'kemi' | 'amaka' | 'femi' | 'bisi' | 'tobi';
export const NPC_IDS: NpcId[] = ['chief', 'kemi', 'amaka', 'femi', 'bisi', 'tobi'];

export type StatKey = 'cash' | 'happiness' | 'reputation' | 'fuel' | 'water' | 'condition';
export type Phase = 'morning' | 'afternoon' | 'evening' | 'night';

/** What a resident cares about. Used by dialogue, persuasion and meeting votes. */
export type ValueKey = 'money' | 'fairness' | 'order' | 'peace' | 'fun' | 'business' | 'respect';
export const VALUE_KEYS: ValueKey[] = ['money', 'fairness', 'order', 'peace', 'fun', 'business', 'respect'];

/** A spoken line. `plain` is an optional plain-English version of Pidgin/slang. */
export interface Line {
  who: 'npc' | 'you' | 'narrator' | NpcId;
  text: string;
  plain?: string;
}

export interface Effects {
  cash?: number;
  happiness?: number;
  reputation?: number;
  fuel?: number;
  water?: number;
  condition?: number;
  trust?: Partial<Record<NpcId, number>>;
  trustAll?: number;
  flags?: string[];
  unflags?: string[];
  counters?: Record<string, number>;
  /** Hours consumed. */
  time?: number;
  gen?: 'on' | 'off';
  log?: string;
  /** Escape hatch for special logic. Must be deterministic. */
  run?: (s: GameState) => void;
}

export interface Look {
  skin: string;
  hair: 'short' | 'afro' | 'puff' | 'bald' | 'low' | 'braids';
  hairColor: string;
  top: string;
  topAccent?: string;
  bottom: string;
  shoes: string;
  build: 'slim' | 'medium' | 'round';
  height: number; // 0.9 – 1.1
  dress?: boolean;
  acc: Array<'glasses' | 'shades' | 'headphones' | 'redcap' | 'beads' | 'cane' | 'gele' | 'headtie' | 'apron' | 'nursecap' | 'beard' | 'chain' | 'phone' | 'grey'>;
}

export interface NpcDef {
  id: NpcId;
  name: string;
  short: string;
  role: string;
  room: string;
  bio: string;
  look: Look;
  values: Record<ValueKey, number>; // -3 .. +3
  /** 0..3, how much a money cost hurts their vote. Landlord pays no tenant shares. */
  thrift: number;
  baseTrust: number;
  /** One-line hint revealed when you learn what they care about. */
  caresAbout: string;
  /** Where they are per phase. 'inside' = in their room (can knock), 'away' = out of compound. */
  routine: Record<Phase, string>;
  /** Behaviour when a shared bill is due. */
  payStyle: 'early' | 'ontime' | 'late' | 'never' | 'exempt';
}

export interface Bill {
  id: string;
  name: string;
  perFlat: number;
  dueDay: number;
  issuedDay: number;
  /** Who owes: 'you' plus NPC ids. */
  paid: Record<string, boolean>;
  status: 'open' | 'settled' | 'overdue';
}

export type MissionStatus = 'locked' | 'active' | 'done' | 'failed';

export interface LogEntry {
  day: number;
  hour: number;
  text: string;
  kind: 'info' | 'good' | 'bad' | 'money' | 'mission' | 'event' | 'meeting';
}

export interface StatSnapshot {
  stats: Record<StatKey, number>;
  trust: Record<NpcId, number>;
}

export interface MeetingRecord {
  passed: boolean;
  playerSide: 'yes' | 'no' | 'none';
  yes: number;
  no: number;
  amended: boolean;
}

export interface GameState {
  version: 1;
  seed: number;
  playerName: string;
  day: number;
  hour: number;
  stats: Record<StatKey, number>;
  power: { genOn: boolean; disconnected: boolean; outages: Array<[number, number]> };
  trust: Record<NpcId, number>;
  flags: Record<string, boolean>;
  counters: Record<string, number>;
  bills: Bill[];
  missions: Record<string, MissionStatus>;
  log: LogEntry[];
  dayStart: StatSnapshot;
  /** Scheduled event ids already fired today. */
  firedToday: string[];
  seenEvents: string[];
  meetings: Record<string, MeetingRecord>;
  talkedToday: NpcId[];
  earnedTotal: number;
  tutorialDone: boolean;
  /** Day-level random event chosen for today (id + hour), seeded. */
  todayRandom: { id: string; at: number } | null;
  ended: boolean;
  /** Pending queue of event ids the UI must show. */
  eventQueue: string[];
  /** Pending meeting id the UI must open. */
  meetingPending: string | null;
}

export const LAST_DAY = 7;
export const DAY_START = 7;
export const DAY_END = 22;

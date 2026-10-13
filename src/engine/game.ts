// The game rules in one place. UI-agnostic: the DOM layer calls these methods
// and renders whatever comes back. Everything here is deterministic given the seed.

import { ACTIONS, actionsFor, markAction, type ActionDef, type ObjId } from '../data/actions.ts';
import { KNOCK, markTopic, OPENERS, resolveLines, topicById, topicsFor, type Topic } from '../data/dialogue.ts';
import { DAY_SCRIPT, eventById, RANDOM_POOL, type EventDef } from '../data/events.ts';
import { MOTIONS, type MotionDef } from '../data/meetings.ts';
import { MISSIONS, type MissionDef } from '../data/missions.ts';
import { NPCS } from '../data/npcs.ts';
import { DAY_END, DAY_START, LAST_DAY, NPC_IDS } from '../types.ts';
import type { GameState, Line, NpcId, StatKey } from '../types.ts';
import { createBill, processBillsEndOfDay } from './bills.ts';
import { dayRng, pick } from './rng.ts';
import {
  addLog, addStat, addTrust, applyEffects, createState, describeEffects, feedback, flag, nepaOn,
  phaseOf, setFlag, snapshot, trustTier,
} from './state.ts';

export interface Notice {
  kind: 'mission-new' | 'mission-done' | 'mission-failed' | 'power' | 'info';
  title: string;
  text: string;
}

export interface ChoiceView {
  label: string;
  plain?: string;
  hint: string;
  disabled: string | null;
}

export interface TalkOpen {
  ok: boolean;
  message?: string;
  opener?: Line;
  topics: Topic[];
}

export interface DaySummary {
  day: number;
  statDeltas: Array<{ key: StatKey; from: number; to: number }>;
  trustDeltas: Array<{ npc: NpcId; from: number; to: number }>;
  log: string[];
  missionsDone: string[];
  tomorrow: string[];
  final: boolean;
}

export type NpcWhere = { status: 'here'; spot: string } | { status: 'inside' } | { status: 'away' };

export class Game {
  s: GameState;
  notices: Notice[] = [];

  constructor(state: GameState) {
    this.s = state;
  }

  static create(name: string, seed?: number): Game {
    const g = new Game(createState(name, seed));
    g.beginDay(true);
    return g;
  }

  // ─────────────────────────── Queries ───────────────────────────

  npcWhere(id: NpcId): NpcWhere {
    const spot = NPCS[id].routine[phaseOf(this.s.hour)];
    if (spot === 'away') return { status: 'away' };
    if (spot === 'inside') return { status: 'inside' };
    if (id === 'femi' && flag(this.s, 'femi_job') && phaseOf(this.s.hour) === 'afternoon') return { status: 'away' };
    return { status: 'here', spot };
  }

  topics(id: NpcId): Topic[] {
    return topicsFor(this.s, id);
  }

  actions(obj: ObjId): ActionDef[] {
    return actionsFor(this.s, obj);
  }

  hoursLeft(): number {
    return DAY_END - this.s.hour;
  }

  motionToday(): MotionDef | undefined {
    return MOTIONS.find((m) => m.day === this.s.day && !this.s.meetings[m.id]);
  }

  // ─────────────────────────── Time ───────────────────────────

  /** Advance the clock in half-hour steps, ticking the world. */
  spend(hours: number): void {
    const steps = Math.round(hours * 2);
    for (let i = 0; i < steps && this.s.hour < DAY_END; i++) this.tick();
    this.queueDueEvents();
    this.checkMeeting();
    this.checkMissions();
  }

  private tick(): void {
    const s = this.s;
    const wasNepa = nepaOn(s);
    s.hour += 0.5;
    const isNepa = nepaOn(s);
    const ph = phaseOf(s.hour);

    if (wasNepa && !isNepa) {
      addLog(s, 'NEPA took the light.', 'bad');
      this.notices.push({ kind: 'power', title: 'Light don go!', text: 'NEPA took the light.' });
    }
    if (!wasNepa && isNepa) {
      addLog(s, 'UP NEPA! Power is back.', 'good');
      this.notices.push({ kind: 'power', title: 'UP NEPA!', text: 'Public power is back.' });
      if (s.power.genOn) {
        s.power.genOn = false;
        addLog(s, 'Generator switched off to save fuel.');
      }
    }

    // Fuel Fund: someone starts the gen automatically in the evening.
    if (flag(s, 'fuel_fund') && (ph === 'evening' || ph === 'night') && !isNepa && !s.power.genOn && s.stats.fuel > 0) {
      s.power.genOn = true;
      addLog(s, 'The Fuel Fund generator kicked in for the evening.', 'good');
    }

    if (s.power.genOn && !isNepa) {
      s.stats.fuel = Math.max(0, s.stats.fuel - 0.5);
      if (s.stats.fuel <= 0) {
        s.power.genOn = false;
        addLog(s, 'The generator coughed and died. Fuel finished.', 'bad');
        this.notices.push({ kind: 'power', title: 'Gen don off!', text: 'The generator ran out of fuel.' });
      }
    }

    const powered = isNepa || s.power.genOn;
    s.stats.water = Math.max(0, s.stats.water - (flag(s, 'visitor_here') ? 1.1 : 0.75));
    s.stats.condition = Math.max(0, s.stats.condition - (flag(s, 'goat_here') ? 0.4 : 0.1));
    if (!powered && (ph === 'evening' || ph === 'night')) addStat(s, 'happiness', -0.5, true);
    if (s.stats.water <= 0) addStat(s, 'happiness', -0.5, true);
  }

  private queueDueEvents(): void {
    const s = this.s;
    const due: string[] = [];
    for (const e of DAY_SCRIPT[s.day] ?? []) if (e.at <= s.hour && !s.firedToday.includes(e.id)) due.push(e.id);
    if (s.todayRandom && s.todayRandom.at <= s.hour && !s.firedToday.includes(s.todayRandom.id)) due.push(s.todayRandom.id);
    if (s.stats.water <= 12 && !s.firedToday.includes('water_shortage')) due.push('water_shortage');
    for (const id of due) {
      s.firedToday.push(id);
      const ev = eventById(id);
      if (ev.cond && !ev.cond(s)) continue;
      ev.onFire?.(s);
      if (!s.seenEvents.includes(id)) s.seenEvents.push(id);
      s.eventQueue.push(id);
    }
  }

  private checkMeeting(): void {
    const m = this.motionToday();
    if (m && this.s.hour >= 18 && !this.s.meetingPending) this.s.meetingPending = m.id;
  }

  /** Called when the player wants to end the day early on a meeting day. */
  callMeetingNow(): void {
    const m = this.motionToday();
    if (!m) return;
    if (this.s.hour < 18) this.spend(18 - this.s.hour);
    this.s.meetingPending = m.id;
  }

  afterMeeting(): void {
    this.s.meetingPending = null;
    if (this.s.hour < 20) this.spend(20 - this.s.hour);
    this.checkMissions();
  }

  // ─────────────────────────── Events ───────────────────────────

  currentEvent(): EventDef | null {
    const id = this.s.eventQueue[0];
    return id ? eventById(id) : null;
  }

  eventChoices(ev: EventDef): ChoiceView[] {
    return ev.choices.map((c) => ({ label: c.label, plain: c.plain, hint: describeEffects(c.effects), disabled: c.blocked?.(this.s) ?? null }));
  }

  chooseEvent(idx: number): string {
    const ev = this.currentEvent();
    if (!ev) return '';
    const c = ev.choices[idx];
    if (!c || c.blocked?.(this.s)) return '';
    this.s.eventQueue.shift();
    applyEffects(this.s, c.effects);
    addLog(this.s, `${ev.title}: ${c.label.replace(/"/g, '')}`, 'event');
    if (c.effects?.time) this.spend(c.effects.time);
    else this.checkMissions();
    return c.result;
  }

  // ─────────────────────────── Talking ───────────────────────────

  openTalk(id: NpcId): TalkOpen {
    const s = this.s;
    const where = this.npcWhere(id);
    if (where.status === 'away') {
      return { ok: false, message: `${NPCS[id].short} is out of the compound right now.`, topics: [] };
    }
    let message: string | undefined;
    if (where.status === 'inside') {
      const k = KNOCK[id];
      message = k.text;
      const knockFlag = `knock_${id}_d${s.day}_${phaseOf(s.hour)}`;
      if (!flag(s, knockFlag)) {
        setFlag(s, knockFlag);
        if (k.trust) addTrust(s, id, k.trust);
      }
      if (!k.canTalk) return { ok: false, message, topics: [] };
    }
    if (!s.talkedToday.includes(id)) s.talkedToday.push(id);
    const tier = trustTier(s.trust[id]);
    const opener = flag(s, 'met_' + id) ? OPENERS[id][tier] : undefined;
    return { ok: true, message, opener, topics: this.topics(id) };
  }

  /** Start a topic. Applies the topic's own effects and time. */
  runTopic(topicId: string): { lines: Line[]; choices: ChoiceView[]; error?: string } {
    const s = this.s;
    const t = topicById(topicId);
    if (!t) return { lines: [], choices: [], error: 'Unknown topic' };
    const time = t.time ?? 0.5;
    if (s.hour + time > DAY_END) return { lines: [], choices: [], error: 'Not enough time left today.' };
    if (t.effects?.cash && t.effects.cash < 0 && s.stats.cash < -t.effects.cash) return { lines: [], choices: [], error: 'Not enough cash.' };
    markTopic(s, t);
    const lines = resolveLines(s, t.lines);
    applyEffects(s, t.effects);
    this.spend(time);
    const choices: ChoiceView[] = (t.choices ?? [])
      .filter((c) => !c.cond || c.cond(s))
      .map((c) => ({ label: c.label, plain: c.plain, hint: describeEffects(c.effects), disabled: c.blocked?.(s) ?? null }));
    return { lines, choices };
  }

  chooseTopic(topicId: string, idx: number): Line[] {
    const s = this.s;
    const t = topicById(topicId);
    if (!t?.choices) return [];
    const visible = t.choices.filter((c) => !c.cond || c.cond(s));
    const c = visible[idx];
    if (!c || c.blocked?.(s)) return [];
    applyEffects(s, c.effects);
    this.checkMissions();
    return resolveLines(s, c.reply);
  }

  // ─────────────────────────── Actions ───────────────────────────

  doAction(id: string): { ok: boolean; text: string } {
    const s = this.s;
    const a = ACTIONS.find((x) => x.id === id);
    if (!a) return { ok: false, text: 'Unknown action' };
    if (a.cond && !a.cond(s)) return { ok: false, text: 'Not available right now.' };
    const block = a.blocked?.(s);
    if (block) return { ok: false, text: block };
    if (s.hour + a.time > DAY_END) return { ok: false, text: 'Not enough time left today.' };
    markAction(s, a);
    const pay = a.pay ? a.pay(s) : 0;
    applyEffects(s, a.effects);
    const text = typeof a.result === 'function' ? a.result(s) : a.result;
    if (pay) {
      addStat(s, 'cash', pay);
      s.earnedTotal += pay;
      addLog(s, `Earned ${'₦' + pay.toLocaleString()} (${a.label(s).split('(')[0].trim()}).`, 'money');
    }
    this.spend(a.time);
    if (!a.time) this.checkMissions();
    return { ok: true, text };
  }

  // ─────────────────────────── Missions ───────────────────────────

  checkMissions(): void {
    const s = this.s;
    for (let pass = 0; pass < 3; pass++) {
      let changed = false;
      for (const m of MISSIONS) {
        const st = s.missions[m.id] ?? 'locked';
        if (st === 'locked' && m.unlock(s)) {
          s.missions[m.id] = 'active';
          changed = true;
          if (!m.objectives.every((o) => o.done(s))) {
            this.notices.push({ kind: 'mission-new', title: 'New mission', text: m.title });
            addLog(s, `New mission: ${m.title}`, 'mission');
          }
        }
        if (s.missions[m.id] === 'active') {
          if (m.objectives.every((o) => o.done(s))) {
            this.complete(m);
            changed = true;
          } else if (m.fail?.(s)) {
            s.missions[m.id] = 'failed';
            this.notices.push({ kind: 'mission-failed', title: 'Mission failed', text: `${m.title}: ${m.failText ?? ''}` });
            addLog(s, `Mission failed: ${m.title}`, 'bad');
            changed = true;
          }
        }
      }
      if (!changed) break;
    }
  }

  private complete(m: MissionDef): void {
    const s = this.s;
    s.missions[m.id] = 'done';
    setFlag(s, `mdone_${m.id}_d${s.day}`);
    applyEffects(s, m.reward);
    this.notices.push({ kind: 'mission-done', title: `Mission complete: ${m.title}`, text: m.rewardText });
    addLog(s, `Mission complete: ${m.title}`, 'mission');
  }

  // ─────────────────────────── Day cycle ───────────────────────────

  private scheduleOutages(): void {
    const s = this.s;
    if (s.day === 1) {
      s.power.outages = [[9, 15], [18.5, 23]];
      return;
    }
    const r = dayRng(s.seed, s.day, 1);
    const out: Array<[number, number]> = [];
    const start = 8 + Math.floor(r() * 14) / 2; // 8:00 – 14:30
    out.push([start, start + 2 + Math.floor(r() * 7) / 2]);
    if (r() < 0.65) {
      const ev = 18 + Math.floor(r() * 5) / 2;
      out.push([ev, 23]);
    }
    s.power.outages = out;
  }

  private pickRandomEvent(): void {
    const s = this.s;
    if (s.day === 1) {
      s.todayRandom = null;
      return;
    }
    const r = dayRng(s.seed, s.day, 2);
    const scripted = (DAY_SCRIPT[s.day] ?? []).map((e) => e.id);
    let pool = RANDOM_POOL.filter((id) => !scripted.includes(id) && id !== 'water_shortage');
    const unseen = pool.filter((id) => !s.seenEvents.includes(id));
    if (unseen.length) pool = unseen;
    s.todayRandom = { id: pick(r, pool), at: 10 + Math.floor(r() * 12) / 2 };
  }

  /** Set up a fresh day. `first` for Day 1. */
  private beginDay(first = false): void {
    const s = this.s;
    s.hour = DAY_START;
    s.firedToday = [];
    s.talkedToday = [];
    s.eventQueue = [];
    s.meetingPending = null;
    s.power.genOn = false;
    this.scheduleOutages();
    this.pickRandomEvent();

    if (!first) {
      if (flag(s, 'fuel_fund')) {
        const per = flag(s, 'fuel_fund_small') ? 500 : 1000;
        addStat(s, 'fuel', flag(s, 'fuel_fund_small') ? 2 : 3, true);
        addLog(s, `The Fuel Fund bought ${flag(s, 'fuel_fund_small') ? 2 : 3}L of fuel.`, 'good');
        if (s.day % 2 === 1) {
          addStat(s, 'cash', -Math.min(per, s.stats.cash), true);
          addLog(s, `Fuel Fund contribution: −₦${per.toLocaleString()}.`, 'money');
        }
      }
      if (flag(s, 'visitor_here')) addStat(s, 'water', -8, true);
      if (flag(s, 'refuse_pile') && !flag(s, 'waste_settled')) addStat(s, 'condition', -5, true);
      if (flag(s, 'loud_nights') && !flag(s, 'tobi_headphones')) {
        addStat(s, 'happiness', -4, true);
        addLog(s, "Tobi's speaker kept you up. Mood −4.", 'bad');
      }
      if (flag(s, 'amaka_helped')) addStat(s, 'happiness', 2, true);
      if (s.day === 4) createBill(s, 'waste', 'Refuse (PSP) bill', 1000, 6);
      if (s.day === 6 && flag(s, 'femi_loan')) {
        const back = flag(s, 'femi_job') ? 4000 : 1500;
        addStat(s, 'cash', back, true);
        setFlag(s, 'femi_loan', false);
        addLog(s, flag(s, 'femi_job') ? 'Femi repaid your loan: ₦4,000 — with interest, from his rider wages!' : 'Femi repaid ₦1,500 of your ₦3,000 loan. "The rest is coming."', flag(s, 'femi_job') ? 'good' : 'bad');
        if (!flag(s, 'femi_job')) addTrust(s, 'femi', -2);
      }
    }
    s.dayStart = snapshot(s);
    addLog(s, `Day ${s.day} begins.`);
    this.queueDueEvents();
    this.checkMissions();
    feedback.length = 0;
  }

  /** Close the day: bills, consequences, summary. */
  endDay(): DaySummary {
    const s = this.s;
    if (s.hour < DAY_END) s.hour = DAY_END;
    processBillsEndOfDay(s);
    this.checkMissions();

    const keys: StatKey[] = ['cash', 'happiness', 'reputation', 'fuel', 'water', 'condition'];
    const statDeltas = keys.map((key) => ({ key, from: s.dayStart.stats[key], to: s.stats[key] }));
    const trustDeltas = NPC_IDS.map((npc) => ({ npc, from: s.dayStart.trust[npc], to: s.trust[npc] }));
    const log = s.log
      .filter((l) => l.day === s.day && l.text !== `Day ${s.day} begins.` && !l.text.startsWith('New mission:'))
      .map((l) => l.text);
    const missionsDone = MISSIONS.filter((m) => flag(s, `mdone_${m.id}_d${s.day}`)).map((m) => m.title);

    const tomorrow: string[] = [];
    const next = s.day + 1;
    if (s.day < LAST_DAY) {
      const motion = MOTIONS.find((m) => m.day === next);
      if (motion) tomorrow.push(`Compound meeting at 6pm: "${motion.title}"`);
      for (const b of s.bills) {
        if (b.status === 'settled') continue;
        if (b.status === 'overdue') tomorrow.push(`${b.name} is OVERDUE — pay at the meter.`);
        else if (b.dueDay === next) tomorrow.push(`${b.name} is due tomorrow.`);
      }
      if (s.stats.water < 30) tomorrow.push('The water tank is low — pump it while there is power.');
      if (flag(s, 'skit_filmed') && !flag(s, 'tobi_deal')) tomorrow.push("Check Tobi's skit views in the morning...");
    }

    const final = s.day >= LAST_DAY;
    if (final) s.ended = true;
    return { day: s.day, statDeltas, trustDeltas, log, missionsDone, tomorrow, final };
  }

  nextDay(): void {
    if (this.s.ended) return;
    this.s.day += 1;
    this.beginDay(false);
  }
}

/** Score + title for the results screen. */
export function finalResults(s: GameState) {
  const done = MISSIONS.filter((m) => s.missions[m.id] === 'done');
  const avgTrust = NPC_IDS.reduce((a, id) => a + s.trust[id], 0) / NPC_IDS.length;
  const wins = Object.values(s.meetings).filter((m) => m.playerSide !== 'none' && (m.playerSide === 'yes') === m.passed).length;
  const score = Math.round(
    s.stats.reputation * 2 + avgTrust * 2 + s.stats.condition + s.stats.happiness + done.length * 15 + wins * 10 + Math.min(40, s.stats.cash / 500),
  );
  let title = 'Quiet Tenant';
  let blurb = 'You kept your head down. Nobody knows your surname, and maybe that is fine.';
  if (s.stats.reputation >= 70 && avgTrust >= 65) {
    title = 'Compound Chairman';
    blurb = 'People bring you their wahala before they bring it to Chief. Unity Compound finally lives up to its name.';
  } else if (avgTrust >= 65) {
    title = 'Everybody\'s Favourite';
    blurb = 'Everybody likes you. You are invited to every birthday, and you know everyone\'s WiFi password.';
  } else if (wins >= 3) {
    title = 'Meeting Strategist';
    blurb = 'You read the room, count the votes and win. Femi calls you "Senator".';
  } else if (s.stats.cash >= 20000) {
    title = 'Hustler of Adebayo Close';
    blurb = 'Money in the bank, phones fixed, deadlines met. Relationships... a work in progress.';
  } else if (avgTrust < 40) {
    title = 'Wahala Magnet';
    blurb = 'Somehow, every fight in the compound had your name in it. There is always next week.';
  }
  return { score, title, blurb, done, avgTrust, wins };
}

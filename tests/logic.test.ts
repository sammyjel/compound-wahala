// Headless rules tests. Run: npm test  (Node 22.6+ strips TS types natively)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game, finalResults } from '../src/engine/game.ts';
import { amend, chooseSide, computeLean, persuade, resolveMeeting, startMeeting, tally } from '../src/engine/meeting.ts';
import { getBill, payShare } from '../src/engine/bills.ts';
import { NPC_IDS } from '../src/types.ts';
import type { NpcId } from '../src/types.ts';

function clearEvents(g: Game) {
  let guard = 0;
  while (g.currentEvent() && guard++ < 20) {
    const ev = g.currentEvent()!;
    const idx = g.eventChoices(ev).findIndex((v) => !v.disabled);
    g.chooseEvent(idx);
  }
}

function meetAll(g: Game) {
  for (const id of NPC_IDS) {
    const open = g.openTalk(id);
    if (!open.ok) continue;
    const intro = open.topics.find((t) => t.kind === 'intro');
    if (intro) {
      g.runTopic(intro.id);
      g.chooseTopic(intro.id, 0);
    }
  }
}

function runMeeting(g: Game, side: 'yes' | 'no' | 'none' = 'yes') {
  if (!g.s.meetingPending) return;
  const m = startMeeting(g.s, g.s.meetingPending);
  chooseSide(m, side);
  resolveMeeting(g.s, m);
  g.afterMeeting();
}

test('new game starts on Day 1 with the arrival event and core missions', () => {
  const g = Game.create('Ada', 1234);
  assert.equal(g.s.day, 1);
  assert.equal(g.s.hour, 7);
  assert.equal(g.currentEvent()?.id, 'arrival');
  assert.equal(g.s.missions['m_welcome'], 'active');
  assert.equal(g.s.missions['m_hustle'], 'active');
});

test('meeting residents completes the welcome mission and changes trust', () => {
  const g = Game.create('Ada', 1);
  clearEvents(g);
  const before = g.s.trust.kemi;
  meetAll(g);
  assert.equal(g.npcWhere('femi').status, 'away', 'Femi is out hustling in the morning');
  g.spend(5); // afternoon: Femi is at the gate
  clearEvents(g);
  meetAll(g);
  const met = NPC_IDS.filter((id) => g.s.flags['met_' + id]);
  assert.equal(met.length, 6, 'met: ' + met.join(','));
  assert.ok(g.s.trust.kemi > before);
  assert.equal(g.s.missions['m_welcome'], 'done');
});

test('power cut -> buy fuel -> start generator completes Light Off mission', () => {
  const g = Game.create('Ada', 2);
  clearEvents(g);
  g.spend(2.5);
  assert.ok(g.s.seenEvents.includes('nepa_cut'));
  clearEvents(g);
  assert.equal(g.s.missions['m_light'], 'active');
  assert.equal(g.doAction('genon').ok, false, 'gen should not start without fuel');
  assert.ok(g.doAction('fuel3').ok);
  assert.equal(g.s.stats.fuel, 3);
  assert.ok(g.doAction('genon').ok);
  assert.equal(g.s.power.genOn, true);
  assert.equal(g.s.missions['m_light'], 'done');
});

test('jobs earn money and count toward Hustle', () => {
  const g = Game.create('Ada', 3);
  clearEvents(g);
  const cash = g.s.stats.cash;
  assert.ok(g.doAction('repair').ok);
  assert.ok(g.s.stats.cash > cash);
  assert.ok(g.s.earnedTotal > 0);
  assert.equal(g.s.hour, 10);
});

test('meeting triggers at 6pm on Day 1; votes are deterministic and explained', () => {
  const g = Game.create('Ada', 4);
  clearEvents(g);
  g.spend(11);
  clearEvents(g);
  assert.equal(g.s.meetingPending, 'fuel_fund');
  const m = startMeeting(g.s, 'fuel_fund');
  chooseSide(m, 'yes');
  for (const id of NPC_IDS) {
    const l = computeLean(g.s, m, id);
    assert.equal(l.total, l.parts.reduce((a, p) => a + p.value, 0));
  }
  assert.deepEqual(tally(g.s, m), tally(g.s, m));
  const femiBefore = computeLean(g.s, m, 'femi').total;
  persuade(g.s, m, 'femi', 'money');
  assert.ok(computeLean(g.s, m, 'femi').total > femiBefore, 'money argument should move Femi');
  const tobiBefore = computeLean(g.s, m, 'tobi').total;
  persuade(g.s, m, 'tobi', 'order');
  assert.ok(computeLean(g.s, m, 'tobi').total < tobiBefore, 'order argument should backfire on Tobi');
  const r = resolveMeeting(g.s, m);
  assert.equal(r.yes + r.no, 7);
  g.afterMeeting();
  assert.equal(g.s.meetingPending, null);
  assert.ok(g.s.hour >= 20);
  assert.ok(g.s.meetings['fuel_fund']);
});

test('NEPA bill: ignoring Femi and Tobi gets the compound disconnected', () => {
  const g = Game.create('Ada', 5);
  for (let d = 1; d <= 3; d++) {
    clearEvents(g);
    if (d === 1) {
      g.spend(4.5);
      clearEvents(g);
      payShare(g.s, 'nepa', 'you');
    }
    if (g.motionToday()) g.callMeetingNow();
    clearEvents(g);
    runMeeting(g);
    g.endDay();
    if (d < 3) g.nextDay();
  }
  const b = getBill(g.s, 'nepa')!;
  assert.equal(b.status, 'overdue');
  assert.equal(b.paid.amaka, true);
  assert.equal(b.paid.femi, false);
  assert.equal(g.s.power.disconnected, true);
  assert.equal(g.s.missions['m_nepa'], 'failed');
  g.s.stats.cash = 50000;
  for (const w of ['femi', 'tobi', 'kemi', 'bisi']) payShare(g.s, 'nepa', w);
  assert.equal(b.status, 'settled');
  assert.equal(g.s.power.disconnected, false);
});

test('NEPA bill: Femi gets a job and Tobi promises -> settled on time', () => {
  const g = Game.create('Ada', 6);
  clearEvents(g);
  meetAll(g);
  g.spend(4);
  clearEvents(g);
  payShare(g.s, 'nepa', 'you');
  g.s.flags['femi_job'] = true;
  g.s.flags['tobi_will_pay_nepa'] = true;
  g.callMeetingNow();
  clearEvents(g);
  runMeeting(g);
  g.endDay();
  g.nextDay();
  clearEvents(g);
  g.endDay();
  g.nextDay();
  clearEvents(g);
  assert.equal(getBill(g.s, 'nepa')!.status, 'settled');
  assert.equal(g.s.missions['m_nepa'], 'done');
});

test('state survives a JSON save/load round trip', () => {
  const g = Game.create('Ada', 7);
  clearEvents(g);
  meetAll(g);
  g.doAction('repair');
  const g2 = new Game(JSON.parse(JSON.stringify(g.s)));
  assert.deepEqual(g2.s, g.s);
});

function scriptedRun(seed: number) {
  const g = Game.create('Ada', seed);
  for (let d = 1; d <= 7; d++) {
    clearEvents(g);
    if (d === 1) meetAll(g);
    g.doAction('repair');
    clearEvents(g);
    g.doAction('sweep');
    clearEvents(g);
    if (g.motionToday()) g.callMeetingNow();
    clearEvents(g);
    runMeeting(g);
    clearEvents(g);
    const sum = g.endDay();
    assert.equal(sum.day, d);
    if (d < 7) g.nextDay();
    else assert.equal(sum.final, true);
  }
  return g;
}

test('same seed + same actions = same game (no hidden randomness)', () => {
  assert.deepEqual(scriptedRun(99).s, scriptedRun(99).s);
});

test('a full 7-day playthrough ends with results', () => {
  const g = scriptedRun(42);
  assert.equal(g.s.ended, true);
  assert.equal(Object.keys(g.s.meetings).length, 4);
  const r = finalResults(g.s);
  assert.ok(r.score > 0 && r.title.length > 0);
});

test('amendment changes the motion and is reflected in leans', () => {
  const g = Game.create('Ada', 8);
  const m = startMeeting(g.s, 'borehole');
  chooseSide(m, 'yes');
  const tobi = computeLean(g.s, m, 'tobi').total;
  const chief = computeLean(g.s, m, 'chief').total;
  amend(g.s, m);
  assert.ok(computeLean(g.s, m, 'tobi').total > tobi, 'cheaper motion should please Tobi');
  assert.ok(computeLean(g.s, m, 'chief').total < chief, 'Chief pays more under the amendment');
});

test('calibration printout of baseline leans', () => {
  const g = Game.create('Ada', 9);
  for (const id of ['fuel_fund', 'borehole', 'quiet_hours', 'levy']) {
    for (const side of ['none', 'yes', 'no'] as const) {
      const m = startMeeting(g.s, id);
      chooseSide(m, side);
      const leans = NPC_IDS.map((n: NpcId) => `${n}:${computeLean(g.s, m, n).total}`).join(' ');
      console.log(`  ${id.padEnd(12)} side=${side.padEnd(4)} ${leans}  => ${tally(g.s, m).passed ? 'PASS' : 'fail'}`);
    }
  }
});

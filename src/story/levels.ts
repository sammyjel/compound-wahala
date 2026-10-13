// Story Mode levels. Each level is a short script built from a handful of simple steps
// (say, choose, tap, search, mash, collect...). One new idea per level:
//   1 choose the right action in order · 2 search by tapping · 3 beat the timer
//   4 listen to clues, then decide · 5 pick the fair rule and call a vote
// The API is implemented in play.ts; this file is content only.

import type { ObjId } from '../data/actions.ts';
import type { NpcId } from '../types.ts';

export type Who = NpcId | 'you' | 'narrator';
export type Target = { kind: 'obj'; id: ObjId } | { kind: 'npc'; id: NpcId } | { kind: 'prop'; id: string };
export type Prop = 'jerrycan' | 'bucket' | 'bucketFull' | null;

/** A spoken line. `plain` is the plain-English meaning of Pidgin / slang. */
export interface Say { who: Who; text: string; plain?: string; sound?: 'boing' | 'sputter' | 'goat' | 'drum' }

export interface Opt {
  label: string;
  icon: string;
  /** The right answer. Tapping the step's target in the picture also picks it. */
  ok?: boolean;
  /** Funny reaction when it's the wrong answer. */
  reply?: Say[];
}

export interface StoryApi {
  // World
  setHour(h: number): void;
  setPower(nepa: boolean): void;
  setGen(fuel: number, on: boolean): void;
  place(cast: Partial<Record<NpcId, [number, number]>>, player: [number, number]): void;
  move(id: NpcId | 'goat', x: number, y: number): Promise<void>;
  walk(x: number, y: number): Promise<void>;
  dance(ids: NpcId[] | 'all' | 'none'): void;
  carry(p: Prop): void;
  setBucket(at: [number, number] | null, upsideDown?: boolean): void;
  setPot(on: boolean): void;
  setPrints(on: boolean): void;
  setGoat(at: [number, number] | null, bone?: boolean): void;
  setClouds(k: number): void;
  setRain(on: boolean): void;
  music(track: 'day' | 'night' | 'meeting' | 'owambe' | 'tobi'): void;
  sound(name: 'powerOff' | 'powerOn' | 'gen' | 'sputter' | 'splash' | 'thunder' | 'goat' | 'drum' | 'gavel' | 'cheer' | 'coin' | 'good'): void;
  /** Repeat `fn` every `ms` until the returned stop() is called (or the level ends). */
  every(ms: number, fn: () => void): () => void;

  // Talking and feedback
  say(who: Who, text: string, plain?: string): Promise<void>;
  lines(l: Say[]): Promise<void>;
  /** Big centre-screen message. */
  banner(text: string, plain?: string): Promise<void>;
  wait(ms: number): Promise<void>;
  reward(coins: number, why: string): void;
  celebrate(): void;
  /** Bubble over someone in the picture without waiting. */
  bubble(who: NpcId | 'you', text: string): void;

  // Player input — each resolves once the player gets it right
  choose(goal: string, opts: Opt[], target?: Target): Promise<void>;
  tap(goal: string, target: Target, button: { label: string; icon: string }): Promise<void>;
  /** Tap around the compound to find something. Wrong spots get a funny reply, never a penalty. */
  search(goal: string, found: Target[], spots: Array<{ target: Target; label: string; reply: Say[] }>, hint: { after: number; at: Target; line: Say }): Promise<void>;
  /** Tap the same thing `times` times. */
  mash(goal: string, target: Target, times: number, button: { label: string; icon: string }, each: (n: number) => void): Promise<void>;
  /** Tap all the clothes on the line before the timer runs out. Resolves true on success. */
  collect(goal: string, seconds: number, onGrab: (i: number) => void): Promise<boolean>;
  /** Talk to each of these people (any order). */
  interview(goal: string, people: Array<{ id: NpcId; lines: Say[] }>): Promise<void>;
  /** Count a wrong attempt (fewer stars, nothing else). */
  oops(): void;
  resetLaundry(): void;
}

export interface LevelDef {
  n: number;
  title: string;
  /** Plain-English title for younger players. */
  plain: string;
  emoji: string;
  /** One line on the level map. */
  teaser: string;
  /** Shown on the "level complete" card. */
  win: string;
  run: (g: StoryApi) => Promise<void>;
}

const NARR = (text: string, plain?: string): Say => ({ who: 'narrator', text, plain });

// ───────────────────────── Level 1 ─────────────────────────

const ACTIONS_L1 = { fuel: { label: 'FIND FUEL', icon: '⛽' }, gen: { label: 'START GENERATOR', icon: '⚙️' }, call: { label: 'CALL THE ELECTRICIAN', icon: '📞' } };

const level1: LevelDef = {
  n: 1, title: 'NEPA Don Take Light!', plain: 'The power is off!', emoji: '💡',
  teaser: 'The light goes off. Get the generator running!',
  win: 'You brought the light back to the compound!',
  async run(g) {
    g.setHour(19.9);
    g.setPower(true);
    g.setGen(0, false);
    g.place({ kemi: [470, 585], amaka: [640, 645], femi: [790, 632], bisi: [345, 525], tobi: [935, 600], chief: [560, 262] }, [820, 560]);
    g.music('night');
    g.dance(['tobi']);
    await g.say('tobi', 'Vibes! The music is sweet tonight! 🎶');
    // Blackout!
    g.setPower(false);
    g.dance('none');
    g.sound('powerOff');
    await g.wait(500);
    await g.say('kemi', 'Ahn ahn! NEPA don take light again! 😩', 'Oh no! The power company cut the electricity again!');
    await g.banner('Wahala don start! Help the compound get light!', '"Wahala" means trouble.');
    g.bubble('amaka', 'This heat ehn... 🥵 Somebody fan me!');

    // Step 1: fuel first
    await g.choose('The generator has no fuel. What should you do first?', [
      { ...ACTIONS_L1.fuel, ok: true },
      { ...ACTIONS_L1.gen, reply: [NARR('Kpa-kpa-kpa... 💨 The generator coughs. There is no fuel inside!'), { who: 'you', text: 'Hmm. Fuel first!', sound: 'sputter' }] },
      { ...ACTIONS_L1.call, reply: [{ who: 'you', text: 'Hello, electrician? 📞' }, NARR('Electrician: "Na NEPA cut am, no be wire! I no fit help." 😂', 'Electrician: "The power company cut it, not your wires! I can\'t help."')] },
    ], { kind: 'obj', id: 'kiosk' });
    await g.walk(300, 560);
    await g.say('bisi', 'Fuel dey! Take this one, my pikin. 😊', 'I have fuel! Take this, my dear.');
    g.carry('jerrycan');
    g.reward(10, 'Found fuel');

    // Step 2: now start it
    await g.choose('You have fuel! Now what?', [
      { ...ACTIONS_L1.fuel, reply: [NARR('You already have fuel — look, it\'s in your hand! 😄')] },
      { ...ACTIONS_L1.gen, ok: true },
      { ...ACTIONS_L1.call, reply: [NARR('Electrician: "I dey come... next week Tuesday." 🙄', 'Electrician: "I\'m coming... next week Tuesday."')] },
    ], { kind: 'obj', id: 'generator' });
    await g.walk(1050, 650);
    g.sound('splash');
    g.carry(null);
    g.setGen(5, false);
    await g.say('you', 'Glug glug glug... fuel is in! ⛽');
    g.reward(10, 'Poured the fuel');

    // Step 3: pull the cord
    const words = ['Kpa!', 'Kpa-kpa!', 'VROOOM! 🔥'];
    await g.mash('Pull the starter rope! Tap the generator 3 times!', { kind: 'obj', id: 'generator' }, 3, { label: 'PULL!', icon: '💪' }, (n) => {
      g.bubble('you', words[n - 1]);
      g.sound(n < 3 ? 'sputter' : 'gen');
    });
    g.setGen(5, true);
    g.sound('powerOn');
    g.celebrate();
    await g.say('kemi', 'UP GENERATOR! Light don come! 🎉', 'Hooray! The light is back!');
    await g.say('amaka', 'My fan is spinning again. God bless you! 😅');
    await g.say('tobi', 'Party continue! Everybody dance! 🕺', 'The party continues!');
    g.reward(20, 'Light is back!');
  },
};

// ───────────────────────── Level 2 ─────────────────────────

const level2: LevelDef = {
  n: 2, title: 'Where My Bucket?', plain: 'Where is my bucket?', emoji: '🪣',
  teaser: 'Nurse Amaka\'s bucket is missing. Search the compound!',
  win: 'You found the bucket and Nurse Amaka got to work on time!',
  async run(g) {
    g.setHour(8.6);
    g.setPower(true);
    g.setGen(0, false);
    g.place({ amaka: [1000, 585], tobi: [690, 655], kemi: [470, 585], bisi: [345, 525], chief: [560, 262] }, [820, 560]);
    g.setBucket([748, 652], true);
    g.music('day');
    g.dance(['tobi']);
    const drums = g.every(2200, () => g.sound('drum'));
    await g.say('amaka', 'My blue bucket is missing! I need water before work! 😩');
    await g.say('amaka', 'Abeg, help me find am!', 'Please, help me find it!');
    await g.search('Find Nurse Amaka\'s blue bucket. Tap places to look!',
      [{ kind: 'npc', id: 'tobi' }, { kind: 'prop', id: 'bucket' }, { kind: 'obj', id: 'chairs' }],
      [
        { target: { kind: 'obj', id: 'gate' }, label: 'Gate', reply: [NARR('Just the gateman\'s old slippers. No bucket. 🩴')] },
        { target: { kind: 'obj', id: 'kiosk' }, label: 'Kiosk', reply: [{ who: 'bisi', text: 'Na me? I dey sell bucket, I no dey steal am! 😤', plain: 'Me? I sell buckets, I don\'t steal them!' }] },
        { target: { kind: 'obj', id: 'laundry' }, label: 'Laundry', reply: [NARR('Only socks on the line. Very loud socks. 🧦')] },
        { target: { kind: 'obj', id: 'tank' }, label: 'Water tank', reply: [NARR('Here is the water... but where is the bucket? 🤔')] },
        { target: { kind: 'obj', id: 'generator' }, label: 'Generator', reply: [NARR('The generator drinks fuel, not water. No bucket here. 😄')] },
        { target: { kind: 'obj', id: 'door' }, label: 'Your room', reply: [NARR('Your own bucket has a big hole in it. Not this one! 🕳️')] },
        { target: { kind: 'npc', id: 'kemi' }, label: 'Aunty Kemi', reply: [{ who: 'kemi', text: 'Me I hear drumming near the chairs o... 🥁', plain: 'I can hear drumming near the chairs...' }] },
      ],
      { after: 2, at: { kind: 'obj', id: 'chairs' }, line: { who: 'kemi', text: 'Listen! Who dey drum for there? 🥁', plain: 'Listen! Who is drumming over there?' } },
    );
    drums();
    g.dance('none');
    await g.say('tobi', 'Ehn? This na my new drum! E get bass well well! 🥁', 'Huh? This is my new drum! It has great bass!');

    await g.choose('Tobi is using the bucket as a drum! How do you get it back?', [
      { label: 'ASK NICELY', icon: '🙏', ok: true },
      { label: 'SNATCH IT', icon: '✊', reply: [{ who: 'tobi', text: 'Ah ah! Gently now! 😅', plain: 'Hey! Be gentle!' }, NARR('Grabbing is not nice. Try asking!')] },
      { label: 'CALL CHIEF', icon: '📢', reply: [{ who: 'chief', text: 'You woke me up because of a BUCKET?! 😤' }, NARR('Try talking to Tobi yourself.')] },
    ], { kind: 'npc', id: 'tobi' });
    await g.walk(760, 690);
    await g.say('you', 'Tobi, please can Nurse Amaka have her bucket back?');
    await g.say('tobi', 'No wahala! Sorry o. I go find real drum. 😄', 'No problem! Sorry. I\'ll find a real drum.');
    g.setBucket(null);
    g.carry('bucket');
    g.reward(10, 'Got the bucket');

    await g.tap('Fill the bucket at the water tank. Tap the tank!', { kind: 'obj', id: 'tank' }, { label: 'FILL IT', icon: '💧' });
    await g.walk(1080, 565);
    g.sound('splash');
    g.carry('bucketFull');
    g.reward(10, 'Filled with water');

    await g.tap('Give the bucket to Nurse Amaka!', { kind: 'npc', id: 'amaka' }, { label: 'GIVE IT', icon: '🎁' });
    await g.walk(935, 590);
    g.carry(null);
    g.celebrate();
    await g.say('amaka', 'Thank you well well! I no go late for work! 🙌', 'Thank you so much! I won\'t be late for work!');
    g.reward(20, 'Amaka is happy');
  },
};

// ───────────────────────── Level 3 ─────────────────────────

const level3: LevelDef = {
  n: 3, title: 'Rain Dey Come!', plain: 'Rain is coming!', emoji: '🌧️',
  teaser: 'Take Aunty Kemi\'s clothes in before the rain!',
  win: 'You beat the rain! Aunty Kemi\'s clothes are dry.',
  async run(g) {
    g.setHour(14);
    g.setPower(true);
    g.setGen(0, false);
    g.resetLaundry();
    g.place({ kemi: [340, 600], tobi: [935, 600], bisi: [345, 525], chief: [560, 262], femi: [790, 632] }, [500, 600]);
    g.music('day');
    await g.wait(400);
    g.setClouds(1);
    g.sound('thunder');
    await g.wait(600);
    await g.say('kemi', 'Ye! Rain wan fall and my clothes dey outside! ⛈️', 'Oh no! It\'s about to rain and my clothes are outside!');
    await g.say('kemi', 'Help me pack them, quick quick!', 'Help me take them down, quickly!');
    await g.banner('Beat the rain! ☔', 'Tap every piece of clothing on the line.');
    for (;;) {
      const ok = await g.collect('Tap all 6 clothes before the rain!', 20, () => g.sound('coin'));
      if (ok) break;
      g.setRain(true);
      g.sound('thunder');
      await g.say('kemi', 'Ah! Some don soak! 💦', 'Oh! Some of them got wet!');
      await g.lines([NARR('No wahala — try again. You can do it! 💪', 'No problem — try again!')]);
      g.setRain(false);
      g.resetLaundry();
    }
    g.reward(12, 'All clothes saved');
    await g.say('kemi', 'You fast pass lightning! ⚡', 'You\'re faster than lightning!');
    g.setRain(true);
    g.sound('thunder');
    g.celebrate();
    await g.say('tobi', 'Rain dance! 💃 Everybody dey dry!', 'Rain dance! Everyone is dry!');
    g.reward(20, 'Kemi is happy');
  },
};

// ───────────────────────── Level 4 ─────────────────────────

const level4: LevelDef = {
  n: 4, title: 'Who Chop the Meat?', plain: 'Who ate the meat?', emoji: '🍖',
  teaser: 'The last piece of meat is gone. Be the detective!',
  win: 'Case closed, Detective! It was Senator the goat all along.',
  async run(g) {
    g.setHour(16);
    g.setPower(true);
    g.setGen(0, false);
    g.setPot(true);
    g.setPrints(true);
    g.place({ chief: [640, 652], femi: [820, 632], tobi: [950, 600], kemi: [470, 585], bisi: [345, 525] }, [560, 600]);
    g.music('day');
    g.sound('gavel');
    await g.say('chief', 'WHO ATE THE LAST MEAT IN MY POT?! 🍲');
    await g.say('chief', 'Nobody leaves this compound until I know!');
    await g.banner('Be the detective! 🔍', 'Ask everyone what they saw.');
    await g.interview('Ask the 3 suspects. Tap Femi, Tobi and Aunty Kemi.', [
      { id: 'femi', lines: [{ who: 'femi', text: 'Me? I was on a call with my investors! 📱' }, { who: 'femi', text: 'But I heard something go "meeeh"...' }] },
      { id: 'tobi', lines: [{ who: 'tobi', text: 'I was filming. Look my video — something hairy ran past! 🎥', plain: 'I was filming. Look at my video — something hairy ran past!' }] },
      { id: 'kemi', lines: [{ who: 'kemi', text: 'I saw small footprints by the pot. Very tiny feet... 🐾' }] },
    ]);
    await g.lines([NARR('Clues: 🐾 tiny footprints... a "meeeh" sound... something hairy...')]);
    await g.choose('Who ate the meat?', [
      { label: 'BROTHER FEMI', icon: '🕶️', reply: [{ who: 'femi', text: 'Ehn?! Me wey dey diet?! 😭', plain: 'What?! Me, who is on a diet?!' }, NARR('Femi doesn\'t say "meeeh". Check the clues! 🔍')] },
      { label: 'TOBI', icon: '🎧', reply: [{ who: 'tobi', text: 'Na content I dey chop, no be meat! 😂', plain: 'I only eat content, not meat!' }, NARR('Tobi was busy filming. Look at the clues again!')] },
      { label: 'SENATOR THE GOAT', icon: '🐐', ok: true },
    ]);
    g.setGoat([1300, 680], true);
    g.sound('goat');
    await g.move('goat', 1000, 680);
    await g.say('chief', 'SENATOR! You again?! 😤');
    await g.say('kemi', 'Hahaha! That goat get sense pass all of us! 😂', 'Hahaha! That goat is smarter than all of us!');
    await g.mash('Shoo Senator out of the compound! Tap him 3 times!', { kind: 'prop', id: 'goat' }, 3, { label: 'SHOO!', icon: '👋' }, (n) => {
      g.sound('goat');
      g.bubble('you', ['Shoo!', 'Shoo shoo!', 'Go home, Senator! 😂'][n - 1]);
      void g.move('goat', 1000 - n * 230, 680);
    });
    await g.move('goat', -120, 660);
    g.setGoat(null);
    g.setPrints(false);
    g.celebrate();
    await g.say('chief', 'Well done, Detective! Next time, I go cover my pot. 😅', 'Well done, Detective! Next time I\'ll cover my pot.');
    g.reward(25, 'Mystery solved');
  },
};

// ───────────────────────── Level 5 ─────────────────────────

const level5: LevelDef = {
  n: 5, title: 'Fuel Palaver', plain: 'The fuel argument', emoji: '⛽',
  teaser: 'Who should pay for generator fuel? Help everyone agree.',
  win: 'Everybody agreed! You are a true Compound Champion. 🏆',
  async run(g) {
    g.setHour(17.2);
    g.setPower(true);
    g.setGen(3, false);
    g.place({ chief: [700, 655], femi: [560, 640], bisi: [850, 640], kemi: [430, 600], amaka: [980, 600], tobi: [300, 600] }, [700, 560]);
    g.music('meeting');
    g.sound('gavel');
    await g.say('chief', 'Order! Order! We have a fuel palaver! 🔨', 'Order! We have an argument about fuel!');
    await g.say('femi', 'I no dey house all day! Why I go pay for fuel? 😤', 'I wasn\'t home all day! Why should I pay for fuel?');
    await g.say('bisi', 'My freezer need light all night! My fish no fit spoil! 🐟', 'My freezer needs power all night! My fish can\'t go bad!');
    await g.banner('Help everybody agree! 🤝', 'A good leader listens to both sides.');
    await g.interview('Listen to both sides. Tap Femi, then Iya Bisi.', [
      { id: 'femi', lines: [{ who: 'femi', text: 'I only used my fan for ONE hour. 🌀' }] },
      { id: 'bisi', lines: [{ who: 'bisi', text: 'True, my freezer ran for TEN hours. I use more. 🧊' }] },
    ]);
    await g.choose('What is the fairest rule?', [
      { label: 'EVERYBODY PAYS THE SAME', icon: '🟰', reply: [{ who: 'femi', text: 'The same?! My fan was on for one hour! 😩' }, NARR('Hmm, that\'s not fair to Femi. Try another idea!')] },
      { label: 'PAY FOR THE HOURS YOU USE', icon: '⏱️', ok: true },
      { label: 'FEMI PAYS FOR EVERYTHING', icon: '💸', reply: [{ who: 'femi', text: 'Ehn?! Na me be ATM? 😭', plain: 'What?! Am I a cash machine?' }, NARR('That\'s not fair at all! Try again.')] },
    ]);
    await g.say('chief', 'Pay for what you use... Hmm. I like it!');
    await g.tap('Ask Chief to call the vote!', { kind: 'npc', id: 'chief' }, { label: 'CALL THE VOTE', icon: '🗳️' });
    g.sound('gavel');
    for (const id of ['kemi', 'amaka', 'bisi', 'tobi', 'chief'] as const) {
      g.bubble(id, '👍 Yes!');
      g.sound('coin');
      await g.wait(650);
    }
    await g.say('femi', 'Okay... fair is fair. 👍');
    await g.banner('Everybody agrees! 6 – 0 🎉');
    g.music('owambe');
    g.celebrate();
    await g.say('chief', 'You be true Compound Champion! 🏆', 'You are a true Compound Champion!');
    g.reward(30, 'Peace in the compound');
  },
};

export const LEVELS: LevelDef[] = [level1, level2, level3, level4, level5];

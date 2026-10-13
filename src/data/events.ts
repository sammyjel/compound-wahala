import { createBill, payShare } from '../engine/bills.ts';
import { addLog, addStat, flag, hasPower, nepaOn, setFlag } from '../engine/state.ts';
import type { Effects, GameState, Line } from '../types.ts';

export interface EventChoice {
  label: string;
  plain?: string;
  effects?: Effects;
  blocked?: (s: GameState) => string | null;
  result: string;
}

export interface EventDef {
  id: string;
  title: string;
  icon: 'power' | 'water' | 'bill' | 'music' | 'visitor' | 'laundry' | 'goat' | 'rain' | 'party' | 'inspect' | 'viral' | 'dispute' | 'home' | 'phone';
  cond?: (s: GameState) => boolean;
  /** Applied the moment the event fires (before the player chooses). */
  onFire?: (s: GameState) => void;
  lines: Line[] | ((s: GameState) => Line[]);
  choices: EventChoice[];
}

export const EVENTS: EventDef[] = [
  {
    id: 'arrival',
    title: 'Welcome to Unity Compound',
    icon: 'home',
    lines: (s) => [
      { who: 'narrator', text: `7:00am. ${s.playerName} drags a Ghana-must-go bag through the blue gate of Unity Compound, 7 Adebayo Close.`, plain: 'Ghana-must-go = a big checkered travel bag.' },
      { who: 'narrator', text: 'Six flats. One generator. One water tank. Endless opinions.' },
      { who: 'kemi', text: 'Ehen! New tenant! Welcome o! Room 4, abi? The last person there left in the middle of the night. Long story. I will tell you.', plain: 'Room 4, right?' },
    ],
    choices: [
      { label: '"Thank you, ma! Happy to be here."', effects: { trust: { kemi: 3 }, happiness: 3 }, result: 'Aunty Kemi beams. You have made your first ally — and possibly your first informant.' },
      { label: '"...Why did they leave at night?"', effects: { happiness: -1, flags: ['curious_room4'] }, result: 'Aunty Kemi just smiles mysteriously. "Later. Unpack first."' },
    ],
  },
  {
    id: 'nepa_cut',
    title: 'NEPA Don Take Light!',
    icon: 'power',
    lines: [
      { who: 'narrator', text: 'The fan dies mid-spin. Every TV in the compound goes black at once. From somewhere: a collective groan.', plain: 'NEPA = the power company. "Take light" = power cut.' },
      { who: 'tobi', text: 'NOOOO! My phone was at 4%!' },
      { who: 'bisi', text: 'My fish! My freezer! Who has fuel?!' },
    ],
    choices: [
      { label: 'Check the generator', effects: { flags: ['hint_gen'] }, result: 'The shared generator is by the right wall. Its tank is empty. Iya Bisi sells fuel at the kiosk by the gate.' },
      { label: 'Shrug — it will come back', effects: { happiness: -2 }, result: 'You sit in the heat and wait. Somewhere, a goat bleats sympathetically.' },
    ],
  },
  {
    id: 'bill_notice',
    title: 'The NEPA Bill Has Landed',
    icon: 'bill',
    onFire: (s) => { createBill(s, 'nepa', 'NEPA electricity bill', 2000, 3); },
    lines: [
      { who: 'narrator', text: 'A NEPA official slides a bill under the gate and leaves very fast, like a man who has met tenants before.' },
      { who: 'chief', text: '₦12,000 for the compound. ₦2,000 per flat. Due by the end of Day 3, or they cut our wire. I am exempt — I am the landlord.' },
      { who: 'femi', text: 'Exempt? Can I also be exempt? I am a stakeholder.' },
    ],
    choices: [
      { label: 'Pay your ₦2,000 share now', blocked: (s) => (s.stats.cash < 2000 ? 'Not enough cash' : null),
        effects: { run: (s) => { payShare(s, 'nepa', 'you'); } }, result: 'Paid. Chief writes your name in his little green book with approval.' },
      { label: 'Pay later (check the meter or Bills)', result: 'Bills live at the electricity meter on the wall and in the Bills tab. Everyone must pay before Day 3 ends.' },
    ],
  },
  {
    id: 'laundry_missing',
    title: 'Who Carry My Shirt?',
    icon: 'laundry',
    lines: [
      { who: 'narrator', text: 'You go to the laundry line. Your favourite red shirt with the gold buttons is gone. Only the peg remains, swinging like a crime scene.' },
    ],
    choices: [
      { label: 'Investigate (new mission)', effects: { flags: ['laundry_case'] }, result: 'Mission added: find your shirt. Start by inspecting the laundry line.' },
      { label: 'Shout "WHO CARRY MY SHIRT?!"', effects: { flags: ['laundry_case'], happiness: 2, trust: { amaka: -2 }, reputation: -1 },
        result: 'The whole compound hears you. Amaka, trying to sleep, does not appreciate it. Mission added.' },
    ],
  },
  {
    id: 'noisy_music',
    title: 'Speaker Wahala',
    icon: 'music',
    cond: (s) => !flag(s, 'quiet_hours') && !flag(s, 'tobi_headphones'),
    lines: [
      { who: 'narrator', text: "9pm. Tobi's speaker launches \"Owambe Mix Vol. 47\". The windows vibrate. A lizard on the wall starts nodding.", plain: 'Owambe = a big Nigerian party.' },
      { who: 'amaka', text: '(from Room 1) I HAVE A SHIFT AT ELEVEN!' },
    ],
    choices: [
      { label: 'Join the dance!', effects: { happiness: 8, trust: { tobi: 5, amaka: -4 } }, result: 'You show moves nobody expected. Tobi records it. Amaka records a mental note.' },
      { label: 'Ask Tobi to turn it down', effects: { trust: { tobi: -2, amaka: 5 }, reputation: 1 }, result: 'Tobi lowers it to "only the neighbours can hear". Amaka mouths "thank you" through the window.' },
      { label: 'Report it to Chief', effects: { trust: { tobi: -6, chief: 3, amaka: 2 }, reputation: 1 }, result: 'Chief storms down in his slippers. Silence falls. Tobi looks betrayed.' },
    ],
  },
  {
    id: 'expense_dispute',
    title: 'Freezer vs. Fuel',
    icon: 'dispute',
    lines: [
      { who: 'kemi', text: "Iya Bisi's freezer is the one drinking all the generator fuel! It's not fair on the rest of us!" },
      { who: 'bisi', text: 'And your hair dryer? Is it powered by prayer? Abeg!' },
      { who: 'narrator', text: 'They both turn to you. Apparently you are now a judge.' },
    ],
    choices: [
      { label: 'Side with Aunty Kemi', effects: { trust: { kemi: 6, bisi: -6 } }, result: 'Kemi raises your hand like a boxing champion. Iya Bisi charges you double for your next noodles (in spirit).' },
      { label: 'Side with Iya Bisi', effects: { trust: { bisi: 6, kemi: -6 } }, result: 'Iya Bisi slips you a free sachet of water. Aunty Kemi begins composing gossip about you.' },
      { label: 'Propose paying by usage — big users pay more', effects: { trust: { bisi: 2, kemi: 2, amaka: 3 }, reputation: 4 }, result: 'Grumbling, they both agree it is fair. Nurse Amaka nods approvingly from across the courtyard.' },
    ],
  },
  {
    id: 'visitor',
    title: 'Cousin From the Village',
    icon: 'visitor',
    onFire: (s) => { setFlag(s, 'visitor_here'); },
    lines: [
      { who: 'narrator', text: 'A young man arrives with two Ghana-must-go bags and a live chicken. "I am Femi\'s cousin, Ikenna. I will stay only two weeks."' },
      { who: 'femi', text: '(whispering) Two weeks in village time is like three months.' },
      { who: 'narrator', text: 'More people means more water used every day.' },
    ],
    choices: [
      { label: 'Welcome him warmly', effects: { happiness: 4, trust: { femi: 5 }, water: -10 }, result: 'Ikenna gives you a bag of fresh ube from the village. The chicken watches you suspiciously.', plain: 'Ube = African pear.' },
      { label: '"He should contribute for water."', effects: { trust: { femi: -2, amaka: 3 }, reputation: 2, unflags: ['visitor_here'], water: 10 },
        result: 'Ikenna agrees and fetches six jerrycans himself. Fair is fair.' },
      { label: 'Tell Chief about the extra resident', effects: { trust: { femi: -6, chief: 4 }, unflags: ['visitor_here'] },
        result: 'Chief reads out Rule 14: "Visitors above three days shall be declared." Ikenna moves to a hotel. The chicken stays.' },
    ],
  },
  {
    id: 'water_shortage',
    title: 'Tank Don Dry!',
    icon: 'water',
    cond: (s) => s.stats.water <= 12,
    lines: [
      { who: 'narrator', text: 'The tap coughs, sputters and produces one sad drop. The overhead tank is empty.', plain: '"Don dry" = has run dry.' },
      { who: 'amaka', text: 'I need to bathe before my shift. Somebody do something!' },
    ],
    choices: [
      { label: 'Buy water from the mai ruwa (₦1,500)', plain: 'Mai ruwa = water vendor with a cart.', blocked: (s) => (s.stats.cash < 1500 ? 'Not enough cash' : null),
        effects: { cash: -1500, water: 30, trust: { amaka: 3 }, reputation: 2 }, result: 'The water vendor pushes his cart of jerrycans in. Applause from the balcony.' },
      { label: 'Organise a bucket line to the next street (2h)', effects: { time: 2, water: 20, trustAll: 2, reputation: 4, happiness: -3 },
        result: 'Everyone carries buckets, even Femi (in his shades). Teamwork, sweat and gossip.' },
      { label: 'Complain on the compound WhatsApp group', effects: { happiness: -4, reputation: -2 }, result: '47 messages later, the tank is still empty. But Aunty Kemi sent a lovely good-morning flyer.' },
    ],
  },
  {
    id: 'goat',
    title: 'A Goat Has Entered the Chat',
    icon: 'goat',
    onFire: (s) => { setFlag(s, 'goat_here'); },
    lines: [
      { who: 'narrator', text: 'A brown goat strolls through the gate, eats Amaka\'s potted plant, and stares at you like it pays rent.' },
      { who: 'tobi', text: 'I am naming him Senator. Look at the confidence!' },
    ],
    choices: [
      { label: 'Chase the goat out (1h)', effects: { time: 1, condition: 4, trust: { amaka: 4 }, happiness: 3, unflags: ['goat_here'] },
        result: 'Ten minutes of chasing, fifty of recovering. Senator leaves with dignity. You do not.' },
      { label: 'Let Tobi film it first', effects: { trust: { tobi: 5, amaka: -2 }, condition: -3, flags: ['skit_bonus'], unflags: ['goat_here'] },
        result: '"Senator Visits Unity Compound" gets 8,000 views. The plant does not recover.' },
      { label: 'Ignore it', effects: { condition: -6 }, result: 'Senator eats a sock off the line and leaves on his own schedule.' },
    ],
  },
  {
    id: 'rain',
    title: 'Rain Wey Get Mind',
    icon: 'rain',
    lines: [
      { who: 'narrator', text: 'The sky opens. In ten minutes the courtyard is a swimming pool and the laundry is wetter than before it was washed.', plain: 'A very heavy rain.' },
    ],
    choices: [
      { label: 'Dig out the blocked drain (2h)', effects: { time: 2, condition: 10, reputation: 4, trust: { chief: 4 }, happiness: -2 }, result: 'Muddy, triumphant, you watch the water drain away. Chief salutes you from the balcony.' },
      { label: 'Rescue the laundry for everyone (1h)', effects: { time: 1, trustAll: 2, happiness: 1 }, result: "You carry armfuls of everyone's clothes to the stairs. Even Femi says thank you." },
      { label: 'Watch from your window with tea', effects: { happiness: 5, condition: -5 }, result: 'Peaceful. Also: the courtyard now has a small lake.' },
    ],
  },
  {
    id: 'owambe',
    title: 'Owambe Next Door',
    icon: 'party',
    lines: [
      { who: 'narrator', text: 'Next door is celebrating a 60th birthday. Aso-ebi, live band, and the smell of smoky party jollof floats over the wall.', plain: 'Aso-ebi = matching party outfits. Owambe = big party.' },
      { who: 'kemi', text: 'Me, I am going. I know the celebrant\'s sister\'s husband\'s tailor.' },
    ],
    choices: [
      { label: 'Go with Aunty Kemi (2h)', effects: { time: 2, happiness: 14, trust: { kemi: 5 } }, result: 'You eat two plates of jollof, dance with strangers, and leave with a souvenir plastic bowl.' },
      { label: 'Stay home and work', effects: { happiness: -2 }, result: 'You hear the band through the wall. Your phone repair is accompanied by talking drums.' },
    ],
  },
  {
    id: 'inspection',
    title: "Chief's Inspection",
    icon: 'inspect',
    lines: (s) => [
      { who: 'chief', text: 'Inspection! I am inspecting! Everybody stand by your doors.' },
      s.stats.condition >= 60
        ? { who: 'narrator', text: `Chief walks around slowly... The compound looks decent (condition ${Math.round(s.stats.condition)}). He nods.` }
        : { who: 'narrator', text: `Chief walks around slowly... and stops. (condition ${Math.round(s.stats.condition)}) "Is this a compound or a junkyard?"` },
    ],
    choices: [
      { label: 'Show him around proudly', effects: { run: (s) => { if (s.stats.condition >= 60) { addStat(s, 'reputation', 6); s.trust.chief = Math.min(100, s.trust.chief + 6); } else { addStat(s, 'reputation', -3); } } },
        result: 'Chief makes notes in his green book. Whatever he wrote, he underlined it twice.' },
      { label: 'Apologise and sweep while he watches (1h)', effects: { time: 1, condition: 10, trust: { chief: 4 }, reputation: 2 }, result: 'Chief watches you sweep with deep satisfaction. "This is the spirit of 1994."' },
      { label: 'Blame Femi for the mess', effects: { trust: { femi: -8, chief: 1 }, reputation: -2 }, result: 'Femi, from his room: "I HEARD THAT."' },
    ],
  },
  {
    id: 'viral',
    title: 'DJ Tee Goes Viral!',
    icon: 'viral',
    cond: (s) => flag(s, 'skit_filmed') && !flag(s, 'tobi_deal'),
    onFire: (s) => { setFlag(s, 'tobi_deal'); addLog(s, "Tobi's skit went viral and he signed a small brand deal.", 'good'); },
    lines: (s) => [
      { who: 'tobi', text: `${flag(s, 'skit_bonus') ? '120,000' : '80,000'} VIEWS! A chin-chin company wants me for an ad! ME! DJ TEE!`, plain: 'Chin-chin = a crunchy fried snack.' },
      { who: 'tobi', text: "And YOU are in it, screaming UP NEPA! You're famous! Kind of!" },
      { who: 'narrator', text: 'With brand-deal money, Tobi can now pay his shares on time.' },
    ],
    choices: [
      { label: '"I always believed in you!"', effects: { trust: { tobi: 8 }, happiness: 8, reputation: 4 }, result: 'Tobi hugs you so hard your phone screen cracks. You can fix that.' },
      { label: '"So... my share of the fee?"', effects: { cash: 2000, trust: { tobi: 2 }, happiness: 4, reputation: 2 }, result: 'Laughing, he sends you ₦2,000. "Talent fee for the screamer."' },
    ],
  },
  {
    id: 'femi_app',
    title: "Femi's Big Investment",
    icon: 'phone',
    cond: (s) => !flag(s, 'femi_job'),
    lines: [
      { who: 'femi', text: 'The investment app I put my money in... has frozen. The customer care number is now a pizza place in Abuja.' },
      { who: 'narrator', text: 'For once, Femi is not wearing his shades. He looks very young.' },
    ],
    choices: [
      { label: 'Sit with him and listen', effects: { trust: { femi: 8 }, happiness: -2, time: 1 }, result: 'You talk for an hour. "Maybe I need something steady," he says. "Maybe."' },
      { label: '"I told you those apps are scams."', effects: { trust: { femi: -4 }, reputation: 1 }, result: 'He nods without looking at you. True, but it landed hard.' },
    ],
  },
  {
    id: 'freezer',
    title: "Iya Bisi's Freezer Crisis",
    icon: 'power',
    cond: (s) => !hasPower(s) || !nepaOn(s),
    lines: [
      { who: 'bisi', text: 'My fish are starting to sweat! If I lose this stock, I lose the week. Please, anybody with fuel...' },
    ],
    choices: [
      { label: 'Buy 2L of fuel for the gen (₦2,400)', blocked: (s) => (s.stats.cash < 2400 ? 'Not enough cash' : null),
        effects: { cash: -2400, fuel: 2, gen: 'on', trust: { bisi: 10 }, reputation: 3 }, result: 'The gen roars. Iya Bisi gives you a frozen fish "for later". You now own a fish.' },
      { label: 'Help her carry stock to a neighbour with a solar freezer (1h)', effects: { time: 1, trust: { bisi: 6 }, happiness: -1 }, result: 'Sweaty, fishy work — but the stock is saved.' },
      { label: '"Sorry, I can\'t help today."', effects: { trust: { bisi: -3 } }, result: 'She nods tightly and goes back to fanning the freezer.' },
    ],
  },
];

export function eventById(id: string): EventDef {
  const e = EVENTS.find((x) => x.id === id);
  if (!e) throw new Error('Unknown event ' + id);
  return e;
}

/** Hand-placed beats per day, so the first sessions are well paced. */
export const DAY_SCRIPT: Record<number, Array<{ at: number; id: string }>> = {
  1: [{ at: 7, id: 'arrival' }, { at: 9, id: 'nepa_cut' }, { at: 11, id: 'bill_notice' }],
  2: [{ at: 7.5, id: 'laundry_missing' }, { at: 21, id: 'noisy_music' }],
  3: [{ at: 10, id: 'expense_dispute' }],
  4: [{ at: 7.5, id: 'visitor' }],
  5: [{ at: 8, id: 'viral' }, { at: 8, id: 'femi_app' }],
  6: [{ at: 9, id: 'inspection' }],
  7: [{ at: 12, id: 'owambe' }],
};

/** One extra seeded event per day from this pool, if its condition holds. */
export const RANDOM_POOL = ['goat', 'rain', 'freezer', 'owambe', 'water_shortage'];

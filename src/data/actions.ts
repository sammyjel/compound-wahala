import { flag, hasPower, nepaOn, naira, phaseOf, setFlag, addStat } from '../engine/state.ts';
import type { Effects, GameState } from '../types.ts';

export type ObjId = 'gate' | 'kiosk' | 'laundry' | 'chairs' | 'meter' | 'generator' | 'tank' | 'board' | 'door';

export interface ObjectDef {
  id: ObjId;
  name: string;
  describe: (s: GameState) => string;
}

export interface ActionDef {
  id: string;
  obj: ObjId;
  label: (s: GameState) => string;
  cond?: (s: GameState) => boolean;
  blocked?: (s: GameState) => string | null;
  /** Once per day. */
  daily?: boolean;
  time: number;
  effects?: Effects;
  /** Job payout computed at run time (counts toward Hustle). */
  pay?: (s: GameState) => number;
  result: string | ((s: GameState) => string);
  /** Special UI hook instead of a normal action. */
  ui?: 'bills' | 'missions' | 'sleep';
}

const bisiHere = (s: GameState) => phaseOf(s.hour) !== 'night';
const stressed = (s: GameState) => s.stats.happiness < 30;
const jobPay = (s: GameState, base: number) => Math.round((stressed(s) ? base * 0.75 : base) / 50) * 50;
const pumpGain = (s: GameState) => (flag(s, 'pump_fixed') ? 65 : flag(s, 'pump_patched') ? 25 : 40);

export const OBJECTS: Record<ObjId, ObjectDef> = {
  gate: { id: 'gate', name: 'Front gate', describe: () => 'Blue metal gate, slightly dented, squeaks like it has opinions. Beyond it: Adebayo Close and paid work.' },
  kiosk: {
    id: 'kiosk', name: "Iya Bisi's kiosk",
    describe: (s) => (bisiHere(s) ? 'Fuel in jerrycans, sachet water, noodles, eggs, malt drinks. Prices written in chalk.' : 'Closed for the night. A padlock the size of a fist.'),
  },
  laundry: { id: 'laundry', name: 'Laundry line', describe: () => 'A wire strung between two poles, heavy with wax-print wrappers, uniforms and one very brave pair of socks.' },
  chairs: { id: 'chairs', name: 'Courtyard chairs', describe: (s) => `Red and white plastic chairs — the compound's parliament. Compound condition: ${Math.round(s.stats.condition)}/100.` },
  meter: {
    id: 'meter', name: 'Electricity meter',
    describe: (s) => (s.power.disconnected ? 'The meter is dark. A red DISCONNECTED tag hangs from the wire.' : nepaOn(s) ? 'Green light blinking. NEPA is supplying power. Enjoy it while it lasts.' : 'Red light. NEPA has taken the light.'),
  },
  generator: {
    id: 'generator', name: 'Shared generator',
    describe: (s) => `Yellow and loud. Fuel: ${s.stats.fuel}L (burns 1L per hour). ${s.power.genOn ? 'Running.' : 'Off.'}${flag(s, 'fuel_fund') ? ' The Fuel Fund tops it up every morning.' : ''}`,
  },
  tank: {
    id: 'tank', name: 'Water tank & drums',
    describe: (s) => `Black overhead tank on a steel stand, blue drums below. Water: ${Math.round(s.stats.water)}%. ${flag(s, 'pump_fixed') ? 'Pump: freshly repaired.' : flag(s, 'pump_patched') ? 'Pump: patched, wheezing.' : 'Pump: coughing.'}`,
  },
  board: { id: 'board', name: 'Notice board', describe: () => 'Rules in Chief\'s handwriting, a lost-goat poster, and your current missions.' },
  door: { id: 'door', name: 'Your room (Room 4)', describe: (s) => `Home. A small workbench for phone repairs${hasPower(s) ? ', with power.' : ' — but no power right now.'}` },
};

export const ACTIONS: ActionDef[] = [
  // ── Your room ──
  {
    id: 'repair', obj: 'door', time: 3,
    label: (s) => `Do phone repairs (3h, ~${naira(jobPay(s, hasPower(s) ? 3500 : 1200))})`,
    blocked: (s) => ((s.counters[`repairs_d${s.day}`] ?? 0) >= 2 ? 'No more customers today' : null),
    pay: (s) => jobPay(s, hasPower(s) ? 3500 : 1200),
    effects: { counters: { repairsDone: 1 }, happiness: -2 },
    result: (s) => (hasPower(s) ? 'Three cracked screens and a charging port later, the customers leave smiling.' : 'Without power you can only do small fixes by torchlight. Customers pay less.'),
  },
  {
    id: 'radio', obj: 'door', time: 2,
    label: () => "Repair Chief's radio (2h)",
    cond: (s) => flag(s, 'radio_job') && !flag(s, 'radio_fixed'),
    blocked: (s) => (hasPower(s) ? null : 'Needs power — wait for NEPA or run the generator'),
    effects: { flags: ['radio_fixed'] },
    result: 'You replace a capacitor older than you. The radio crackles back to life. Go return it to Chief.',
  },
  { id: 'nap', obj: 'door', time: 2, daily: true, label: () => 'Take a nap (2h)', effects: { happiness: 10 }, result: 'You sleep like a baby. A baby who will wake up to wahala, but still.' },
  { id: 'sleep', obj: 'door', time: 0, label: () => 'Sleep — end the day', ui: 'sleep', result: '' },

  // ── Gate ──
  {
    id: 'deliver', obj: 'gate', time: 3, daily: true,
    label: (s) => `Run deliveries on the street (3h, ~${naira(jobPay(s, 2500))})`,
    cond: (s) => s.hour <= 18,
    pay: (s) => jobPay(s, 2500),
    effects: { happiness: -3 },
    result: 'You deliver parcels across three streets. Two dogs, one traffic jam, zero thank-yous.',
  },
  {
    id: 'suya', obj: 'gate', time: 0.5, daily: true,
    label: () => 'Buy suya from Mallam on the corner (₦1,000)',
    cond: (s) => s.hour >= 17,
    blocked: (s) => (s.stats.cash < 1000 ? 'Not enough cash' : null),
    effects: { cash: -1000, happiness: 10 },
    result: 'Spicy, smoky, wrapped in newspaper. The evening is now officially good.',
  },

  // ── Kiosk ──
  {
    id: 'fuel1', obj: 'kiosk', time: 0.5, label: () => 'Buy 1L fuel (₦1,200)',
    cond: bisiHere, blocked: (s) => (s.stats.cash < 1200 ? 'Not enough cash' : s.stats.fuel >= 20 ? 'Gen tank full' : null),
    effects: { cash: -1200, fuel: 1, trust: { bisi: 1 } }, result: 'One litre in a jerrycan. Iya Bisi pours it into the gen with surgical precision.',
  },
  {
    id: 'fuel3', obj: 'kiosk', time: 0.5, label: () => 'Buy 3L fuel (₦3,400)',
    cond: bisiHere, blocked: (s) => (s.stats.cash < 3400 ? 'Not enough cash' : s.stats.fuel >= 18 ? 'Gen tank full' : null),
    effects: { cash: -3400, fuel: 3, trust: { bisi: 2 }, reputation: 1 }, result: 'Three litres — enough for an evening. Neighbours notice who bought the fuel.',
  },
  {
    id: 'earplugs', obj: 'kiosk', time: 0.5, label: () => 'Buy foam earplugs (₦1,500)',
    cond: (s) => bisiHere(s) && s.missions['m_amaka'] === 'active' && !flag(s, 'has_earplugs') && !flag(s, 'amaka_helped'),
    blocked: (s) => (s.stats.cash < 1500 ? 'Not enough cash' : null),
    effects: { cash: -1500, flags: ['has_earplugs'] }, result: 'Proper foam earplugs. Now give them to Nurse Amaka.',
  },
  {
    id: 'noodles', obj: 'kiosk', time: 0.5, daily: true, label: () => 'Indomie and egg (₦700)',
    cond: bisiHere, blocked: (s) => (s.stats.cash < 700 ? 'Not enough cash' : null),
    effects: { cash: -700, happiness: 8, trust: { bisi: 1 } }, result: 'Noodles, fried egg, a little pepper. Comfort in a plate.',
  },
  {
    id: 'malt', obj: 'kiosk', time: 0.5, daily: true, label: () => 'Malt drink (₦500)',
    cond: bisiHere, blocked: (s) => (s.stats.cash < 500 ? 'Not enough cash' : null),
    effects: { cash: -500 },
    result: (s) => {
      const cold = hasPower(s);
      addStat(s, 'happiness', cold ? 6 : 2);
      return cold ? 'Ice cold. Life is beautiful.' : 'Warm, because no light. Still malt, still love.';
    },
  },
  {
    id: 'kioskjob', obj: 'kiosk', time: 2, daily: true,
    label: (s) => `Help Iya Bisi at the kiosk (2h, ${naira(jobPay(s, 1500))})`,
    cond: bisiHere,
    pay: (s) => jobPay(s, 1500),
    effects: { trust: { bisi: 4 } },
    result: 'You learn the chalk-price system and the exact tone for "no credit today". Iya Bisi is impressed.',
  },

  // ── Generator ──
  {
    id: 'genon', obj: 'generator', time: 0.5, label: () => 'Start the generator',
    cond: (s) => !s.power.genOn,
    blocked: (s) => (s.stats.fuel <= 0 ? 'Tank empty — buy fuel at the kiosk' : nepaOn(s) ? 'NEPA light is on — save the fuel' : null),
    effects: { gen: 'on', flags: ['gen_started'], happiness: 3 },
    result: 'You pull the cord. Once. Twice. VROOOM! Fans spin, phones charge, Iya Bisi shouts "God bless you!"',
  },
  { id: 'genoff', obj: 'generator', time: 0, label: () => 'Switch the generator off', cond: (s) => s.power.genOn, effects: { gen: 'off' }, result: 'The silence is loud. Fuel saved.' },

  // ── Water ──
  {
    id: 'pump', obj: 'tank', time: 1,
    label: (s) => `Pump water into the tank (1h, +${pumpGain(s)}%)`,
    blocked: (s) => (!hasPower(s) ? 'Pump needs power' : s.stats.water >= 100 ? 'Tank already full' : null),
    effects: { reputation: 1 },
    result: (s) => {
      addStat(s, 'water', pumpGain(s));
      return flag(s, 'pump_fixed') ? 'The new pump hums like a choir. The tank fills fast.' : 'The pump coughs and wheezes, but water climbs the pipe.';
    },
  },
  {
    id: 'vendor', obj: 'tank', time: 0.5, label: () => 'Buy water from the mai ruwa (₦1,500, +30%)',
    cond: (s) => s.stats.water < 70,
    blocked: (s) => (s.stats.cash < 1500 ? 'Not enough cash' : null),
    effects: { cash: -1500, water: 30 }, result: 'The water vendor rolls in his cart of jerrycans. Splash, pour, done.',
  },

  // ── Laundry ──
  {
    id: 'inspect_line', obj: 'laundry', time: 0.5, label: () => 'Inspect the laundry line closely',
    cond: (s) => s.missions['m_laundry'] === 'active' && !flag(s, 'laundry_inspected'),
    effects: { flags: ['laundry_inspected'] },
    result: 'Your peg is still there. Under it: a gold button... and a footprint in a size-45 sneaker. Someone was dancing here. Aunty Kemi sees everything — ask her.',
  },
  {
    id: 'wash', obj: 'laundry', time: 1, daily: true, label: () => 'Wash and hang your clothes (1h)',
    blocked: (s) => (s.stats.water < 5 ? 'No water to wash with' : null),
    effects: { happiness: 6, water: -5 }, result: 'Fresh clothes flapping in the sun. Small joy.',
  },

  // ── Courtyard ──
  { id: 'sweep', obj: 'chairs', time: 1, daily: true, label: () => 'Sweep the courtyard (1h)', effects: { condition: 10, reputation: 2, trust: { chief: 1, amaka: 1 } }, result: 'Broom, dust, a lost bottle cap and one of Tobi\'s guitar picks. Neat.' },
  { id: 'rest', obj: 'chairs', time: 1, label: () => 'Sit and relax (1h)', effects: { happiness: 6 }, result: 'You watch the compound go by. It is better than Netflix.' },
  {
    id: 'fix_things', obj: 'chairs', time: 2, daily: true, label: () => 'Fix the broken chairs and gate hinge (2h, ₦800 parts)',
    cond: (s) => s.day >= 2,
    blocked: (s) => (s.stats.cash < 800 ? 'Not enough cash' : null),
    effects: { cash: -800, condition: 12, reputation: 3, trust: { chief: 3 } }, result: 'Two chairs that no longer betray their sitters, and a gate that only squeaks politely.',
  },

  // ── Meter & board ──
  { id: 'bills', obj: 'meter', time: 0, label: () => 'View & pay shared bills', ui: 'bills', result: '' },
  { id: 'missions', obj: 'board', time: 0, label: () => 'Read missions & notices', ui: 'missions', result: '' },
];

export function actionsFor(s: GameState, obj: ObjId): ActionDef[] {
  return ACTIONS.filter((a) => a.obj === obj && (!a.cond || a.cond(s)) && !(a.daily && flag(s, `act_${a.id}_d${s.day}`)));
}

export function markAction(s: GameState, a: ActionDef): void {
  if (a.daily) setFlag(s, `act_${a.id}_d${s.day}`);
  if (a.id === 'repair') s.counters[`repairs_d${s.day}`] = (s.counters[`repairs_d${s.day}`] ?? 0) + 1;
}


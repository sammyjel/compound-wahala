import { getBill, paidCount, PAYERS } from '../engine/bills.ts';
import { flag } from '../engine/state.ts';
import type { Effects, GameState, NpcId } from '../types.ts';
import { NPC_IDS } from '../types.ts';

export interface Objective {
  text: string;
  done: (s: GameState) => boolean;
  progress?: (s: GameState) => [number, number];
}

export interface MissionDef {
  id: string;
  title: string;
  blurb: string;
  giver: NpcId | 'compound';
  unlock: (s: GameState) => boolean;
  objectives: Objective[];
  reward: Effects;
  rewardText: string;
  fail?: (s: GameState) => boolean;
  failText?: string;
}

const count = (s: GameState, prefix: string) => NPC_IDS.filter((id) => flag(s, prefix + id)).length;
const meetingWins = (s: GameState) =>
  Object.values(s.meetings).filter((m) => m.playerSide !== 'none' && (m.playerSide === 'yes') === m.passed).length;

export const MISSIONS: MissionDef[] = [
  {
    id: 'm_welcome', title: 'New Kid on the Block', giver: 'compound',
    blurb: 'Introduce yourself to all six residents. First impressions matter here.',
    unlock: () => true,
    objectives: [{ text: 'Meet every resident', done: (s) => count(s, 'met_') === 6, progress: (s) => [count(s, 'met_'), 6] }],
    reward: { cash: 1000, reputation: 5 }, rewardText: 'Chief sends ₦1,000 "to buy something for the new room". +5 Reputation.',
  },
  {
    id: 'm_light', title: 'Light Off, Wahala On', giver: 'bisi',
    blurb: 'NEPA took the light. Get fuel into the shared generator and start it.',
    unlock: (s) => s.seenEvents.includes('nepa_cut'),
    objectives: [
      { text: 'Get fuel (Iya Bisi sells it at the kiosk)', done: (s) => s.stats.fuel > 0 || flag(s, 'gen_started') },
      { text: 'Start the generator', done: (s) => flag(s, 'gen_started') },
    ],
    reward: { happiness: 8, trustAll: 2 }, rewardText: 'The gen roars to life. Cheers from every window. Everyone ♥ +2.',
  },
  {
    id: 'm_meeting1', title: 'Order! Order!', giver: 'chief',
    blurb: 'Chief has called an emergency compound meeting for 6pm about the missing fuel.',
    unlock: (s) => s.day === 1 || !!s.meetings['fuel_fund'],
    objectives: [{ text: 'Attend the 6pm compound meeting', done: (s) => !!s.meetings['fuel_fund'] && s.meetings['fuel_fund'].playerSide !== 'none' }],
    fail: (s) => !!s.meetings['fuel_fund'] && s.meetings['fuel_fund'].playerSide === 'none',
    failText: 'You walked out of your first meeting. People noticed.',
    reward: { reputation: 5 }, rewardText: 'You took part in your first compound meeting. +5 Reputation.',
  },
  {
    id: 'm_nepa', title: 'Bill Wahala', giver: 'chief',
    blurb: 'All six flats must pay the ₦2,000 NEPA bill before the end of Day 3, or the compound gets disconnected.',
    unlock: (s) => !!getBill(s, 'nepa'),
    objectives: [
      { text: 'Pay your own share', done: (s) => !!getBill(s, 'nepa')?.paid.you },
      { text: 'Every flat has paid', done: (s) => getBill(s, 'nepa')?.status === 'settled',
        progress: (s) => [getBill(s, 'nepa') ? paidCount(getBill(s, 'nepa')!) : 0, PAYERS.length] },
    ],
    fail: (s) => getBill(s, 'nepa')?.status === 'overdue',
    failText: 'The deadline passed with shares unpaid. NEPA cut the wire. Pay the remaining shares at the meter to reconnect.',
    reward: { reputation: 8, trustAll: 2 }, rewardText: 'Bill settled on time! The light stays on. +8 Reputation, everyone ♥ +2.',
  },
  {
    id: 'm_femi', title: 'Expecting Alert', giver: 'chief',
    blurb: 'Brother Femi has not paid his NEPA share. Persuade him, pay for him, or find him real income.',
    unlock: (s) => s.day >= 2 && !!getBill(s, 'nepa'),
    objectives: [{ text: "Femi's NEPA share gets paid (or he gets a steady job)", done: (s) => !!getBill(s, 'nepa')?.paid.femi || flag(s, 'femi_job') }],
    fail: (s) => getBill(s, 'nepa')?.status === 'overdue' && !getBill(s, 'nepa')?.paid.femi && !flag(s, 'femi_job'),
    failText: "Femi's share was still unpaid at the deadline.",
    reward: { reputation: 4 }, rewardText: 'Femi is sorted. +4 Reputation.',
  },
  {
    id: 'm_laundry', title: 'Who Carry My Shirt?', giver: 'compound',
    blurb: 'Your red shirt with the gold buttons vanished from the line. Investigate.',
    unlock: (s) => flag(s, 'laundry_case'),
    objectives: [
      { text: 'Inspect the laundry line', done: (s) => flag(s, 'laundry_inspected') },
      { text: 'Ask Aunty Kemi what she saw', done: (s) => flag(s, 'clue_kemi') },
      { text: 'Confront the culprit', done: (s) => flag(s, 'shirt_back') },
    ],
    reward: { happiness: 5, reputation: 2 }, rewardText: 'Case closed. Your shirt is back (and slightly famous).',
  },
  {
    id: 'm_amaka', title: 'Night Nurse Needs Sleep', giver: 'amaka',
    blurb: 'Nurse Amaka cannot sleep before her shifts. Find a way to help.',
    unlock: (s) => s.day >= 2 && flag(s, 'met_amaka'),
    objectives: [
      { text: 'Ask Amaka what would help (not in the afternoon!)', done: (s) => flag(s, 'amaka_asked') },
      { text: 'Bring earplugs (kiosk) or get Tobi to use headphones', done: (s) => flag(s, 'amaka_helped') },
    ],
    reward: { happiness: 6, reputation: 3 }, rewardText: 'Amaka finally sleeps. She leaves a thank-you note and a pack of vitamins at your door.',
  },
  {
    id: 'm_hustle', title: 'Hustle Season', giver: 'compound',
    blurb: 'Rent will not pay itself. Earn ₦12,000 from jobs: phone repairs, deliveries, helping at the kiosk.',
    unlock: () => true,
    objectives: [{ text: 'Earn ₦12,000 from work', done: (s) => s.earnedTotal >= 12000, progress: (s) => [Math.min(12000, s.earnedTotal), 12000] }],
    reward: { happiness: 10, reputation: 4 }, rewardText: 'Your hustle is noticed. Word spreads: Room 4 fixes phones well.',
  },
  {
    id: 'm_water', title: 'Water Na Life', giver: 'amaka',
    blurb: 'Keep the overhead tank healthy. Pump it to 90% or more (pumping needs power).',
    unlock: (s) => s.day >= 2 || s.stats.water < 30,
    objectives: [{ text: 'Fill the tank to 90%', done: (s) => s.stats.water >= 90, progress: (s) => [Math.round(s.stats.water), 90] }],
    reward: { trustAll: 2, reputation: 3 }, rewardText: 'A full tank! Everybody bathes like royalty. Everyone ♥ +2.',
  },
  {
    id: 'm_skit', title: 'Tobi Goes Viral?', giver: 'tobi',
    blurb: 'Tobi needs a co-star for his next skit. Help him film it.',
    unlock: (s) => s.day >= 3 && flag(s, 'met_tobi'),
    objectives: [{ text: 'Film the skit with Tobi (talk to him)', done: (s) => flag(s, 'skit_filmed') }],
    reward: { reputation: 3 }, rewardText: 'Skit filmed. Tobi says to check the views tomorrow morning...',
  },
  {
    id: 'm_radio', title: "Chief's Old Radio", giver: 'chief',
    blurb: "Chief's beloved radio only hisses. You repair electronics, don't you?",
    unlock: (s) => s.day >= 4 && flag(s, 'met_chief'),
    objectives: [
      { text: 'Ask Chief about it', done: (s) => flag(s, 'radio_job') },
      { text: 'Repair it at your door (needs power, 2h)', done: (s) => flag(s, 'radio_fixed') },
      { text: 'Return it to Chief', done: (s) => flag(s, 'radio_returned') },
    ],
    reward: { reputation: 2 }, rewardText: 'Chief tells the whole street about his "genius tenant".',
  },
  {
    id: 'm_insight', title: 'Know Your Neighbours', giver: 'kemi',
    blurb: 'Learn what every resident cares about — talk to them, or ask Aunty Kemi for gist. It helps you win meetings.',
    unlock: (s) => count(s, 'met_') >= 1,
    objectives: [{ text: 'Learn what all six residents care about', done: (s) => count(s, 'know_') === 6, progress: (s) => [count(s, 'know_'), 6] }],
    reward: { reputation: 5, flags: ['insight'] }, rewardText: 'You understand this compound now. +1 move in every future meeting.',
  },
  {
    id: 'm_clean', title: 'Clean Compound, Clear Mind', giver: 'chief',
    blurb: 'Get the compound condition to 75 or more. Sweep, fix things, keep the goats out.',
    unlock: (s) => s.day >= 3,
    objectives: [{ text: 'Compound condition 75+', done: (s) => s.stats.condition >= 75, progress: (s) => [Math.round(s.stats.condition), 75] }],
    reward: { happiness: 8, reputation: 5 }, rewardText: 'Unity Compound sparkles. Passers-by slow down to look.',
  },
  {
    id: 'm_chair', title: 'Voice of the Compound', giver: 'compound',
    blurb: 'Be on the winning side of three compound meetings.',
    unlock: (s) => !!s.meetings['fuel_fund'],
    objectives: [{ text: 'Win 3 compound votes', done: (s) => meetingWins(s) >= 3, progress: (s) => [meetingWins(s), 3] }],
    reward: { reputation: 10, happiness: 5 }, rewardText: 'People now say "Let us hear what Room 4 thinks." +10 Reputation.',
  },
];

export function missionById(id: string): MissionDef {
  const m = MISSIONS.find((x) => x.id === id);
  if (!m) throw new Error('Unknown mission ' + id);
  return m;
}

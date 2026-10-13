import { createBill, payShare } from '../engine/bills.ts';
import { addLog, addStat, addTrust, setFlag } from '../engine/state.ts';
import type { GameState, Line, NpcId, ValueKey } from '../types.ts';

export interface MotionTerms {
  /** What each tenant flat pays if it passes. */
  costPerFlat: number;
  /** How much the landlord's own contribution hurts his vote. */
  chiefPain: number;
  /** How the idea itself lands with each value (−2..+2). */
  appeals: Partial<Record<ValueKey, number>>;
  /** Personal stakes beyond values. */
  stakes: Partial<Record<NpcId, number>>;
  summary: string;
}

export interface ArgumentDef {
  value: ValueKey;
  label: string;
}

export interface MotionDef {
  id: string;
  day: number;
  title: string;
  /** Plain description of the problem. */
  problem: string;
  intro: Line[];
  terms: MotionTerms;
  amendment: { label: string; terms: MotionTerms };
  args: { yes: ArgumentDef[]; no: ArgumentDef[] };
  onPass: (s: GameState, amended: boolean, pledged: NpcId[]) => string;
  onFail: (s: GameState, amended: boolean) => string;
}

function payPledges(s: GameState, billId: string, pledged: NpcId[]): void {
  for (const id of pledged) payShare(s, billId, id);
}

export const MOTIONS: MotionDef[] = [
  {
    id: 'fuel_fund',
    day: 1,
    title: 'Who Finish the Fuel?',
    problem: 'The shared generator ran dry and nobody admits using the last drop. Chief wants a proper fuel fund.',
    intro: [
      { who: 'chief', text: 'Order! Order! Somebody finished the fuel in that generator and did not replace it. In my own compound!' },
      { who: 'femi', text: 'Chief, it is not me o. I was not even around. I was in a meeting with investors.', plain: "It wasn't me — I wasn't here." },
      { who: 'kemi', text: 'Hmm. Some of us were around. Some of us saw somebody charging three phones and a ring light.' },
      { who: 'tobi', text: 'Aunty, the ring light is for content! Content is work!' },
      { who: 'chief', text: 'Enough! Here is the motion. We vote like civilised people.' },
    ],
    terms: {
      costPerFlat: 1000,
      chiefPain: 0,
      appeals: { fairness: 1, business: 1, peace: 1, order: 1, fun: 0 },
      stakes: {},
      summary: 'Every flat pays ₦1,000 into a Generator Fuel Fund (again every other day). The fund buys 3L of fuel each morning and the gen runs every evening NEPA fails.',
    },
    amendment: {
      label: 'Halve it: ₦500 per flat, and the fund buys only 2L a day',
      terms: {
        costPerFlat: 500,
        chiefPain: 0,
        appeals: { fairness: 1, business: 1, peace: 1, order: 1, fun: 0 },
        stakes: {},
        summary: 'Every flat pays ₦500 into the Fuel Fund (again every other day). The fund buys 2L of fuel each morning.',
      },
    },
    args: {
      yes: [
        { value: 'fairness', label: '"Everybody enjoys the light — everybody should pay small."' },
        { value: 'business', label: '"Light is money. Freezers, repairs, hair dryers — all of us need it."' },
        { value: 'peace', label: '"One shared gen is quieter than six I-pass-my-neighbour gens."' },
        { value: 'order', label: '"A fund with a record book ends this who-finish-fuel fight for good."' },
      ],
      no: [
        { value: 'money', label: '"Prices are already high. Nobody needs another levy."' },
        { value: 'respect', label: '"We are grown adults. Let everyone buy their own fuel."' },
        { value: 'fairness', label: '"Nurse Amaka works nights — why should she pay for evening light?"' },
      ],
    },
    onPass: (s, amended, pledged) => {
      const per = amended ? 500 : 1000;
      addStat(s, 'cash', -per * (1 + pledged.length));
      if (pledged.length) addLog(s, `You also covered ${pledged.length} neighbour share(s) for the Fuel Fund.`, 'money');
      setFlag(s, 'fuel_fund');
      if (amended) setFlag(s, 'fuel_fund_small');
      addStat(s, 'fuel', amended ? 2 : 3);
      addTrust(s, 'bisi', 3);
      addTrust(s, 'amaka', 2);
      return `The Fuel Fund is born! You paid your ₦${per.toLocaleString()} share. Each morning the fund buys ${amended ? 2 : 3}L of fuel, and the gen runs automatically in the evening when NEPA fails.`;
    },
    onFail: (s) => {
      setFlag(s, 'no_fund');
      addTrust(s, 'bisi', -3);
      addTrust(s, 'amaka', -2);
      addLog(s, 'No fuel fund. Every evening is "who get fuel?" season.', 'bad');
      return 'No fund. It is every flat for itself — if you want light at night, you buy the fuel yourself.';
    },
  },
  {
    id: 'borehole',
    day: 3,
    title: 'The Pump Is Coughing',
    problem: 'The borehole pump now groans like an old man climbing stairs. Fix it properly, or let Mallam Garba patch it again?',
    intro: [
      { who: 'amaka', text: 'I queued at that tank at 5am after a twelve-hour shift and got half a bucket. Half.' },
      { who: 'chief', text: 'The pump needs a full repair. ₦18,000. Shared by the tenants, as the tenancy agreement says.', plain: 'Tenants should split the ₦18,000 repair.' },
      { who: 'femi', text: 'Which tenancy agreement? Chief, with all due respect, it is your borehole!' },
      { who: 'bisi', text: 'Abeg, whoever pays, let it be fixed. My customers are buying sachet water from my competitor.', plain: 'Please, just fix it.' },
    ],
    terms: {
      costPerFlat: 3000,
      chiefPain: 0,
      appeals: { order: 1, business: 1, peace: 1, money: 2, respect: 1 },
      stakes: {},
      summary: 'Full pump repair: ₦3,000 per flat (₦18,000 total), due end of Day 5. Once every share is paid, pumping fills the tank much faster.',
    },
    amendment: {
      label: 'Landlord pays half: ₦1,500 per flat, Chief adds ₦9,000',
      terms: {
        costPerFlat: 1500,
        chiefPain: 22,
        appeals: { order: 1, business: 1, peace: 1, money: 2, respect: 1, fairness: 1 },
        stakes: {},
        summary: 'Full repair, but the landlord pays half: ₦1,500 per flat plus ₦9,000 from Chief, due end of Day 5.',
      },
    },
    args: {
      yes: [
        { value: 'money', label: '"Patch-patch is how we end up paying three times for one pump."' },
        { value: 'order', label: '"Proper repair, proper receipt, proper compound."' },
        { value: 'peace', label: '"No more 5am fights at the tank."' },
        { value: 'business', label: '"Water brings customers. No water, no business."' },
      ],
      no: [
        { value: 'money', label: '"₦3,000 is heavy this month. Patch it for now."' },
        { value: 'fairness', label: '"The landlord owns the borehole. The landlord should fix it."' },
        { value: 'respect', label: '"Let Chief show the street he is a generous landlord."' },
      ],
    },
    onPass: (s, amended, pledged) => {
      createBill(s, 'pump', 'Pump repair', amended ? 1500 : 3000, 5);
      payShare(s, 'pump', 'you');
      payPledges(s, 'pump', pledged);
      if (amended) addTrust(s, 'chief', -2);
      addTrust(s, 'amaka', 3);
      return `Full repair approved. You paid your share; the rest is due by the end of Day 5. The pump is fixed the moment every flat has paid.`;
    },
    onFail: (s) => {
      setFlag(s, 'pump_patched');
      addTrust(s, 'amaka', -3);
      addTrust(s, 'chief', -2);
      return 'Mallam Garba will patch it "small-small". Pumping stays slow and the tank may run dry again.';
    },
  },
  {
    id: 'quiet_hours',
    day: 5,
    title: 'Speaker vs. Sleep',
    problem: "Tobi's speaker has been doing night vigils without the prayers. Nurse Amaka wants quiet hours with fines.",
    intro: [
      { who: 'amaka', text: 'I have one request in this life: to sleep before my shift. One.' },
      { who: 'tobi', text: 'Aunty, music is therapy! Studies have shown! I saw it on a skit!', plain: "Music is good for you — I saw it online." },
      { who: 'kemi', text: 'Eh-hen. Last night the bass shook my wig off its stand.' },
      { who: 'chief', text: 'Motion on the floor: quiet hours. Let us vote.' },
    ],
    terms: {
      costPerFlat: 0,
      chiefPain: 0,
      appeals: { peace: 2, order: 2, fun: -2, fairness: 1 },
      stakes: { tobi: -30, amaka: 15 },
      summary: 'No loud music after 10pm, every night. Offenders pay ₦2,000 into the compound fund.',
    },
    amendment: {
      label: 'Weekend pass: music allowed till midnight Fri & Sat, plus one "Compound Jam" a month',
      terms: {
        costPerFlat: 0,
        chiefPain: 0,
        appeals: { peace: 1, order: 1, fun: 0, fairness: 1 },
        stakes: { tobi: -6, amaka: 8 },
        summary: 'Quiet after 10pm on weeknights; music till midnight on Fridays and Saturdays; Tobi hosts one Compound Jam a month.',
      },
    },
    args: {
      yes: [
        { value: 'peace', label: '"People work. People need to sleep. Simple."' },
        { value: 'order', label: '"Clear rules mean no more midnight shouting matches."' },
        { value: 'fairness', label: '"One person\'s fun should not be everybody\'s punishment."' },
        { value: 'respect', label: '"A respectable compound is not a nightclub."' },
      ],
      no: [
        { value: 'fun', label: '"Life is short. Small music never killed anybody."' },
        { value: 'business', label: '"Tobi\'s music brings people. That is free advertising for the kiosk."' },
        { value: 'money', label: '"Fines are just another levy with a different name."' },
      ],
    },
    onPass: (s, amended) => {
      setFlag(s, 'quiet_hours');
      if (amended) {
        setFlag(s, 'compound_jam');
        addTrust(s, 'tobi', 2);
        addTrust(s, 'amaka', 4);
        return 'Quiet hours with a weekend pass! Amaka can sleep on weeknights, Tobi keeps his weekends and gets a monthly Compound Jam.';
      }
      addTrust(s, 'tobi', -6);
      addTrust(s, 'amaka', 6);
      return 'Quiet hours are law. Amaka is already snoring peacefully. Tobi is composing a protest song (quietly).';
    },
    onFail: (s) => {
      setFlag(s, 'loud_nights');
      addTrust(s, 'amaka', -6);
      addTrust(s, 'tobi', 4);
      return 'No quiet hours. The speaker lives on. Amaka is pricing earplugs in bulk.';
    },
  },
  {
    id: 'levy',
    day: 7,
    title: 'Paint Am Fresh!',
    problem: 'The compound looks tired. Chief proposes a Development Levy to repaint, fix the gate and plant flowers.',
    intro: [
      { who: 'chief', text: 'My people. This compound was the pride of Adebayo Close. Now even the gate is complaining.' },
      { who: 'chief', text: 'I will put down ₦20,000 of my own money. I ask each flat for ₦4,000.' },
      { who: 'femi', text: '₦4,000? Chief, the economy—' },
      { who: 'kemi', text: 'Femi, you bought new shades on Tuesday.' },
      { who: 'femi', text: 'Those are an investment in my brand!' },
    ],
    terms: {
      costPerFlat: 4000,
      chiefPain: 0,
      appeals: { respect: 2, order: 2, business: 1, fun: 1, money: -1, fairness: 1 },
      stakes: {},
      summary: '₦4,000 per flat plus ₦20,000 from Chief. Painters repaint the walls, the gate is fixed, flowers go in.',
    },
    amendment: {
      label: 'Painting Saturday: ₦2,000 per flat, Chief adds more, tenants paint together with jollof',
      terms: {
        costPerFlat: 2000,
        chiefPain: 10,
        appeals: { respect: 2, order: 1, business: 1, fun: 2, money: 0, fairness: 1 },
        stakes: {},
        summary: '₦2,000 per flat; Chief adds ₦30,000; everybody paints together on Saturday and Iya Bisi cooks jollof.',
      },
    },
    args: {
      yes: [
        { value: 'respect', label: '"Let Adebayo Close know Unity Compound is back!"' },
        { value: 'order', label: '"A fixed gate is a safe compound."' },
        { value: 'business', label: '"A fine compound attracts customers — and better tenants."' },
        { value: 'fun', label: '"Painting day, music, jollof. It will be a party!"' },
      ],
      no: [
        { value: 'money', label: '"Times are hard. Paint can wait."' },
        { value: 'fairness', label: '"Chief owns the building. Why are tenants paying to paint it?"' },
      ],
    },
    onPass: (s, amended, pledged) => {
      createBill(s, 'levy', 'Development Levy', amended ? 2000 : 4000, 8);
      payShare(s, 'levy', 'you');
      payPledges(s, 'levy', pledged);
      setFlag(s, 'levy_passed');
      if (amended) setFlag(s, 'paint_party');
      addStat(s, 'condition', 30);
      addStat(s, 'reputation', 5);
      addTrust(s, 'chief', 8);
      return amended
        ? 'Painting Saturday is on! Fresh walls, a fixed gate, flowers, and a pot of jollof the size of a drum.'
        : 'The levy passed. Painters arrive Monday. Unity Compound will shine again.';
    },
    onFail: (s) => {
      addTrust(s, 'chief', -8);
      addStat(s, 'condition', -5);
      return 'The levy failed. Chief stares at the peeling paint like it betrayed him personally.';
    },
  },
];

export function motionById(id: string): MotionDef {
  const m = MOTIONS.find((x) => x.id === id);
  if (!m) throw new Error('Unknown motion ' + id);
  return m;
}

export const VALUE_LABEL: Record<ValueKey, string> = {
  money: 'Saving money',
  fairness: 'Fairness',
  order: 'Order & rules',
  peace: 'Peace & quiet',
  fun: 'Fun & music',
  business: 'Business',
  respect: 'Respect & status',
};

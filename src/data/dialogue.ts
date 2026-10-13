import { getBill, payShare } from '../engine/bills.ts';
import { flag, setFlag } from '../engine/state.ts';
import type { Effects, GameState, Line, NpcId } from '../types.ts';
import { NPC_IDS } from '../types.ts';
import { NPCS } from './npcs.ts';
import { dayRng, pick } from '../engine/rng.ts';

export interface Choice {
  label: string;
  plain?: string;
  effects?: Effects;
  cond?: (s: GameState) => boolean;
  /** If set and returns a string, the choice shows disabled with this reason. */
  blocked?: (s: GameState) => string | null;
  reply: Line[] | ((s: GameState) => Line[]);
}

export interface Topic {
  id: string;
  npc: NpcId;
  label: string;
  kind: 'intro' | 'mission' | 'info' | 'chat' | 'service';
  cond?: (s: GameState) => boolean;
  once?: boolean;
  daily?: boolean;
  /** Hours. Default 0.5. */
  time?: number;
  lines: Line[] | ((s: GameState) => Line[]);
  effects?: Effects;
  choices?: Choice[];
}

const met = (id: NpcId) => (s: GameState) => flag(s, 'met_' + id);
const nepaOwed = (id: string) => (s: GameState) => {
  const b = getBill(s, 'nepa');
  return !!b && b.status !== 'settled' && !b.paid[id];
};

export const OPENERS: Record<NpcId, Record<'cold' | 'neutral' | 'warm' | 'close', Line>> = {
  chief: {
    cold: { who: 'npc', text: 'Hmph. You again. Speak quickly.' },
    neutral: { who: 'npc', text: 'Ah, my tenant. How is the body?' },
    warm: { who: 'npc', text: 'Ehen! The responsible one. Come, sit.' },
    close: { who: 'npc', text: 'My good child! If all tenants were like you, I would have hair on my head again.' },
  },
  kemi: {
    cold: { who: 'npc', text: "Oh. It's you. I'm busy with this hair." },
    neutral: { who: 'npc', text: 'Ah ah, neighbour! Come and gist me.', plain: 'Come and chat with me.' },
    warm: { who: 'npc', text: 'My person! Sit down, I have fresh gist.', plain: 'My friend! I have fresh news.' },
    close: { who: 'npc', text: 'My confidant! Close the gate, let me tell you something.' },
  },
  amaka: {
    cold: { who: 'npc', text: 'Yes? I have very little energy today.' },
    neutral: { who: 'npc', text: 'Hi. Make it quick, I need to rest before my shift.' },
    warm: { who: 'npc', text: 'Ah, hello! You are one of the sane ones here.' },
    close: { who: 'npc', text: 'My favourite neighbour! Have you been drinking water? Be honest.' },
  },
  femi: {
    cold: { who: 'npc', text: 'Boss, I am on an important call. Big deal. Very big.' },
    neutral: { who: 'npc', text: 'My guy! How far? Money dey?', plain: 'Hey friend! How are things? Got money?' },
    warm: { who: 'npc', text: 'Chairman! My partner in progress!' },
    close: { who: 'npc', text: 'Ah, the realest person in this compound. Respect, respect.' },
  },
  bisi: {
    cold: { who: 'npc', text: 'If you are not buying, abeg shift, you are blocking customers.', plain: 'Please move if not buying.' },
    neutral: { who: 'npc', text: 'Welcome o. What can I sell you today?' },
    warm: { who: 'npc', text: 'My customer! For you, I fit do small discount.', plain: 'For you, I can give a small discount.' },
    close: { who: 'npc', text: 'My dear! Come, I kept fresh bread for you.' },
  },
  tobi: {
    cold: { who: 'npc', text: "Mm. I'm editing. What's up?" },
    neutral: { who: 'npc', text: 'Yo! Neighbour! You dey vibe?', plain: 'Hey! You enjoying life?' },
    warm: { who: 'npc', text: 'My G! My day one! Come and see this new beat.' },
    close: { who: 'npc', text: 'Bestie! The one true supporter of DJ Tee!' },
  },
};

/** What happens when you knock on a resident's door while they're inside. */
export const KNOCK: Record<NpcId, { text: string; trust: number; canTalk: boolean }> = {
  chief: { text: 'Chief opens the door in his singlet. "Siesta is a human right in this compound." He talks to you anyway.', trust: -2, canTalk: true },
  kemi: { text: 'Aunty Kemi opens before you finish knocking. Of course she does.', trust: 0, canTalk: true },
  amaka: { text: '"WHO IS KNOCKING?! I worked twelve hours!" Nurse Amaka was asleep. She shuts the door.', trust: -6, canTalk: false },
  femi: { text: 'Femi peeks out. "Is it the landlord? Tell him I travelled." He lets you in.', trust: 0, canTalk: true },
  bisi: { text: 'Iya Bisi opens, counting the day\'s money. "Quick quick."', trust: -1, canTalk: true },
  tobi: { text: 'Tobi groans from under a blanket. "Bro... it is morning. Morning is illegal." He mumbles answers.', trust: -1, canTalk: true },
};

const PROVERBS = [
  { text: 'When the music changes, so does the dance.', plain: 'Adapt to new situations.' },
  { text: 'A child who says his mother will not sleep will not sleep either.', plain: 'If you cause trouble for others, you suffer too.' },
  { text: 'However long the night, the day will surely break.', plain: 'Hard times end.' },
  { text: 'The lizard that jumped from the high iroko tree said he would praise himself if nobody else did.', plain: 'Recognise your own achievements.' },
  { text: 'When two elephants fight, it is the grass that suffers.', plain: 'Conflicts between big people hurt the little ones.' },
];

const FEMI_DEALS = [
  { text: 'I am importing ring lights from China. Small capital, big margin. You want in?', plain: 'Want to invest in my business?' },
  { text: 'My guy is building an app that tells you when NEPA will bring light. Pre-revenue, but the vibes are strong.', plain: "It doesn't make money yet." },
  { text: 'I am now a consultant. What do I consult on? Consulting.' },
];

const TOBI_MUSIC = [
  { text: 'New track: "Gen Don Off" — Afrobeats remix. The bass drops exactly when NEPA takes light.' },
  { text: "I'm sampling Iya Bisi shouting 'Pure water!' Don't tell her. It's a tribute." },
  { text: 'One day, DJ Tee will play at a wedding with a real budget. Small chops for everybody.', plain: 'Snacks for everyone.' },
];

function knowsTopic(id: NpcId, label: string, lines: Line[]): Topic {
  return {
    id: `values_${id}`,
    npc: id,
    label,
    kind: 'info',
    cond: met(id),
    once: true,
    lines,
    effects: { flags: ['know_' + id], trust: { [id]: 3 } },
  };
}

export const TOPICS: Topic[] = [
  // ───────────── CHIEF ─────────────
  {
    id: 'intro_chief', npc: 'chief', label: 'Introduce yourself', kind: 'intro', once: true,
    lines: [{ who: 'npc', text: 'So you are the new tenant in Room 4. In my compound, we greet. Properly.' }],
    choices: [
      { label: '"Good morning sir! Chief, you are looking strong today!"', effects: { trust: { chief: 6 }, flags: ['met_chief'] },
        reply: [{ who: 'npc', text: 'Hehe! Strong like iroko. This one has home training. Welcome, my child.', plain: 'You were raised well.' }] },
      { label: '"Hi."', effects: { trust: { chief: -3 }, flags: ['met_chief'] },
        reply: [{ who: 'npc', text: '"Hi"? Am I your mate? Did we attend secondary school together? Hmph. Welcome, anyway.', plain: 'Show more respect to elders.' }] },
    ],
  },
  knowsTopic('chief', 'Ask about the compound', [
    { who: 'npc', text: 'I built this compound block by block in 1994. Every rule here has a reason. Every reason has a story.' },
    { who: 'npc', text: 'All I ask is order, and that people give respect where it is due. Is that too much?' },
    { who: 'narrator', text: 'Chief cares about ORDER and RESPECT. Proposals that keep the compound proper win him over.' },
  ]),
  {
    id: 'chat_chief', npc: 'chief', label: 'Ask for a proverb', kind: 'chat', daily: true, cond: met('chief'),
    lines: (s) => {
      const p = pick(dayRng(s.seed, s.day, 11), PROVERBS);
      return [{ who: 'npc', text: `Listen well: "${p.text}"`, plain: p.plain }, { who: 'narrator', text: 'Chief looks very pleased with himself.' }];
    },
    effects: { trust: { chief: 3 }, happiness: 2 },
  },
  {
    id: 'radio_ask', npc: 'chief', label: 'Ask if he needs anything', kind: 'mission', once: true,
    cond: (s) => s.missions['m_radio'] === 'active' && !flag(s, 'radio_job'),
    lines: [
      { who: 'npc', text: 'My old radio. It played the news when Nigeria won the 1996 Olympic football gold. Now it only plays hissing.' },
      { who: 'npc', text: 'They say you repair phones. Can you look at it? I will settle you.', plain: 'I will pay you.' },
    ],
    choices: [
      { label: '"Give it to me, Chief. I\'ll fix it."', effects: { flags: ['radio_job'], trust: { chief: 3 } },
        reply: [{ who: 'npc', text: 'Handle it like an egg.' }, { who: 'narrator', text: 'Fix it at your door (Room 4). Needs power, takes 2 hours.' }] },
      { label: '"I\'m too busy right now, sir."', reply: [{ who: 'npc', text: 'Busy. Everybody is busy. Hmm.' }] },
    ],
  },
  {
    id: 'radio_return', npc: 'chief', label: 'Return the fixed radio', kind: 'mission', once: true,
    cond: (s) => flag(s, 'radio_fixed'),
    lines: [
      { who: 'narrator', text: 'Chief switches it on. A crackle, then crisp news from Radio Lagos.' },
      { who: 'npc', text: 'Ah! It speaks! My child, you have done well. Take this, and greet your parents for me.' },
    ],
    effects: { cash: 3000, trust: { chief: 10 }, reputation: 4, flags: ['radio_returned'] },
  },
  {
    id: 'report_femi', npc: 'chief', label: "Report Femi's unpaid NEPA share", kind: 'mission', once: true,
    cond: (s) => met('chief')(s) && s.day >= 2 && nepaOwed('femi')(s) && !flag(s, 'femi_will_pay_nepa') && !flag(s, 'femi_job'),
    lines: [
      { who: 'npc', text: 'FEMI! JOHNSON! Come here this minute!' },
      { who: 'narrator', text: 'Femi appears instantly, looking like a man who has seen a ghost wearing a red cap.' },
      { who: 'npc', text: 'You will pay that NEPA bill before Day 3 ends, or your things will meet you outside.' },
    ],
    effects: { flags: ['femi_will_pay_nepa'], trust: { chief: 3, femi: -10, kemi: 2 }, reputation: 1 },
  },

  // ───────────── KEMI ─────────────
  {
    id: 'intro_kemi', npc: 'kemi', label: 'Introduce yourself', kind: 'intro', once: true,
    lines: [{ who: 'npc', text: "Welcome o! I'm Aunty Kemi. Anything you want to know about this compound, ask me first before you ask Google." }],
    choices: [
      { label: '"Thank you, Aunty! Your braids are too fine!"', plain: 'Your braids are beautiful!', effects: { trust: { kemi: 6 }, flags: ['met_kemi'] },
        reply: [{ who: 'npc', text: 'See this one! You have sense. I will braid yours one day — discount for fine people.' }] },
      { label: '"Nice to meet you."', effects: { trust: { kemi: 2 }, flags: ['met_kemi'] },
        reply: [{ who: 'npc', text: 'Hmm, quiet type. Quiet people always have the best secrets. I will find out.' }] },
    ],
  },
  knowsTopic('kemi', 'Ask about her life', [
    { who: 'npc', text: "I braid hair, I know people, people know me. When there's drama, I'm front row with popcorn." },
    { who: 'npc', text: 'But when Amaka had malaria, who cooked pepper soup? Me. Respect is earned.' },
    { who: 'narrator', text: 'Aunty Kemi cares about FUN (drama!) and RESPECT. She hates being left out.' },
  ]),
  {
    id: 'gist_kemi', npc: 'kemi', label: 'Ask: "Any gist?"', kind: 'info', daily: true, cond: met('kemi'),
    lines: (s) => {
      const unknown = NPC_IDS.filter((id) => id !== 'kemi' && !flag(s, 'know_' + id));
      if (!unknown.length) {
        return [{ who: 'npc', text: 'You now know everybody as well as I do. Be careful — that is how I started.' }];
      }
      const id = pick(dayRng(s.seed, s.day, 5), unknown);
      setFlag(s, 'know_' + id);
      return [
        { who: 'npc', text: `Come closer. ${NPCS[id].short}? Let me tell you...`, plain: 'Here is some gossip.' },
        { who: 'narrator', text: `You learn what ${NPCS[id].short} cares about: ${NPCS[id].caresAbout}` },
        { who: 'npc', text: 'Now you. What gist do YOU have for me?' },
      ];
    },
    choices: [
      { label: 'Share some gossip back (about Femi\'s debts)', effects: { trust: { kemi: 5, femi: -4 }, happiness: 2 },
        reply: [{ who: 'npc', text: 'Ehen! I knew it! Don\'t worry, it stays with me.' }, { who: 'narrator', text: '(It will not stay with her.)' }] },
      { label: '"Aunty, I don\'t carry gist."', plain: "I don't gossip.", effects: { trust: { kemi: -1 }, reputation: 1 },
        reply: [{ who: 'npc', text: 'Boring. But respectable. Hmph.' }] },
    ],
  },
  {
    id: 'braid_kemi', npc: 'kemi', label: 'Get your hair done (₦2,500, 2h)', kind: 'service', daily: true, time: 2,
    cond: (s) => met('kemi')(s),
    lines: [
      { who: 'npc', text: 'Sit. Don\'t move your head. While I braid, let me tell you about everybody on this street.' },
      { who: 'narrator', text: 'Two hours, forty stories, one fantastic hairstyle.' },
    ],
    effects: { cash: -2500, happiness: 15, trust: { kemi: 5 } },
  },
  {
    id: 'laundry_kemi', npc: 'kemi', label: 'Ask about your missing shirt', kind: 'mission', once: true,
    cond: (s) => s.missions['m_laundry'] === 'active' && flag(s, 'laundry_inspected'),
    lines: [
      { who: 'npc', text: 'Your red shirt with the gold buttons? Hmm. This morning I saw somebody dancing for a camera in a red shirt with gold buttons.' },
      { who: 'npc', text: 'I will not call names. But the person has a big speaker and an even bigger afro.', plain: "It's Tobi." },
    ],
    effects: { flags: ['clue_kemi'], trust: { kemi: 2 } },
  },

  // ───────────── AMAKA ─────────────
  {
    id: 'intro_amaka', npc: 'amaka', label: 'Introduce yourself', kind: 'intro', once: true,
    lines: [{ who: 'npc', text: "Hello. Amaka, Room 1. Sorry if I look like a zombie — night shift at General Hospital." }],
    choices: [
      { label: '"Thank you for the work you do, Nurse."', effects: { trust: { amaka: 6 }, flags: ['met_amaka'] },
        reply: [{ who: 'npc', text: 'Oh. That... actually means a lot. Nobody says that. Welcome, neighbour.' }] },
      { label: '"You look really tired."', effects: { trust: { amaka: -1 }, flags: ['met_amaka'] },
        reply: [{ who: 'npc', text: 'Thank you for the diagnosis, doctor. Welcome.' }] },
    ],
  },
  knowsTopic('amaka', 'Ask how she copes', [
    { who: 'npc', text: 'I pay my bills the day they arrive. I keep my side clean. I just want everyone else to do the same.' },
    { who: 'npc', text: 'And quiet. Please. I sleep in the afternoon — knock on my door then and you will meet my village people.', plain: 'You will see my angry side.' },
    { who: 'narrator', text: 'Amaka cares about FAIRNESS and PEACE & QUIET. Never wake her in the afternoon.' },
  ]),
  {
    id: 'chat_amaka', npc: 'amaka', label: 'Ask for a health tip', kind: 'chat', daily: true, cond: met('amaka'),
    lines: [{ who: 'npc', text: 'Drink water. Not Coke. Water. And stop eating suya at midnight.', plain: 'Avoid late-night spicy meat.' }],
    effects: { trust: { amaka: 2 }, happiness: 3 },
  },
  {
    id: 'amaka_need', npc: 'amaka', label: 'Ask what would help her', kind: 'mission', once: true,
    cond: (s) => s.missions['m_amaka'] === 'active',
    lines: [
      { who: 'npc', text: 'Honestly? Sleep. Tobi\'s speaker starts its concert exactly when I lie down.' },
      { who: 'npc', text: 'If he used headphones at night, or if I had proper earplugs... I would bless your name.' },
    ],
    effects: { flags: ['amaka_asked'] },
  },
  {
    id: 'amaka_earplugs', npc: 'amaka', label: 'Give her the earplugs', kind: 'mission', once: true,
    cond: (s) => s.missions['m_amaka'] === 'active' && flag(s, 'has_earplugs'),
    lines: [{ who: 'npc', text: 'Foam earplugs! The good ones! You are a blessing. I am going to sleep like a baby.' }],
    effects: { flags: ['amaka_helped'], unflags: ['has_earplugs'], trust: { amaka: 12 }, reputation: 3 },
  },
  {
    id: 'amaka_headphones', npc: 'amaka', label: 'Tell her Tobi will use headphones', kind: 'mission', once: true,
    cond: (s) => s.missions['m_amaka'] === 'active' && flag(s, 'tobi_headphones'),
    lines: [{ who: 'npc', text: 'You talked to Tobi? And he AGREED? You should be in government.' }],
    effects: { flags: ['amaka_helped'], trust: { amaka: 14 }, reputation: 4 },
  },

  // ───────────── FEMI ─────────────
  {
    id: 'intro_femi', npc: 'femi', label: 'Introduce yourself', kind: 'intro', once: true,
    lines: [{ who: 'npc', text: 'My person! Welcome! I am Femi — CEO, Femi Global Ventures Limited. Not yet registered, but the vision is registered.' }],
    choices: [
      { label: '"Nice to meet you, CEO!"', effects: { trust: { femi: 6 }, flags: ['met_femi'] },
        reply: [{ who: 'npc', text: 'See! You recognise greatness. We will do business together.' }] },
      { label: '"CEO of what, exactly?"', effects: { trust: { femi: 1 }, happiness: 2, flags: ['met_femi'] },
        reply: [{ who: 'npc', text: 'Of... ventures. Global ones. It is a long story. Welcome!' }] },
    ],
  },
  knowsTopic('femi', 'Ask about his business', [
    { who: 'npc', text: 'Between us? Things are a bit tight. But you cannot look broke — looking broke is how you stay broke.' },
    { who: 'npc', text: 'Every naira I spend must be an investment. Levies are not investments. Levies are pain.' },
    { who: 'narrator', text: 'Femi cares about MONEY and how he LOOKS. A steady job would change everything for him.' },
  ]),
  {
    id: 'chat_femi', npc: 'femi', label: 'Ask about his latest deal', kind: 'chat', daily: true, cond: met('femi'),
    lines: (s) => {
      const d = pick(dayRng(s.seed, s.day, 21), FEMI_DEALS);
      return [{ who: 'npc', text: d.text, plain: d.plain }];
    },
    effects: { trust: { femi: 2 }, happiness: 2 },
  },
  {
    id: 'femi_bill', npc: 'femi', label: 'Bring up the NEPA bill', kind: 'mission',
    cond: (s) => met('femi')(s) && nepaOwed('femi')(s) && !flag(s, 'femi_will_pay_nepa') && !flag(s, 'femi_job'),
    lines: [
      { who: 'npc', text: 'NEPA bill? Ah, yes. I am expecting an alert any moment now. Any moment.', plain: 'I am waiting for money to arrive.' },
      { who: 'narrator', text: 'He refreshes his banking app. Nothing.' },
    ],
    choices: [
      { label: 'Pay his ₦2,000 share for him', blocked: (s) => (s.stats.cash < 2000 ? 'Not enough cash' : null),
        effects: { run: (s) => { payShare(s, 'nepa', 'femi'); } },
        reply: [{ who: 'npc', text: 'Chairman! I will pay you back with interest when the alert lands. Put it in writing — no, don\'t.' }] },
      { label: '"Iya Bisi needs a delivery rider. Real money, every day."', cond: (s) => flag(s, 'bisi_needs_rider'),
        blocked: (s) => (s.trust.bisi < 55 ? 'Iya Bisi must trust you (55+) to vouch for him' : null),
        effects: { flags: ['femi_job'], trust: { femi: 10, bisi: 3 }, reputation: 3, log: 'Femi starts as Iya Bisi\'s delivery rider.' },
        reply: [{ who: 'npc', text: 'A job? A real one? With... salary? ...You know what. Let me try it. CEO and rider. Both can be true.' },
          { who: 'narrator', text: 'With steady income, Femi will pay his shares on time from now on.' }] },
      { label: '"Pay up, or I\'ll tell Chief."', effects: { flags: ['femi_will_pay_nepa'], trust: { femi: -8 }, reputation: 1 },
        reply: [{ who: 'npc', text: 'Haba! No need to involve the red cap. Fine, I will pay by the deadline.', plain: "Don't tell the landlord!" }] },
      { label: '"Okay, never mind."', reply: [{ who: 'npc', text: 'God bless you, my person. The alert is coming.' }] },
    ],
  },
  {
    id: 'femi_loan', npc: 'femi', label: 'Femi wants to borrow ₦3,000', kind: 'mission', once: true,
    cond: (s) => met('femi')(s) && s.day >= 3,
    lines: [{ who: 'npc', text: 'Small favour. Lend me ₦3,000. By Day 6 I will return it, plus extra. Business is business.' }],
    choices: [
      { label: 'Lend him ₦3,000', blocked: (s) => (s.stats.cash < 3000 ? 'Not enough cash' : null),
        effects: { cash: -3000, flags: ['femi_loan'], trust: { femi: 6 } },
        reply: [{ who: 'npc', text: 'You will not regret this! Probably!' }] },
      { label: '"Sorry, I\'m tight this week."', effects: { trust: { femi: -2 } },
        reply: [{ who: 'npc', text: 'No wahala. Everybody is tight. The economy is tight.' }] },
    ],
  },

  // ───────────── BISI ─────────────
  {
    id: 'intro_bisi', npc: 'bisi', label: 'Introduce yourself', kind: 'intro', once: true,
    lines: [{ who: 'npc', text: 'Welcome, new tenant! I am Iya Bisi. Fuel, water, noodles, credit for the honest. Buy something, bless your new house!' }],
    choices: [
      { label: 'Buy a sachet of water to "bless the house" (₦50)', effects: { cash: -50, happiness: 2, trust: { bisi: 6 }, flags: ['met_bisi'] },
        reply: [{ who: 'npc', text: 'First customer energy! This one will prosper.' }] },
      { label: '"Just greeting, Ma."', effects: { trust: { bisi: 2 }, flags: ['met_bisi'] },
        reply: [{ who: 'npc', text: 'Greeting is free. Fuel is not. I will see you soon.' }] },
    ],
  },
  knowsTopic('bisi', 'Ask how business is', [
    { who: 'npc', text: 'My freezer has fish, my customers want cold drinks, and NEPA wants me to suffer. Light is money for me.' },
    { who: 'npc', text: "And between us — I need a delivery rider. Somebody honest, with legs and a phone." },
    { who: 'narrator', text: 'Iya Bisi cares about BUSINESS and MONEY. She is hiring a delivery rider.' },
  ]),
  {
    id: 'chat_bisi', npc: 'bisi', label: 'Talk market prices', kind: 'chat', daily: true, cond: met('bisi'),
    lines: [{ who: 'npc', text: 'Tomatoes are now priced like gold. Soon I will sell one tomato with a receipt and a warranty.' }],
    effects: { trust: { bisi: 2 }, happiness: 2 },
  },

  // ───────────── TOBI ─────────────
  {
    id: 'intro_tobi', npc: 'tobi', label: 'Introduce yourself', kind: 'intro', once: true,
    lines: [{ who: 'npc', text: "Yo! New neighbour! I'm Tobi — DJ Tee to the streets. You get Instagram? Follow me, I follow back!" }],
    choices: [
      { label: '"Followed! Turn on post notifications too."', effects: { trust: { tobi: 6 }, flags: ['met_tobi'] },
        reply: [{ who: 'npc', text: 'Day one supporter! When I blow, you are in the documentary.', plain: 'When I become famous...' }] },
      { label: '"I don\'t really do social media."', effects: { trust: { tobi: -1 }, flags: ['met_tobi'] },
        reply: [{ who: 'npc', text: 'Ah. Old school. Respect, I guess. Like a museum.' }] },
    ],
  },
  knowsTopic('tobi', 'Ask about his dreams', [
    { who: 'npc', text: 'Big stage. Big crowd. My name on a poster. My dad says get a real job — but this IS real.' },
    { who: 'npc', text: "Rules? Curfews? That's my dad's language. But if YOU ask me nicely, I'll listen. You're my G." },
    { who: 'narrator', text: 'Tobi cares about FUN and RESPECT (clout). He follows people he trusts, not rules.' },
  ]),
  {
    id: 'chat_tobi', npc: 'tobi', label: 'Ask about his music', kind: 'chat', daily: true, cond: met('tobi'),
    lines: (s) => {
      const d = pick(dayRng(s.seed, s.day, 31), TOBI_MUSIC);
      return [{ who: 'npc', text: d.text, plain: d.plain }];
    },
    effects: { trust: { tobi: 2 }, happiness: 3 },
  },
  {
    id: 'tobi_nepa', npc: 'tobi', label: 'Remind him about the NEPA bill', kind: 'mission',
    cond: (s) => met('tobi')(s) && nepaOwed('tobi')(s) && !flag(s, 'tobi_will_pay_nepa') && !flag(s, 'tobi_deal'),
    lines: [{ who: 'npc', text: 'NEPA bill? Ehn... I go pay. Soon. Very soon. After my next gig.', plain: "I'll pay... eventually." }],
    choices: [
      { label: '"Tobi. Please. For me."', blocked: (s) => (s.trust.tobi < 55 ? 'Tobi needs to trust you more (55+)' : null),
        effects: { flags: ['tobi_will_pay_nepa'], trust: { tobi: 1 } },
        reply: [{ who: 'npc', text: 'Ah, you used the "for me" card. Okay okay. I\'ll pay before the deadline. Promise.' }] },
      { label: 'Pay his ₦2,000 share for him', blocked: (s) => (s.stats.cash < 2000 ? 'Not enough cash' : null),
        effects: { run: (s) => { payShare(s, 'nepa', 'tobi'); } },
        reply: [{ who: 'npc', text: 'You paid for me?! Bestie behaviour! Next song is dedicated to you.' }] },
      { label: '"Okay. Don\'t forget."', reply: [{ who: 'npc', text: 'Me? Forget? Never. (He has already forgotten.)' }] },
    ],
  },
  {
    id: 'laundry_tobi', npc: 'tobi', label: 'Is that MY shirt in your video?', kind: 'mission', once: true,
    cond: (s) => s.missions['m_laundry'] === 'active' && flag(s, 'clue_kemi'),
    lines: [
      { who: 'npc', text: "...Okay so, hear me out. The shirt has GOLD BUTTONS. The lighting was perfect. It was destiny." },
      { who: 'npc', text: 'The video has 3,000 views. Technically, your shirt is famous now.' },
    ],
    choices: [
      { label: 'Laugh: "At least tag me next time!"', effects: { trust: { tobi: 8 }, happiness: 6, flags: ['shirt_back', 'laundry_kind'] },
        reply: [{ who: 'npc', text: "TAG? I'll make you a co-star! Here's your shirt — freshly washed, I promise." }] },
      { label: 'Demand it back, sternly', effects: { trust: { tobi: -6 }, reputation: 2, flags: ['shirt_back', 'laundry_stern'] },
        reply: [{ who: 'npc', text: 'Sorry, sorry! Here. I just... wanted to look nice for the people.' }] },
      { label: '"That\'s ₦1,000 rental fee, superstar."', effects: { cash: 1000, trust: { tobi: -1 }, happiness: 3, flags: ['shirt_back', 'laundry_fee'] },
        reply: [{ who: 'npc', text: "Business-minded! Okay, okay, here's ₦1,000. Iya Bisi would be proud." }] },
    ],
  },
  {
    id: 'tobi_headphones', npc: 'tobi', label: 'Ask him to use headphones at night', kind: 'mission', once: true,
    cond: (s) => s.missions['m_amaka'] === 'active' && flag(s, 'amaka_asked') && !flag(s, 'tobi_headphones'),
    lines: [{ who: 'npc', text: 'Headphones? At night? But then how will the compound enjoy my art?' }],
    choices: [
      { label: '"Amaka saves lives. Let her sleep. Do it for me."', blocked: (s) => (s.trust.tobi < 55 ? 'Tobi needs to trust you more (55+)' : null),
        effects: { flags: ['tobi_headphones'], trust: { tobi: 2 } },
        reply: [{ who: 'npc', text: 'When you put it like that... fine. Headphones after 10. For Nurse Amaka. And for you.' }] },
      { label: 'Buy him proper headphones (₦3,000)', blocked: (s) => (s.stats.cash < 3000 ? 'Not enough cash' : null),
        effects: { cash: -3000, flags: ['tobi_headphones'], trust: { tobi: 6 } },
        reply: [{ who: 'npc', text: 'Studio headphones?! Bass boost?! Deal! The compound will hear nothing!' }] },
      { label: '"Do it, or Chief will hear about it."', effects: { flags: ['tobi_headphones'], trust: { tobi: -8 } },
        reply: [{ who: 'npc', text: "Wow. Okay. Didn't know we were enemies. Fine." }] },
    ],
  },
  {
    id: 'tobi_skit', npc: 'tobi', label: 'Help film his skit (2h)', kind: 'mission', once: true, time: 2,
    cond: (s) => s.missions['m_skit'] === 'active',
    lines: [
      { who: 'npc', text: 'Skit title: "When NEPA Brings Light For Two Seconds". You play the neighbour who screams UP NEPA. Action!' },
      { who: 'narrator', text: 'Seven takes. Iya Bisi photobombs twice. Aunty Kemi gives notes nobody asked for. It is perfect.' },
    ],
    effects: { flags: ['skit_filmed'], trust: { tobi: 10 }, happiness: 10 },
  },
];

export function topicById(id: string): Topic | undefined {
  return TOPICS.find((t) => t.id === id);
}

export function topicsFor(s: GameState, npc: NpcId): Topic[] {
  return TOPICS.filter((t) => {
    if (t.npc !== npc) return false;
    if (t.kind !== 'intro' && !flag(s, 'met_' + npc)) return false;
    if (t.once && flag(s, 'topic_' + t.id)) return false;
    if (t.daily && flag(s, `topic_${t.id}_d${s.day}`)) return false;
    return t.cond ? t.cond(s) : true;
  });
}

export function markTopic(s: GameState, t: Topic): void {
  if (t.once) setFlag(s, 'topic_' + t.id);
  if (t.daily) setFlag(s, `topic_${t.id}_d${s.day}`);
}

export function resolveLines(s: GameState, l: Line[] | ((s: GameState) => Line[])): Line[] {
  return typeof l === 'function' ? l(s) : l;
}


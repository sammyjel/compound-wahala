// Story Mode progress: stars, coins, unlocks. Pure logic + a tiny localStorage wrapper.
// Coins are in-game only and can never be bought with real money.

export const LEVEL_COUNT = 5;
const KEY = 'compoundWahala.story.v1';

export interface Progress {
  v: 1;
  /** Best stars per level (0 = not finished). */
  stars: number[];
  coins: number;
  /** Decorations bought. */
  owned: string[];
  /** Which player look is worn (0–2). */
  look: number;
}

export interface Decor { id: string; name: string; emoji: string; cost: number; blurb: string }

/** Things to spend coins on. Bought once, shown in the compound in every level. */
export const DECOR: Decor[] = [
  { id: 'bunting', name: 'Party flags', emoji: '🎏', cost: 30, blurb: 'Green and white flags across the building.' },
  { id: 'plants', name: 'Flower pots', emoji: '🌺', cost: 50, blurb: 'Bright flowers by the walls.' },
  { id: 'lights', name: 'Fairy lights', emoji: '✨', cost: 80, blurb: 'Twinkly lights on the balcony.' },
  { id: 'mural', name: 'Compound sign', emoji: '🎨', cost: 120, blurb: 'A painted "UNITY COMPOUND" sign by the gate.' },
];

/** Stars needed to wear each player look. */
export const LOOK_UNLOCK = [0, 4, 9];

export function newProgress(): Progress {
  return { v: 1, stars: Array(LEVEL_COUNT).fill(0), coins: 0, owned: [], look: 0 };
}

/** Fewer wrong guesses → more stars. You always get at least one: trying things is never punished. */
export function starsFor(mistakes: number): number {
  if (mistakes <= 1) return 3;
  if (mistakes <= 3) return 2;
  return 1;
}

export const totalStars = (p: Progress) => p.stars.reduce((a, b) => a + b, 0);
export const levelDone = (p: Progress, i: number) => (p.stars[i] ?? 0) > 0;
/** Level i is playable once the level before it is finished. */
export const levelUnlocked = (p: Progress, i: number) => i === 0 || levelDone(p, i - 1);
export const allDone = (p: Progress) => p.stars.every((s) => s > 0);
/** The level PLAY should open: the first unfinished one, else the last. */
export const nextLevel = (p: Progress) => {
  const i = p.stars.findIndex((s) => s === 0);
  return i === -1 ? LEVEL_COUNT - 1 : i;
};
export const lookUnlocked = (p: Progress, look: number) => totalStars(p) >= (LOOK_UNLOCK[look] ?? Infinity);
/** Full Week mode opens after the last level (or if you already have a week in progress). */
export const weekUnlocked = (p: Progress) => allDone(p);

export interface LevelResult { stars: number; best: boolean; coins: number; unlocked: number | null; newLooks: number[] }

/** Record a finished level. Coins earned during play are added here too. */
export function finishLevel(p: Progress, level: number, mistakes: number, coins: number): LevelResult {
  const wasUnlocked = levelUnlocked(p, level + 1);
  const looksBefore = LOOK_UNLOCK.map((_, i) => lookUnlocked(p, i));
  const stars = starsFor(mistakes);
  const best = stars > (p.stars[level] ?? 0);
  if (best) p.stars[level] = stars;
  p.coins += coins;
  const unlocked = level + 1 < LEVEL_COUNT && !wasUnlocked && levelUnlocked(p, level + 1) ? level + 1 : null;
  const newLooks = LOOK_UNLOCK.map((_, i) => i).filter((i) => !looksBefore[i] && lookUnlocked(p, i));
  return { stars, best, coins, unlocked, newLooks };
}

export function buy(p: Progress, id: string): boolean {
  const d = DECOR.find((x) => x.id === id);
  if (!d || p.owned.includes(id) || p.coins < d.cost) return false;
  p.coins -= d.cost;
  p.owned.push(id);
  return true;
}

// ───────────── Storage ─────────────

export function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return newProgress();
    const p = JSON.parse(raw) as Progress;
    if (p?.v !== 1 || !Array.isArray(p.stars)) return newProgress();
    const fresh = newProgress();
    return { ...fresh, ...p, stars: fresh.stars.map((_, i) => Math.max(0, Math.min(3, p.stars[i] ?? 0))), owned: Array.isArray(p.owned) ? p.owned : [] };
  } catch {
    return newProgress();
  }
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* private window: progress just isn't remembered */
  }
}

export function resetProgress(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

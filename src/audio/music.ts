// Background music: crossfading loops + short stings. Files live in /music next to
// index.html and stream in on demand. Missing files or blocked autoplay fail silently —
// the game never depends on music.

export type Track = 'title' | 'day' | 'night' | 'meeting' | 'tobi' | 'owambe';
export type Sting = 'win' | 'lose';

const FADE_MS = 1200;

let enabled = true;
let volume = 0.5;
let unlocked = false;
let wanted: Track | null = null;
let current: { name: Track; el: HTMLAudioElement } | null = null;
let ducked = false;

function src(name: string): string {
  return `music/${name}.mp3`;
}

function fade(el: HTMLAudioElement, to: number, ms: number, done?: () => void): void {
  const from = el.volume;
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    el.volume = Math.max(0, Math.min(1, from + (to - from) * k));
    if (k < 1) requestAnimationFrame(step);
    else done?.();
  };
  requestAnimationFrame(step);
}

function target(): number {
  return enabled ? volume * (ducked ? 0.25 : 1) : 0;
}

function start(name: Track): void {
  if (current?.name === name) {
    fade(current.el, target(), 400);
    return;
  }
  const old = current;
  if (old) fade(old.el, 0, FADE_MS, () => { old.el.pause(); old.el.src = ''; });
  current = null;
  if (!enabled || volume <= 0) return;
  const el = new Audio(src(name));
  el.loop = true;
  el.volume = 0;
  el.preload = 'auto';
  current = { name, el };
  el.play().then(() => fade(el, target(), FADE_MS)).catch(() => { /* autoplay blocked or file missing */ });
}

/** Ask for a track. It starts once the player has interacted with the page. */
export function playMusic(name: Track): void {
  wanted = name;
  if (unlocked) start(name);
}

export function sting(name: Sting): void {
  if (!enabled || !unlocked || volume <= 0) return;
  const el = new Audio(src(name));
  el.volume = Math.min(1, volume * 1.2);
  ducked = true;
  if (current) fade(current.el, target(), 300);
  const restore = () => {
    ducked = false;
    if (current) fade(current.el, target(), 800);
  };
  el.addEventListener('ended', restore);
  el.addEventListener('error', restore);
  el.play().catch(restore);
}

export function setMusic(on: boolean, vol: number): void {
  enabled = on;
  volume = vol;
  if (!enabled || volume <= 0) {
    if (current) {
      const old = current;
      current = null;
      fade(old.el, 0, 400, () => old.el.pause());
    }
    return;
  }
  if (current) fade(current.el, target(), 300);
  else if (unlocked && wanted) start(wanted);
}

/** Browsers block audio until a user gesture; call once on the first tap/click/key. */
export function unlockMusic(): void {
  if (unlocked) return;
  unlocked = true;
  if (wanted) start(wanted);
}

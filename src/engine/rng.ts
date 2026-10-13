// Small seeded RNG (mulberry32). Outcomes derived from it are reproducible per save,
// so reloading never re-rolls a day's events.

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dayRng(seed: number, day: number, salt = 0): () => number {
  return rng((seed ^ (day * 2654435761) ^ (salt * 40503)) >>> 0);
}

export function pick<T>(r: () => number, arr: T[]): T {
  return arr[Math.floor(r() * arr.length) % arr.length];
}

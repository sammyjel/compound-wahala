// Photoreal character art (generated locally with Z-Image via Pinokio, cut out with rembg).
// Files live in /chars next to index.html. If any fail to load, callers fall back to
// the vector characters in people.ts, so the game always has art.

import { NPC_IDS } from '../types.ts';

export type CharKey = (typeof NPC_IDS)[number] | 'player0' | 'player1' | 'player2';

const KEYS: CharKey[] = [...NPC_IDS, 'player0', 'player1', 'player2'];
const bodies = new Map<CharKey, HTMLImageElement>();
const faces = new Map<CharKey, HTMLImageElement>();

function load(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Load all character art; resolves after everything settles or `timeoutMs`. */
export function loadSprites(timeoutMs = 4000): Promise<void> {
  const all = KEYS.flatMap((k) => [
    load(`chars/${k}-body.webp`).then((img) => { if (img) bodies.set(k, img); }),
    load(`chars/${k}-face.webp`).then((img) => { if (img) faces.set(k, img); }),
  ]);
  return Promise.race([Promise.all(all).then(() => undefined), new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}

export const bodyImg = (k: CharKey) => bodies.get(k) ?? null;
export const faceImg = (k: CharKey) => faces.get(k) ?? null;

export interface SpriteOpts {
  t: number;
  phase?: number;
  facing?: 1 | -1;
  dance?: boolean;
  talking?: boolean;
  height?: number;
}

/** Draw a cut-out photo standing with its feet at (x, y). */
export function drawSprite(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, o: SpriteOpts): void {
  const t = o.t + (o.phase ?? 0);
  const H = o.height ?? 168;
  const W = (img.width / img.height) * H;
  const bob = o.dance ? Math.abs(Math.sin(t * 6)) * 6 : 0;
  const breathe = 1 + Math.sin(t * 2.2) * 0.008 + (o.talking ? Math.abs(Math.sin(t * 9)) * 0.006 : 0);
  const tilt = o.dance ? Math.sin(t * 6) * 0.05 : 0;

  ctx.save();
  ctx.fillStyle = 'rgba(30,20,10,0.25)';
  ctx.beginPath();
  ctx.ellipse(x, y, W * 0.42, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.translate(x, y - bob);
  ctx.rotate(tilt);
  ctx.scale((o.facing ?? 1) * 1, breathe);
  ctx.drawImage(img, -W / 2, -H, W, H);
  ctx.restore();
}

/** Paint a face portrait into a canvas (cover-fit). Returns false if the art isn't loaded. */
export function drawFace(canvas: HTMLCanvasElement, k: CharKey): boolean {
  const img = faceImg(k);
  const ctx = canvas.getContext('2d');
  if (!img || !ctx) return false;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return true;
}

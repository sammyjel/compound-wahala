// Procedural cartoon characters: big heads, bold outlines, readable silhouettes.
// Origin is at the feet; one unit ≈ one world pixel at scale 1 (≈130px tall).

import type { Look } from '../types.ts';

export interface PoseOpts {
  t: number;
  phase?: number;
  facing?: 1 | -1;
  talking?: boolean;
  dance?: boolean;
  wave?: boolean;
  sleepy?: boolean;
  shadow?: boolean;
}

const OUT = '#24150e';

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r + amt)));
  g = Math.max(0, Math.min(255, Math.round(g + amt)));
  b = Math.max(0, Math.min(255, Math.round(b + amt)));
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function fillStroke(ctx: CanvasRenderingContext2D, fill: string, lw = 2.4) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = lw;
  ctx.strokeStyle = OUT;
  ctx.stroke();
}

function limb(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, w: number, color: string) {
  ctx.lineCap = 'round';
  ctx.strokeStyle = OUT;
  ctx.lineWidth = w + 4.5;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, lw = 2.4) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  fillStroke(ctx, fill, lw);
}

export function drawPerson(ctx: CanvasRenderingContext2D, x: number, y: number, scale: number, look: Look, o: PoseOpts): void {
  const t = o.t + (o.phase ?? 0);
  const H = look.height;
  const bob = o.dance ? Math.abs(Math.sin(t * 6)) * 6 : Math.sin(t * 2) * 1.2;
  const sway = o.dance ? Math.sin(t * 6) * 0.08 : 0;
  const bw = look.build === 'slim' ? 32 : look.build === 'medium' ? 38 : 48;
  const has = (a: Look['acc'][number]) => look.acc.includes(a);
  const hair = has('grey') ? '#d8d8d8' : look.hairColor;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale * (o.facing ?? 1), scale);

  if (o.shadow !== false) {
    ctx.fillStyle = 'rgba(30,20,10,0.22)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 30, 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.scale(1, H);
  ctx.translate(0, -bob);
  ctx.rotate(sway);

  // Legs
  const legTop = -44;
  const legSpread = look.build === 'round' ? 10 : 8;
  const step = o.dance ? Math.sin(t * 6) * 5 : 0;
  limb(ctx, -legSpread, legTop, -legSpread - step, -6, 10, look.dress ? look.skin : look.bottom);
  limb(ctx, legSpread, legTop, legSpread + step, -6, 10, look.dress ? look.skin : look.bottom);
  // Shoes
  ctx.beginPath(); ctx.ellipse(-legSpread - step - 3, -3, 10, 5.5, 0, 0, Math.PI * 2); fillStroke(ctx, look.shoes);
  ctx.beginPath(); ctx.ellipse(legSpread + step + 3, -3, 10, 5.5, 0, 0, Math.PI * 2); fillStroke(ctx, look.shoes);

  // Arms (behind torso for the far arm)
  const shY = -86;
  const armSwing = o.dance ? Math.sin(t * 6 + 1) * 18 : Math.sin(t * 2) * 2;
  const leftHand = { x: -bw / 2 - 7, y: -50 + armSwing * 0.3 };
  const rightHand = o.wave
    ? { x: bw / 2 + 16, y: -128 + Math.sin(t * 8) * 6 }
    : o.dance
      ? { x: bw / 2 + 14, y: -96 - armSwing }
      : has('cane')
        ? { x: bw / 2 + 12, y: -54 }
        : { x: bw / 2 + 7, y: -50 - armSwing * 0.3 };

  // Torso / dress
  if (look.dress) {
    ctx.beginPath();
    ctx.moveTo(-bw / 2 + 2, shY);
    ctx.lineTo(bw / 2 - 2, shY);
    ctx.quadraticCurveTo(bw / 2 + 4, -60, bw / 2 + 10, -16);
    ctx.lineTo(-bw / 2 - 10, -16);
    ctx.quadraticCurveTo(-bw / 2 - 4, -60, -bw / 2 + 2, shY);
    ctx.closePath();
    fillStroke(ctx, look.top);
    // Wax-print pattern
    if (look.topAccent) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = look.topAccent;
      for (let i = -3; i <= 3; i++)
        for (let j = 0; j < 7; j++) {
          ctx.beginPath();
          ctx.arc(i * 11 + (j % 2) * 5.5, shY + 6 + j * 11, 2.6, 0, Math.PI * 2);
          ctx.fill();
        }
      ctx.restore();
    }
  } else {
    rr(ctx, -bw / 2, shY, bw, 46, 10);
    fillStroke(ctx, look.top);
    if (look.topAccent) {
      ctx.fillStyle = look.topAccent;
      ctx.fillRect(-bw / 2 + 3, shY + 30, bw - 6, 4);
      if (has('redcap')) {
        // embroidered kaftan neckline
        ctx.strokeStyle = look.topAccent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-4, shY + 2); ctx.lineTo(-4, shY + 26); ctx.moveTo(4, shY + 2); ctx.lineTo(4, shY + 26);
        ctx.stroke();
      }
    }
    // Belt line
    ctx.fillStyle = shade(look.bottom, -20);
    ctx.fillRect(-bw / 2 + 2, -44, bw - 4, 4);
  }

  if (has('apron')) {
    rr(ctx, -bw / 2 + 6, -66, bw - 12, 38, 6);
    fillStroke(ctx, '#f3ede0', 2);
    ctx.fillStyle = '#d9cfba';
    ctx.fillRect(-6, -56, 12, 8);
  }
  if (has('chain')) {
    ctx.strokeStyle = '#e6b422';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, shY + 2, 11, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }
  if (has('beads')) {
    for (let i = 0; i < 9; i++) {
      const a = 0.12 * Math.PI + (i / 8) * 0.76 * Math.PI;
      circle(ctx, Math.cos(a) * 13, shY + 1 + Math.sin(a) * 13, 2.6, '#c0392b', 1.2);
    }
  }

  // Arms
  const sleeve = look.dress && !look.topAccent ? look.skin : look.top;
  limb(ctx, -bw / 2 + 4, shY + 6, leftHand.x, leftHand.y, 9, sleeve);
  circle(ctx, leftHand.x, leftHand.y, 5, look.skin, 2);
  limb(ctx, bw / 2 - 4, shY + 6, rightHand.x, rightHand.y, 9, sleeve);
  circle(ctx, rightHand.x, rightHand.y, 5, look.skin, 2);

  if (has('cane')) {
    ctx.strokeStyle = OUT; ctx.lineWidth = 6; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(rightHand.x + 2, rightHand.y - 4); ctx.lineTo(rightHand.x + 8, -2); ctx.stroke();
    ctx.strokeStyle = '#2d2a4a'; ctx.lineWidth = 3.4; ctx.stroke();
    circle(ctx, rightHand.x + 2, rightHand.y - 6, 4, '#e6b422', 1.5);
  }
  if (has('phone') && !o.wave && !o.dance) {
    rr(ctx, leftHand.x - 4, leftHand.y - 12, 8, 13, 2);
    fillStroke(ctx, '#1b1b22', 1.5);
  }

  // Neck + head
  ctx.fillStyle = look.skin;
  ctx.fillRect(-5, shY - 8, 10, 10);
  const hx = 0, hy = -112;

  // Hair behind head
  if (look.hair === 'afro') circle(ctx, hx, hy - 6, 29, hair);
  if (look.hair === 'braids') {
    ctx.strokeStyle = hair; ctx.lineWidth = 4; ctx.lineCap = 'round';
    for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
      ctx.beginPath(); ctx.moveTo(hx + side * (14 + k * 3), hy); ctx.quadraticCurveTo(hx + side * (20 + k * 3), hy + 25, hx + side * (17 + k * 3), hy + 40); ctx.stroke();
    }
  }

  // Ears + head
  circle(ctx, hx - 21, hy + 2, 5, look.skin, 2);
  circle(ctx, hx + 21, hy + 2, 5, look.skin, 2);
  ctx.beginPath();
  ctx.ellipse(hx, hy, 21, 23, 0, 0, Math.PI * 2);
  fillStroke(ctx, look.skin);

  // Hair on top
  ctx.fillStyle = hair;
  if (look.hair === 'short' || look.hair === 'low' || look.hair === 'braids') {
    ctx.beginPath();
    ctx.ellipse(hx, hy - (look.hair === 'low' ? 13 : 11), 20, look.hair === 'low' ? 10 : 13, 0, Math.PI, 0);
    ctx.fill();
  }
  if (look.hair === 'puff') {
    ctx.beginPath(); ctx.ellipse(hx, hy - 12, 20, 12, 0, Math.PI, 0); ctx.fill();
    circle(ctx, hx, hy - 30, 12, hair);
  }
  if (look.hair === 'afro') {
    ctx.beginPath(); ctx.ellipse(hx, hy - 12, 21, 13, 0, Math.PI, 0); ctx.fill();
  }

  // Beard / stubble
  if (has('beard')) {
    ctx.beginPath(); ctx.ellipse(hx, hy + 14, 16, 10, 0, 0, Math.PI); fillStroke(ctx, hair, 1.5);
  }

  // Face
  const blink = !o.sleepy && Math.sin(t * 0.9 + 3) > 0.985;
  ctx.fillStyle = OUT;
  if (o.sleepy || blink) {
    ctx.lineWidth = 2; ctx.strokeStyle = OUT;
    ctx.beginPath(); ctx.moveTo(hx - 11, hy); ctx.lineTo(hx - 4, hy); ctx.moveTo(hx + 4, hy); ctx.lineTo(hx + 11, hy); ctx.stroke();
  } else {
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.ellipse(hx - 7.5, hy - 1, 5, 5.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(hx + 7.5, hy - 1, 5, 5.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = OUT;
    ctx.beginPath(); ctx.arc(hx - 6.5, hy, 2.8, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(hx + 8.5, hy, 2.8, 0, Math.PI * 2); ctx.fill();
  }
  // Brows
  ctx.strokeStyle = shade(hair, -10); ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.moveTo(hx - 12, hy - 9); ctx.lineTo(hx - 3, hy - 10); ctx.moveTo(hx + 3, hy - 10); ctx.lineTo(hx + 12, hy - 9); ctx.stroke();
  // Nose
  ctx.strokeStyle = shade(look.skin, -35); ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(hx + 1, hy + 6, 3.5, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
  // Mouth
  if (o.talking && Math.sin(t * 14) > -0.2) {
    ctx.fillStyle = '#5a1e1a';
    ctx.beginPath(); ctx.ellipse(hx + 1, hy + 14, 5, 3 + Math.abs(Math.sin(t * 14)) * 2.5, 0, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.strokeStyle = '#5a1e1a'; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.arc(hx + 1, hy + 9, 7, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke();
  }
  // Cheeks
  ctx.fillStyle = 'rgba(220,90,80,0.18)';
  ctx.beginPath(); ctx.arc(hx - 13, hy + 7, 4, 0, Math.PI * 2); ctx.arc(hx + 14, hy + 7, 4, 0, Math.PI * 2); ctx.fill();

  // Head accessories
  if (has('glasses')) {
    ctx.strokeStyle = OUT; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(hx - 7.5, hy - 1, 6.5, 0, Math.PI * 2); ctx.moveTo(hx + 14, hy - 1); ctx.arc(hx + 7.5, hy - 1, 6.5, 0, Math.PI * 2);
    ctx.moveTo(hx - 1, hy - 1); ctx.lineTo(hx + 1, hy - 1); ctx.stroke();
  }
  if (has('shades')) {
    rr(ctx, hx - 15, hy - 7, 13, 9, 3); fillStroke(ctx, '#111', 1.5);
    rr(ctx, hx + 2, hy - 7, 13, 9, 3); fillStroke(ctx, '#111', 1.5);
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(hx - 12, hy - 5, 4, 2); ctx.fillRect(hx + 5, hy - 5, 4, 2);
  }
  if (has('redcap')) {
    ctx.save();
    ctx.translate(hx + 2, hy - 20);
    ctx.rotate(-0.08);
    rr(ctx, -17, -22, 34, 24, 6);
    fillStroke(ctx, '#c0262d');
    ctx.fillStyle = '#9b1c22'; ctx.fillRect(-15, -2, 30, 3);
    ctx.restore();
  }
  if (has('headtie')) {
    ctx.save();
    ctx.translate(hx, hy - 20);
    ctx.beginPath();
    ctx.moveTo(-24, 6);
    ctx.quadraticCurveTo(-30, -22, 0, -24);
    ctx.quadraticCurveTo(30, -26, 26, 4);
    ctx.quadraticCurveTo(0, -2, -24, 6);
    ctx.closePath();
    fillStroke(ctx, look.topAccent ?? '#e6b422');
    ctx.beginPath(); ctx.ellipse(18, -20, 10, 7, 0.6, 0, Math.PI * 2); fillStroke(ctx, look.topAccent ?? '#e6b422');
    ctx.strokeStyle = shade(look.topAccent ?? '#e6b422', -40); ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-18, -8); ctx.quadraticCurveTo(0, -16, 20, -8); ctx.stroke();
    ctx.restore();
  }
  if (has('headphones')) {
    ctx.strokeStyle = OUT; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(hx, hy - 4, 26, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke();
    ctx.strokeStyle = '#2e2f45'; ctx.lineWidth = 3.5; ctx.stroke();
    rr(ctx, hx - 30, hy - 8, 10, 18, 4); fillStroke(ctx, '#2e2f45', 2);
    rr(ctx, hx + 20, hy - 8, 10, 18, 4); fillStroke(ctx, '#2e2f45', 2);
  }

  ctx.restore();
}

/** Draw a head-and-shoulders portrait into a small canvas. */
export function drawPortrait(canvas: HTMLCanvasElement, look: Look, bg = '#f6e7c8', t = 0): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const scale = w / 62;
  drawPerson(ctx, w / 2, h * 0.5 + 112 * scale * look.height, scale, look, { t, shadow: false });
}

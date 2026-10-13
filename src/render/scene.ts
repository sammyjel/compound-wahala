// Canvas renderer for Unity Compound. Reads game state, never mutates it.

import type { ObjId } from '../data/actions.ts';
import { NPCS, SPOTS } from '../data/npcs.ts';
import type { NpcWhere } from '../engine/game.ts';
import { flag, nepaOn } from '../engine/state.ts';
import type { GameState, Look, NpcId } from '../types.ts';
import { NPC_IDS } from '../types.ts';
import { drawPerson } from './people.ts';

export const W = 1280;
export const H = 720;

export interface Box { x: number; y: number; w: number; h: number; label: string; ax: number; ay: number; stand: { x: number; y: number } }

export const OBJ_BOXES: Record<ObjId, Box> = {
  gate: { x: 55, y: 285, w: 170, h: 190, label: 'Gate', ax: 140, ay: 292, stand: { x: 200, y: 560 } },
  kiosk: { x: 228, y: 328, w: 152, h: 152, label: 'Kiosk', ax: 304, ay: 334, stand: { x: 300, y: 560 } },
  laundry: { x: 396, y: 432, w: 214, h: 104, label: 'Laundry', ax: 600, ay: 436, stand: { x: 470, y: 600 } },
  chairs: { x: 575, y: 585, w: 270, h: 100, label: 'Chairs', ax: 708, ay: 592, stand: { x: 700, y: 700 } },
  board: { x: 662, y: 338, w: 92, h: 64, label: 'Notices', ax: 708, ay: 342, stand: { x: 708, y: 520 } },
  door: { x: 786, y: 356, w: 68, h: 118, label: 'Your room', ax: 820, ay: 360, stand: { x: 820, y: 530 } },
  meter: { x: 962, y: 360, w: 46, h: 60, label: 'Meter', ax: 985, ay: 364, stand: { x: 985, y: 530 } },
  tank: { x: 1032, y: 108, w: 200, h: 400, label: 'Water', ax: 1140, ay: 116, stand: { x: 1080, y: 560 } },
  generator: { x: 1088, y: 582, w: 154, h: 108, label: 'Generator', ax: 1165, ay: 590, stand: { x: 1050, y: 650 } },
};

export interface SceneDeps {
  getState: () => GameState | null;
  where: (id: NpcId) => NpcWhere;
  playerLook: () => Look;
  markers: () => Set<string>;
  settings: () => { labels: boolean; reduceMotion: boolean };
}

export type Pick = { kind: 'npc'; id: NpcId } | { kind: 'obj'; id: ObjId };

interface Floater { x: number; y: number; text: string; color: string; t0: number }
interface Bubble { npc: NpcId; text: string; t0: number }

const AMBIENT: Record<NpcId, { day: string[]; dark: string[] }> = {
  chief: { day: ['Order is order!', 'Who left this gate open?', 'In 1994...'], dark: ['This darkness is an insult.', 'NEPA, I greet you.'] },
  kemi: { day: ['Did you hear?!', 'Eh-hen!', 'Ahn ahn!'], dark: ['Who get fuel?', 'My phone is my torch.'] },
  amaka: { day: ['Drink water!', 'I need sleep.', 'Shift at 11...'], dark: ['Hot. So hot.'] },
  femi: { day: ['Alert loading...', 'Big deal, big deal.', 'CEO mindset.'], dark: ['Who finished the fuel? Not me.'] },
  bisi: { day: ['Pure water! Pure water!', 'Fuel dey!', 'No credit today!'], dark: ['My fish!', 'Gen! Somebody!'] },
  tobi: { day: ['Like and subscribe!', 'Content! Content!', 'Vibes only.'], dark: ['UP NEPA!', 'Phone at 2%...'] },
};

export class Scene {
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private baseScale = 0;
  private view = { s: 1, ox: 0, oy: 0, dpr: 1 };
  private raf = 0;
  private t0 = performance.now();
  private floaters: Floater[] = [];
  private bubble: Bubble | null = null;
  private nextBubble = 4;
  hover: Pick | null = null;
  selected: Pick | null = null;
  highlight: string | null = null;
  player = { x: 820, y: 540, tx: 820, ty: 540, facing: 1 as 1 | -1, cb: null as null | (() => void) };
  running = false;
  private cssW = 0;

  /** Keep the player near the centre when the world is wider than the canvas. */
  private updateCamera(snap = false): void {
    const { s } = this.view;
    const worldW = W * s;
    if (worldW <= this.cssW + 1) return;
    const target = Math.min(0, Math.max(this.cssW - worldW, this.cssW / 2 - this.player.x * s));
    this.view.ox = snap ? target : this.view.ox + (target - this.view.ox) * 0.12;
  }

  constructor(private canvas: HTMLCanvasElement, private deps: SceneDeps) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.frame();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  resize(): void {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    // Wider than 16:9 → letterbox. Narrower (phones) → fill the height and pan with the player.
    const s = r.width / r.height >= W / H ? r.height / H : Math.max(r.width / W, r.height / H);
    this.view = { s, ox: (r.width - W * s) / 2, oy: (r.height - H * s) / 2, dpr };
    this.cssW = r.width;
    this.updateCamera(true);
    const need = s * dpr;
    if (!this.base || Math.abs(need - this.baseScale) > 0.05) this.buildBase(need);
  }

  /** Convert a pointer event to world coords. */
  toWorld(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: (clientX - r.left - this.view.ox) / this.view.s, y: (clientY - r.top - this.view.oy) / this.view.s };
  }

  /** World coords → CSS pixels within the canvas element. */
  toScreen(x: number, y: number): { x: number; y: number } {
    return { x: x * this.view.s + this.view.ox, y: y * this.view.s + this.view.oy };
  }

  npcPos(id: NpcId): { x: number; y: number } | null {
    const w = this.deps.where(id);
    return w.status === 'here' ? SPOTS[w.spot] : null;
  }

  pick(x: number, y: number): Pick | null {
    const npcs = NPC_IDS.map((id) => ({ id, p: this.npcPos(id) }))
      .filter((n): n is { id: NpcId; p: { x: number; y: number } } => !!n.p)
      .sort((a, b) => b.p.y - a.p.y);
    for (const n of npcs) {
      const h = 140 * 1.0;
      if (x > n.p.x - 32 && x < n.p.x + 32 && y > n.p.y - h && y < n.p.y + 8) return { kind: 'npc', id: n.id };
    }
    for (const [id, b] of Object.entries(OBJ_BOXES) as Array<[ObjId, Box]>) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return { kind: 'obj', id };
    }
    return null;
  }

  walkTo(x: number, y: number, cb?: () => void): void {
    const p = this.player;
    p.tx = Math.max(40, Math.min(W - 40, x));
    p.ty = Math.max(500, Math.min(H - 12, y));
    p.facing = p.tx < p.x ? -1 : 1;
    p.cb = cb ?? null;
    if (this.deps.settings().reduceMotion || !this.running) {
      p.x = p.tx;
      p.y = p.ty;
      const c = p.cb;
      p.cb = null;
      c?.();
    }
  }

  approach(target: Pick): { x: number; y: number } {
    if (target.kind === 'obj') return OBJ_BOXES[target.id].stand;
    const p = this.npcPos(target.id) ?? { x: 820, y: 540 };
    if (p.y < 400) return { x: p.x + 20, y: 520 }; // balcony: stand below
    const side = p.x > this.player.x ? -1 : 1;
    return { x: p.x + side * 62, y: p.y + 6 };
  }

  float(x: number, y: number, text: string, tone: 'good' | 'bad' | 'neutral'): void {
    const color = tone === 'good' ? '#3ddc84' : tone === 'bad' ? '#ff6b6b' : '#ffe08a';
    const stack = this.floaters.filter((f) => performance.now() - f.t0 < 600).length;
    this.floaters.push({ x, y: y - stack * 26, text, color, t0: performance.now() });
  }

  // ───────────────────────── Frame ─────────────────────────

  private frame(): void {
    const now = performance.now();
    const t = (now - this.t0) / 1000;
    const s = this.deps.getState();
    const ctx = this.ctx;

    // Walk
    const p = this.player;
    const dx = p.tx - p.x, dy = p.ty - p.y;
    const dist = Math.hypot(dx, dy);
    if (dist > 1) {
      const step = Math.min(dist, 13);
      p.x += (dx / dist) * step;
      p.y += (dy / dist) * step;
    } else if (p.cb) {
      const c = p.cb;
      p.cb = null;
      c();
    }

    this.updateCamera();
    const { s: vs, ox, oy, dpr } = this.view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#1b1410';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(vs * dpr, 0, 0, vs * dpr, ox * dpr, oy * dpr);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.clip();

    const hour = s?.hour ?? 10;
    const dark = darkness(hour);
    const powered = s ? nepaOn(s) || (s.power.genOn && s.stats.fuel > 0) : true;

    this.drawSky(hour, t);
    if (this.base) ctx.drawImage(this.base, 0, 0, W, H);
    if (s) this.drawDynamic(s, t);
    this.drawPeople(s, t, dist > 1, powered);
    if (s) this.drawLighting(dark, powered, t);
    ctx.restore();

    // Screen-space overlays (labels, markers, bubbles, floaters) for legible text at any size.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (s) this.drawOverlays(s, t, now);
  }

  private drawSky(hour: number, t: number): void {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, 340);
    const [top, bottom] = skyColors(hour);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, 360);
    const dk = darkness(hour);
    if (dk > 0.35) {
      ctx.fillStyle = `rgba(255,255,240,${(dk - 0.35) * 2})`;
      for (let i = 0; i < 40; i++) {
        const x = (i * 197) % W, y = (i * 83) % 220;
        const tw = 0.6 + Math.sin(t * 2 + i) * 0.4;
        ctx.globalAlpha = tw * (dk - 0.35) * 2.2;
        ctx.fillRect(x, y, 2, 2);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#f4f1de';
      ctx.beginPath();
      ctx.arc(1010, 70, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = skyColors(hour)[0];
      ctx.beginPath();
      ctx.arc(1022, 62, 24, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const k = Math.max(0, Math.min(1, (hour - 6) / 14));
      const sx = 120 + k * 1040, sy = 220 - Math.sin(k * Math.PI) * 170;
      const sg = ctx.createRadialGradient(sx, sy, 10, sx, sy, 90);
      sg.addColorStop(0, 'rgba(255,240,180,0.9)');
      sg.addColorStop(1, 'rgba(255,240,180,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(sx - 90, sy - 90, 180, 180);
      ctx.fillStyle = hour > 17 ? '#ffb347' : '#fff3b0';
      ctx.beginPath();
      ctx.arc(sx, sy, 28, 0, Math.PI * 2);
      ctx.fill();
    }
    // Clouds
    ctx.fillStyle = dk > 0.4 ? 'rgba(80,90,130,0.35)' : 'rgba(255,255,255,0.85)';
    for (let i = 0; i < 4; i++) {
      const x = ((i * 360 + t * (6 + i * 2)) % (W + 300)) - 150, y = 40 + i * 32;
      cloud(ctx, x, y, 1 + (i % 2) * 0.4);
    }
  }

  // ───────────────────────── Static base ─────────────────────────

  private buildBase(scale: number): void {
    const c = document.createElement('canvas');
    c.width = Math.round(W * scale);
    c.height = Math.round(H * scale);
    const ctx = c.getContext('2d')!;
    ctx.scale(scale, scale);
    drawBase(ctx);
    this.base = c;
    this.baseScale = scale;
  }

  // ───────────────────────── Dynamic props ─────────────────────────

  private drawDynamic(s: GameState, t: number): void {
    const ctx = this.ctx;
    const on = nepaOn(s);

    // Meter LED
    ctx.fillStyle = s.power.disconnected ? '#555' : on ? (Math.sin(t * 4) > 0 ? '#3ddc84' : '#1f7a49') : '#ff3b3b';
    ctx.beginPath(); ctx.arc(993, 378, 4, 0, Math.PI * 2); ctx.fill();
    if (s.power.disconnected) {
      ctx.fillStyle = '#d63031'; ctx.fillRect(966, 404, 38, 12);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 8px sans-serif'; ctx.fillText('CUT', 976, 413);
    }

    // Tank water gauge
    const lvl = s.stats.water / 100;
    ctx.fillStyle = '#0d1b2a'; ctx.fillRect(1224, 150, 10, 92);
    ctx.fillStyle = lvl < 0.15 ? '#ff6b6b' : '#4fc3f7';
    ctx.fillRect(1225, 151 + 90 * (1 - lvl), 8, 90 * lvl);

    // Generator
    const running = s.power.genOn && s.stats.fuel > 0 && !on;
    const shake = running ? Math.sin(t * 60) * 1.2 : 0;
    drawGenerator(ctx, 1105 + shake, 605, running);
    if (running) {
      for (let i = 0; i < 4; i++) {
        const k = ((t * 0.8 + i * 0.25) % 1);
        ctx.fillStyle = `rgba(90,90,90,${0.45 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(1222 + k * 22, 590 - k * 70, 8 + k * 16, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (s.stats.fuel > 0) drawJerrycan(ctx, 1062, 668, '#e1b12c');

    // Laundry
    drawLaundry(ctx, t, !flag(s, 'shirt_back') && flag(s, 'laundry_case'));

    // Refuse pile
    if (flag(s, 'refuse_pile') && !flag(s, 'waste_settled')) {
      ctx.fillStyle = '#5b4a3a';
      ctx.beginPath(); ctx.ellipse(270, 640, 60, 22, 0, 0, Math.PI * 2); ctx.fill();
      const junk = ['#2d3436', '#e17055', '#74b9ff', '#fdcb6e', '#00b894'];
      for (let i = 0; i < 12; i++) { ctx.fillStyle = junk[i % 5]; ctx.fillRect(225 + (i * 37) % 90, 622 + (i * 13) % 26, 14, 9); }
      ctx.strokeStyle = 'rgba(120,140,60,0.6)'; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) { ctx.beginPath(); const x = 245 + i * 25; ctx.moveTo(x, 615); ctx.quadraticCurveTo(x + 8 * Math.sin(t * 2 + i), 590, x, 570); ctx.stroke(); }
    }

    // Goat
    if (flag(s, 'goat_here')) drawGoat(ctx, 880 + Math.sin(t * 0.4) * 60, 680, t);

    // Fresh paint shimmer when the levy passed
    if (flag(s, 'levy_passed')) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(380, 150, 640, 322);
    }
  }

  private drawPeople(s: GameState | null, t: number, walking: boolean, powered: boolean): void {
    const ctx = this.ctx;
    const list: Array<{ y: number; draw: () => void; balcony?: boolean }> = [];
    if (s) {
      const night = s.hour >= 20;
      for (const id of NPC_IDS) {
        const pos = this.npcPos(id);
        if (!pos) continue;
        const sel = this.selected?.kind === 'npc' && this.selected.id === id;
        const dance = id === 'tobi' && (night || s.hour >= 17) && (powered || night) && !flag(s, 'tobi_headphones');
        const wave = id === 'kemi' && !flag(s, 'met_kemi') && s.day === 1;
        list.push({
          y: pos.y,
          balcony: pos.y < 400,
          draw: () => {
            if (sel || this.highlight === id) ring(ctx, pos.x, pos.y, t);
            drawPerson(ctx, pos.x, pos.y, 1, NPCS[id].look, {
              t, phase: id.length * 1.7, talking: sel, dance, wave, facing: pos.x > this.player.x ? -1 : 1,
              sleepy: id === 'amaka' && s.hour < 9,
            });
          },
        });
      }
    }
    const p = this.player;
    list.push({
      y: p.y,
      draw: () => {
        const bounce = walking ? Math.abs(Math.sin(t * 12)) * 3 : 0;
        drawPerson(ctx, p.x, p.y - bounce, 1, this.deps.playerLook(), { t, facing: p.facing });
        ctx.fillStyle = '#ffd23f';
        ctx.beginPath(); ctx.moveTo(p.x - 7, p.y - 168); ctx.lineTo(p.x + 7, p.y - 168); ctx.lineTo(p.x, p.y - 158); ctx.closePath(); ctx.fill();
      },
    });
    list.sort((a, b) => a.y - b.y);
    for (const it of list.filter((x) => x.balcony)) it.draw();
    drawRailing(ctx);
    for (const it of list.filter((x) => !x.balcony)) it.draw();
  }

  private drawLighting(dark: number, powered: boolean, t: number): void {
    if (dark <= 0.02) return;
    const ctx = this.ctx;
    ctx.fillStyle = `rgba(14,18,52,${dark})`;
    ctx.fillRect(0, 0, W, H);
    if (dark < 0.12) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const lights: Array<[number, number, number]> = [];
    if (powered) {
      for (const [x, y] of WINDOWS) lights.push([x + 25, y + 25, 70]);
      for (const x of [420, 556, 626, 818, 890]) lights.push([x, 352, 90]);
      lights.push([700, 300, 140]);
    } else {
      // Phone torches and a lantern
      for (const id of NPC_IDS) {
        const p = this.npcPos(id);
        if (p) lights.push([p.x + 10, p.y - 60, 48 + Math.sin(t * 3 + p.x) * 3]);
      }
      lights.push([this.player.x + 10, this.player.y - 60, 50]);
    }
    for (const [x, y, r] of lights) {
      const g = ctx.createRadialGradient(x, y, 2, x, y, r);
      g.addColorStop(0, `rgba(255,200,110,${0.55 * dark + 0.1})`);
      g.addColorStop(1, 'rgba(255,200,110,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    ctx.restore();
    if (powered) {
      ctx.fillStyle = 'rgba(255,214,120,0.85)';
      for (const [x, y] of WINDOWS) ctx.fillRect(x + 4, y + 4, 42, 42);
      ctx.strokeStyle = '#2b2b2b'; ctx.lineWidth = 2;
      for (const [x, y] of WINDOWS) for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + i * 12.5, y + 2); ctx.lineTo(x + i * 12.5, y + 48); ctx.stroke(); }
    }
  }

  private drawOverlays(s: GameState, t: number, now: number): void {
    const ctx = this.ctx;
    const { labels } = this.deps.settings();
    const markers = this.deps.markers();
    const vs = this.view.s;
    const small = vs < 0.5;
    const font = small ? 10 : 12;

    if (labels && !small) {
      for (const [id, b] of Object.entries(OBJ_BOXES) as Array<[ObjId, Box]>) {
        const sp = this.toScreen(b.ax, b.ay);
        const isHover = (this.hover?.kind === 'obj' && this.hover.id === id) || this.highlight === id;
        pill(ctx, sp.x, sp.y, b.label, font, isHover ? '#ffd23f' : 'rgba(20,14,10,0.72)', isHover ? '#1b1410' : '#fff');
      }
    }
    for (const id of NPC_IDS) {
      const p = this.npcPos(id);
      if (!p) continue;
      const sp = this.toScreen(p.x, p.y - 150 * NPCS[id].look.height);
      const isHover = (this.hover?.kind === 'npc' && this.hover.id === id) || this.highlight === id;
      if (labels || isHover) pill(ctx, sp.x, sp.y, NPCS[id].short, font, isHover ? '#ffd23f' : 'rgba(20,14,10,0.78)', isHover ? '#1b1410' : '#ffe9b0');
      if (markers.has(id)) badge(ctx, sp.x + (small ? 26 : 34), sp.y - 6 + Math.sin(t * 4) * 3, small);
    }
    for (const [id, b] of Object.entries(OBJ_BOXES) as Array<[ObjId, Box]>) {
      if (!markers.has(id)) continue;
      const sp = this.toScreen(b.ax, b.ay);
      badge(ctx, sp.x + (small ? 26 : 34), sp.y - 6 + Math.sin(t * 4) * 3, small);
    }

    // Ambient chatter
    if (!this.bubble && t > this.nextBubble) {
      const here = NPC_IDS.filter((id) => this.npcPos(id) && !(this.selected?.kind === 'npc' && this.selected.id === id));
      if (here.length) {
        const id = here[Math.floor(Math.random() * here.length)];
        const darkNoPower = darkness(s.hour) > 0.3 && !(nepaOn(s) || s.power.genOn);
        const pool = darkNoPower || !nepaOn(s) ? AMBIENT[id].dark : AMBIENT[id].day;
        this.bubble = { npc: id, text: pool[Math.floor(Math.random() * pool.length)], t0: t };
      }
      this.nextBubble = t + 6 + Math.random() * 6;
    }
    if (this.bubble) {
      const age = t - this.bubble.t0;
      const p = this.npcPos(this.bubble.npc);
      if (age > 3.2 || !p) this.bubble = null;
      else {
        const sp = this.toScreen(p.x + 40, p.y - 170 * NPCS[this.bubble.npc].look.height);
        ctx.globalAlpha = Math.min(1, age * 4, (3.2 - age) * 3);
        speech(ctx, sp.x, sp.y, this.bubble.text, small ? 10 : 12);
        ctx.globalAlpha = 1;
      }
    }

    // Floating feedback
    this.floaters = this.floaters.filter((f) => now - f.t0 < 1800);
    for (const f of this.floaters) {
      const k = (now - f.t0) / 1800;
      const sp = this.toScreen(f.x, f.y);
      ctx.globalAlpha = 1 - k * k;
      ctx.font = `800 ${small ? 13 : 17}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(f.text, sp.x, sp.y - k * 50);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, sp.x, sp.y - k * 50);
      ctx.globalAlpha = 1;
    }
  }
}

// ───────────────────────── Helpers ─────────────────────────

export function darkness(h: number): number {
  if (h < 7.5) return 0.3;
  if (h < 8.5) return 0.3 * (8.5 - h);
  if (h < 17) return 0;
  if (h < 19) return ((h - 17) / 2) * 0.38;
  if (h < 20.5) return 0.38 + ((h - 19) / 1.5) * 0.26;
  return 0.64;
}

function skyColors(h: number): [string, string] {
  if (h < 8.5) return ['#7d8fd6', '#f7b98d'];
  if (h < 16) return ['#4aa3f0', '#bfe6ff'];
  if (h < 18) return ['#5b86d6', '#ffc58a'];
  if (h < 19.5) return ['#38407a', '#f08a5d'];
  return ['#0c1236', '#26305e'];
}

function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, k: number) {
  ctx.beginPath();
  ctx.ellipse(x, y, 46 * k, 16 * k, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 30 * k, y - 10 * k, 30 * k, 18 * k, 0, 0, Math.PI * 2);
  ctx.ellipse(x - 26 * k, y - 4 * k, 26 * k, 14 * k, 0, 0, Math.PI * 2);
  ctx.fill();
}

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  ctx.strokeStyle = `rgba(255,210,63,${0.6 + Math.sin(t * 5) * 0.3})`;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(x, y, 40, 11, 0, 0, Math.PI * 2);
  ctx.stroke();
}

function pill(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, size: number, bg: string, fg: string) {
  ctx.font = `700 ${size}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + size * 1.2;
  const h = size * 1.75;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y - h / 2 + 0.5);
  ctx.textBaseline = 'alphabetic';
}

function badge(ctx: CanvasRenderingContext2D, x: number, y: number, small: boolean) {
  const r = small ? 8 : 10;
  ctx.fillStyle = '#ff5d3a';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y - r, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `900 ${r * 1.4}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', x, y - r + 1);
  ctx.textBaseline = 'alphabetic';
}

function speech(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, size: number) {
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 16;
  const h = size + 12;
  ctx.fillStyle = '#fffaf0';
  ctx.strokeStyle = '#24150e';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(x - 8, y - h, w, h, 8);
  ctx.moveTo(x + 2, y);
  ctx.lineTo(x - 8, y + 8);
  ctx.lineTo(x + 12, y);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#24150e';
  ctx.textAlign = 'left';
  ctx.fillText(text, x, y - 6 - (h - size - 12) / 2);
}

// Window positions (top-left) used for the night glow.
const WINDOWS: Array<[number, number]> = [
  [528, 180], [628, 180], [728, 180], [898, 180], // upstairs
  [462, 380], // ground
];

function drawBase(ctx: CanvasRenderingContext2D): void {
  // Distant skyline
  ctx.fillStyle = '#9fb0c8';
  for (const [x, w, h] of [[0, 140, 90], [120, 120, 120], [1000, 160, 110], [1150, 140, 80]] as const) ctx.fillRect(x, 320 - h, w, h);
  ctx.fillStyle = '#8a9bb5';
  ctx.beginPath(); ctx.moveTo(0, 235); ctx.lineTo(70, 205); ctx.lineTo(140, 235); ctx.fill();
  ctx.beginPath(); ctx.moveTo(1000, 215); ctx.lineTo(1080, 190); ctx.lineTo(1160, 215); ctx.fill();
  // Telecom mast
  ctx.strokeStyle = '#7f8ea8'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(300, 330); ctx.lineTo(318, 60); ctx.lineTo(336, 330); ctx.moveTo(306, 240); ctx.lineTo(330, 240); ctx.moveTo(310, 160); ctx.lineTo(326, 160); ctx.stroke();
  ctx.fillStyle = '#e74c3c'; ctx.beginPath(); ctx.arc(318, 58, 4, 0, Math.PI * 2); ctx.fill();

  // Mango tree behind left wall
  ctx.fillStyle = '#6b4226'; ctx.fillRect(18, 180, 26, 140);
  for (const [x, y, r, c] of [[30, 160, 70, '#2e7d32'], [100, 190, 60, '#388e3c'], [-10, 220, 55, '#1b5e20'], [70, 120, 55, '#43a047'], [150, 240, 45, '#2e7d32']] as const) {
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#f9a825';
  for (const [x, y] of [[40, 200], [95, 215], [60, 150], [130, 245], [10, 240]]) { ctx.beginPath(); ctx.ellipse(x, y, 6, 8, 0.3, 0, Math.PI * 2); ctx.fill(); }

  // Electric pole + wires to building
  ctx.fillStyle = '#5d4037'; ctx.fillRect(352, 140, 8, 190);
  ctx.fillRect(338, 150, 36, 5);
  ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(340, 152); ctx.quadraticCurveTo(160, 190, 0, 160); ctx.moveTo(372, 152); ctx.quadraticCurveTo(500, 190, 985, 362); ctx.stroke();

  // Perimeter walls
  for (const [x, w] of [[0, 380], [1020, 260]] as const) {
    ctx.fillStyle = '#e9c98f'; ctx.fillRect(x, 300, w, 172);
    ctx.fillStyle = '#c99d5b'; ctx.fillRect(x, 292, w, 12);
    ctx.fillStyle = '#b5543c'; ctx.fillRect(x, 440, w, 32);
    ctx.fillStyle = '#7f8c8d';
    for (let i = x + 6; i < x + w; i += 14) { ctx.beginPath(); ctx.moveTo(i, 292); ctx.lineTo(i + 5, 280); ctx.lineTo(i + 10, 292); ctx.fill(); }
  }
  ctx.font = '900 15px Impact, "Arial Black", sans-serif';
  ctx.fillStyle = '#7b2d26';
  ctx.fillText('POST NO BILL', 240, 318);
  ctx.save(); ctx.translate(1032, 470); ctx.font = '900 12px Impact, "Arial Black", sans-serif'; ctx.fillStyle = '#f5e6c8'; ctx.fillText('THIS HOUSE IS NOT FOR SALE', 0, -9); ctx.restore();

  // Building
  // Roof
  ctx.fillStyle = '#8d99a6';
  ctx.beginPath(); ctx.moveTo(360, 150); ctx.lineTo(400, 102); ctx.lineTo(1000, 102); ctx.lineTo(1040, 150); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#6c7a89'; ctx.lineWidth = 2;
  for (let x = 405; x < 1000; x += 16) { ctx.beginPath(); ctx.moveTo(x, 104); ctx.lineTo(x - 22 * ((x - 700) / 300) * 0.4, 148); ctx.stroke(); }
  ctx.fillStyle = '#a0522d'; ctx.fillRect(470, 104, 40, 12); ctx.fillRect(880, 104, 50, 10); // rust patches
  // Satellite dish
  ctx.fillStyle = '#ecf0f1'; ctx.beginPath(); ctx.ellipse(950, 92, 16, 20, -0.5, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#95a5a6'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(950, 102); ctx.lineTo(955, 120); ctx.stroke();

  // Walls
  ctx.fillStyle = '#f3d9a4'; ctx.fillRect(380, 150, 640, 322);
  ctx.fillStyle = '#e6c48a'; ctx.fillRect(380, 150, 640, 6);
  ctx.fillStyle = '#d9b77c'; ctx.fillRect(380, 292, 640, 10); // floor slab
  ctx.fillStyle = '#2f8f83'; ctx.fillRect(380, 432, 640, 40); // painted lower band
  ctx.fillStyle = '#267368'; ctx.fillRect(380, 432, 640, 4);
  // Water stains
  ctx.fillStyle = 'rgba(120,90,50,0.12)';
  ctx.fillRect(398, 156, 10, 90); ctx.fillRect(1004, 160, 8, 120);

  // Upstairs doors & windows
  door(ctx, 450, 186, 56, 106, '#7a4a2a', 'A');
  door(ctx, 820, 186, 56, 106, '#7a4a2a', 'B');
  for (const [x, y] of WINDOWS.slice(0, 4)) win(ctx, x, y, ['#c0392b', '#8e44ad', '#16a085', '#f39c12'][(x / 100) % 4 | 0]);
  // Ground floor doors
  const gd: Array<[number, string, string]> = [[392, '#7a4a2a', '1'], [528, '#8b5a2b', '2'], [598, '#7a4a2a', '3'], [788, '#2c6fb7', '4'], [862, '#7a4a2a', '5']];
  for (const [x, c, n] of gd) door(ctx, x, 360, 56, 112, c, n);
  for (const [x, y] of WINDOWS.slice(4)) win(ctx, x, y, '#e67e22');
  // Bulbs over doors
  ctx.fillStyle = '#fff6d5';
  for (const x of [420, 556, 626, 818, 890]) { ctx.beginPath(); ctx.arc(x, 350, 4, 0, Math.PI * 2); ctx.fill(); }
  // Welcome mat at Room 4
  ctx.fillStyle = '#c0392b'; ctx.fillRect(792, 472, 52, 8);
  // Notice board
  ctx.fillStyle = '#6d4c41'; ctx.fillRect(664, 340, 88, 60);
  ctx.fillStyle = '#c8a26b'; ctx.fillRect(668, 344, 80, 52);
  ctx.fillStyle = '#fff'; ctx.fillRect(674, 350, 22, 26); ctx.fillRect(702, 348, 18, 20); ctx.fillStyle = '#ffeaa7'; ctx.fillRect(724, 352, 18, 24); ctx.fillStyle = '#81ecec'; ctx.fillRect(700, 372, 26, 18);
  ctx.fillStyle = '#d63031'; for (const [x, y] of [[685, 351], [711, 349], [733, 353], [713, 373]]) { ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill(); }
  // Meter box
  ctx.fillStyle = '#95a5a6'; ctx.fillRect(966, 364, 38, 48);
  ctx.fillStyle = '#2d3436'; ctx.fillRect(971, 370, 28, 12);
  ctx.fillStyle = '#55efc4'; ctx.font = 'bold 9px monospace'; ctx.fillText('0482', 973, 380);

  // Drain gutter + courtyard pavers
  ctx.fillStyle = '#b2a58f'; ctx.fillRect(0, 472, W, 12);
  ctx.fillStyle = '#c9b79c'; ctx.fillRect(0, 484, W, H - 484);
  const pv = ['#c4b195', '#cdbb9f', '#bba98d', '#d3c3a8'];
  for (let row = 0; row < 12; row++) {
    const y = 484 + row * 20;
    for (let col = -1; col < 34; col++) {
      const x = col * 40 + (row % 2) * 20;
      ctx.fillStyle = pv[(row * 7 + col * 3) % 4];
      ctx.beginPath(); ctx.roundRect(x + 1, y + 1, 38, 18, 3); ctx.fill();
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillRect(0, 484, W, 10);

  // Gate
  ctx.fillStyle = '#2c6fb7'; ctx.fillRect(62, 300, 156, 172);
  ctx.fillStyle = '#245d9a';
  for (let x = 70; x < 214; x += 12) ctx.fillRect(x, 304, 5, 166);
  ctx.fillStyle = '#1d4e83'; ctx.fillRect(62, 300, 156, 10); ctx.fillRect(62, 380, 156, 8); ctx.fillRect(138, 300, 5, 172);
  ctx.fillStyle = '#1d4e83';
  for (let x = 66; x < 216; x += 12) { ctx.beginPath(); ctx.moveTo(x, 300); ctx.lineTo(x + 4, 284); ctx.lineTo(x + 8, 300); ctx.fill(); }
  ctx.fillStyle = '#f1c40f'; ctx.fillRect(126, 402, 8, 14); // padlock-ish handle
  ctx.fillStyle = '#e9c98f'; ctx.fillRect(48, 290, 16, 182); ctx.fillRect(216, 290, 16, 182);

  // Kiosk
  ctx.fillStyle = '#8d6e63'; ctx.fillRect(238, 380, 134, 96);
  ctx.fillStyle = '#5d4037'; ctx.fillRect(238, 430, 134, 10);
  ctx.fillStyle = '#3e2723'; ctx.fillRect(246, 388, 118, 40);
  const goods = ['#74b9ff', '#fdcb6e', '#e17055', '#00b894', '#fd79a8', '#ffeaa7'];
  for (let i = 0; i < 12; i++) { ctx.fillStyle = goods[i % 6]; ctx.fillRect(250 + (i % 6) * 19, 392 + Math.floor(i / 6) * 18, 14, 14); }
  for (let i = 0; i < 7; i++) { ctx.fillStyle = i % 2 ? '#f6b93b' : '#1f8a4c'; ctx.beginPath(); ctx.moveTo(232 + i * 21, 352); ctx.lineTo(253 + i * 21, 352); ctx.lineTo(256 + i * 21, 384); ctx.lineTo(229 + i * 21, 384); ctx.fill(); }
  ctx.fillStyle = '#fff8e1'; ctx.fillRect(244, 330, 124, 22);
  ctx.fillStyle = '#1f8a4c'; ctx.font = '900 12px "Arial Black", sans-serif'; ctx.textAlign = 'center'; ctx.fillText('IYA BISI PROVISIONS', 306, 346); ctx.textAlign = 'left';
  drawJerrycan(ctx, 252, 488, '#e1b12c'); drawJerrycan(ctx, 280, 490, '#27ae60');

  // Potted plants in paint buckets
  for (const [x, c] of [[474, '#e74c3c'], [770, '#3498db'], [1000, '#ecf0f1'], [236, '#9b59b6']] as const) plant(ctx, x, 482, c);

  // Water tank on stand + drums
  ctx.strokeStyle = '#4b5563'; ctx.lineWidth = 7;
  for (const x of [1082, 1206]) { ctx.beginPath(); ctx.moveTo(x, 236); ctx.lineTo(x, 504); ctx.stroke(); }
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(1082, 300); ctx.lineTo(1206, 380); ctx.moveTo(1206, 300); ctx.lineTo(1082, 380); ctx.moveTo(1082, 380); ctx.lineTo(1206, 460); ctx.moveTo(1206, 380); ctx.lineTo(1082, 460); ctx.stroke();
  ctx.fillStyle = '#4b5563'; ctx.fillRect(1072, 232, 146, 10);
  ctx.fillStyle = '#1f2326'; ctx.beginPath(); ctx.roundRect(1078, 128, 136, 106, 14); ctx.fill();
  ctx.fillStyle = '#2d3238'; for (let y = 146; y < 230; y += 20) ctx.fillRect(1080, y, 132, 5);
  ctx.fillStyle = '#2d3238'; ctx.beginPath(); ctx.ellipse(1146, 128, 30, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#7f8c8d'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(1090, 232); ctx.lineTo(1090, 470); ctx.lineTo(1060, 470); ctx.stroke();
  for (const x of [1036, 1112]) {
    ctx.fillStyle = '#1e5fbf'; ctx.beginPath(); ctx.roundRect(x, 440, 62, 72, 8); ctx.fill();
    ctx.fillStyle = '#174c99'; ctx.fillRect(x, 458, 62, 5); ctx.fillRect(x, 488, 62, 5);
    ctx.fillStyle = '#2a75e0'; ctx.beginPath(); ctx.ellipse(x + 31, 441, 31, 6, 0, 0, Math.PI * 2); ctx.fill();
  }

  // Laundry poles
  ctx.fillStyle = '#7f8c8d'; ctx.fillRect(398, 430, 6, 104); ctx.fillRect(604, 430, 6, 104);

  // Plastic chairs and table
  chair(ctx, 600, 646, '#d63031'); chair(ctx, 662, 664, '#f5f6fa'); chair(ctx, 780, 652, '#d63031'); chair(ctx, 836, 640, '#f5f6fa');
  ctx.fillStyle = '#f5f6fa'; ctx.beginPath(); ctx.ellipse(720, 618, 44, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#dfe6e9'; ctx.fillRect(716, 620, 8, 40);
  ctx.fillStyle = '#e17055'; ctx.fillRect(704, 600, 10, 16); ctx.fillStyle = '#2d3436'; ctx.fillRect(724, 604, 14, 10);

  // Generator cage base
  ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.beginPath(); ctx.ellipse(1165, 684, 80, 12, 0, 0, Math.PI * 2); ctx.fill();
}

function door(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: string, n: string) {
  ctx.fillStyle = '#5d4037'; ctx.fillRect(x - 4, y - 4, w + 8, h + 4);
  ctx.fillStyle = c; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2;
  ctx.strokeRect(x + 7, y + 8, w - 14, h * 0.38); ctx.strokeRect(x + 7, y + h * 0.52, w - 14, h * 0.4);
  ctx.fillStyle = '#f1c40f'; ctx.beginPath(); ctx.arc(x + w - 10, y + h * 0.5, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(n, x + w / 2, y - 8 + (y > 300 ? 0 : 0)); ctx.textAlign = 'left';
}

function win(ctx: CanvasRenderingContext2D, x: number, y: number, curtain: string) {
  ctx.fillStyle = '#5d4037'; ctx.fillRect(x - 3, y - 3, 56, 56);
  ctx.fillStyle = '#34495e'; ctx.fillRect(x, y, 50, 50);
  ctx.fillStyle = curtain; ctx.fillRect(x, y, 14, 50); ctx.fillRect(x + 36, y, 14, 50);
  ctx.strokeStyle = '#1b1b1b'; ctx.lineWidth = 2;
  for (let i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(x + i * 12.5, y); ctx.lineTo(x + i * 12.5, y + 50); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(x, y + 25); ctx.lineTo(x + 50, y + 25); ctx.stroke();
}

function plant(ctx: CanvasRenderingContext2D, x: number, y: number, bucket: string) {
  ctx.fillStyle = '#27ae60';
  for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.ellipse(x + i * 7, y - 30 - Math.abs(i) * -3, 6, 18, i * 0.35, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = bucket; ctx.beginPath(); ctx.moveTo(x - 14, y - 20); ctx.lineTo(x + 14, y - 20); ctx.lineTo(x + 11, y); ctx.lineTo(x - 11, y); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(x - 14, y - 20, 28, 4);
}

function chair(ctx: CanvasRenderingContext2D, x: number, y: number, c: string) {
  ctx.fillStyle = c; ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(x - 20, y - 62, 40, 34, 8); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.roundRect(x - 22, y - 30, 44, 9, 4); ctx.fill(); ctx.stroke();
  ctx.fillRect(x - 20, y - 22, 5, 22); ctx.fillRect(x + 15, y - 22, 5, 22);
}

function drawJerrycan(ctx: CanvasRenderingContext2D, x: number, y: number, c: string) {
  ctx.fillStyle = c; ctx.strokeStyle = '#24150e'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(x, y - 30, 22, 30, 3); ctx.fill(); ctx.stroke();
  ctx.fillRect(x + 4, y - 36, 8, 6);
}

function drawGenerator(ctx: CanvasRenderingContext2D, x: number, y: number, running: boolean) {
  ctx.fillStyle = '#f1c40f'; ctx.strokeStyle = '#24150e'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.roundRect(x, y, 116, 70, 8); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#2d3436'; ctx.fillRect(x + 10, y + 14, 46, 40);
  ctx.fillStyle = '#636e72'; for (let i = 0; i < 4; i++) ctx.fillRect(x + 14, y + 18 + i * 9, 38, 4);
  ctx.fillStyle = running ? '#2ecc71' : '#7f8c8d'; ctx.beginPath(); ctx.arc(x + 80, y + 24, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#c0392b'; ctx.fillRect(x + 70, y + 40, 26, 10);
  ctx.fillStyle = '#7f8c8d'; ctx.fillRect(x + 104, y - 14, 10, 18);
  // cage
  ctx.strokeStyle = 'rgba(70,60,50,0.85)'; ctx.lineWidth = 2;
  for (let i = 0; i <= 6; i++) { ctx.beginPath(); ctx.moveTo(x - 10 + i * 23, y - 24); ctx.lineTo(x - 10 + i * 23, y + 78); ctx.stroke(); }
  ctx.beginPath(); ctx.moveTo(x - 12, y - 24); ctx.lineTo(x + 130, y - 24); ctx.stroke();
}

function drawLaundry(ctx: CanvasRenderingContext2D, t: number, missingShirt: boolean) {
  ctx.strokeStyle = '#2d3436'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(401, 440); ctx.quadraticCurveTo(505, 462, 607, 440); ctx.stroke();
  const items: Array<[number, number, number, string, string]> = [
    [418, 26, 40, '#e67e22', 'wax'], [450, 30, 46, '#27ae60', 'shirt'], [488, 24, 30, '#ecf0f1', 'sock'],
    [516, 30, 52, '#8e44ad', 'wax'], [552, 28, 42, missingShirt ? '' : '#c0392b', 'shirt'], [584, 16, 24, '#2980b9', 'sock'],
  ];
  for (const [x, w, h, c, kind] of items) {
    const ly = 440 + Math.sin(((x - 401) / 206) * Math.PI) * 11;
    ctx.fillStyle = '#f1c40f'; ctx.fillRect(x + w / 2 - 2, ly - 4, 4, 8);
    if (!c) continue;
    const sw = Math.sin(t * 1.6 + x) * 3;
    ctx.save();
    ctx.translate(x, ly);
    ctx.transform(1, 0, sw * 0.02, 1, 0, 0);
    ctx.fillStyle = c; ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    if (kind === 'shirt') {
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(w, 0); ctx.lineTo(w + 6, 12); ctx.lineTo(w - 3, 14); ctx.lineTo(w - 3, h); ctx.lineTo(3, h); ctx.lineTo(3, 14); ctx.lineTo(-6, 12); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f1c40f'; for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(w / 2, 10 + i * 10, 1.8, 0, Math.PI * 2); ctx.fill(); }
    } else {
      ctx.beginPath(); ctx.roundRect(0, 0, w, h, 3); ctx.fill(); ctx.stroke();
      if (kind === 'wax') { ctx.fillStyle = 'rgba(255,255,255,0.45)'; for (let i = 0; i < 6; i++) { ctx.beginPath(); ctx.arc(6 + (i % 2) * 12, 8 + i * 7, 3, 0, Math.PI * 2); ctx.fill(); } }
    }
    ctx.restore();
  }
}

function drawRailing(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#d9b77c'; ctx.fillRect(380, 290, 640, 12);
  ctx.fillStyle = '#c0392b'; ctx.fillRect(380, 254, 640, 6);
  ctx.fillStyle = '#922b21';
  for (let x = 384; x < 1020; x += 16) ctx.fillRect(x, 260, 4, 30);
}

function drawGoat(ctx: CanvasRenderingContext2D, x: number, y: number, t: number) {
  const bob = Math.sin(t * 5) * 1.5;
  ctx.fillStyle = 'rgba(0,0,0,0.2)'; ctx.beginPath(); ctx.ellipse(x, y, 34, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#24150e'; ctx.lineWidth = 2;
  ctx.fillStyle = '#8d5a3b';
  for (const lx of [-20, -10, 12, 22]) { ctx.fillRect(x + lx, y - 22, 5, 22); }
  ctx.beginPath(); ctx.ellipse(x, y - 30 + bob, 32, 16, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(x + 34, y - 46 + bob, 12, 10, 0.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#f5f6fa'; ctx.beginPath(); ctx.ellipse(x - 6, y - 32 + bob, 12, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#d4c2a0'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x + 30, y - 54 + bob); ctx.quadraticCurveTo(x + 26, y - 66, x + 18, y - 64); ctx.stroke();
  ctx.fillStyle = '#24150e'; ctx.beginPath(); ctx.arc(x + 38, y - 48 + bob, 2, 0, Math.PI * 2); ctx.fill();
}

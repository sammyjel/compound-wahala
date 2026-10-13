// Story Mode controller: runs the short level scripts in levels.ts on top of the
// existing compound renderer. One goal at a time, 2–3 big buttons, instant reactions.

import { sfx } from '../audio/sfx.ts';
import { playMusic, sting, type Track } from '../audio/music.ts';
import { track } from '../analytics.ts';
import { newOffer, rewardedAvailable, showRewarded } from '../monetize/ads.ts';
import { catalog, grownUpQuestion, ownsPremium, price, restore, startCheckout, type StoreItem } from '../monetize/store.ts';
import { NPCS, PLAYER_LOOKS } from '../data/npcs.ts';
import { createState } from '../engine/state.ts';
import { drawPortrait } from '../render/people.ts';
import { drawGoat, drawJerrycan, LAUNDRY_ITEMS, laundryY, OBJ_BOXES, Scene } from '../render/scene.ts';
import { bodyImg, drawFace, type CharKey } from '../render/sprites.ts';
import type { GameState, NpcId } from '../types.ts';
import { NPC_IDS } from '../types.ts';
import type { App } from '../ui/app.ts';
import { $, clear, h } from '../ui/dom.ts';
import { modalOpen, openModal } from '../ui/modal.ts';
import { LEVELS, type Opt, type Prop, type Say, type StoryApi, type Target, type Who } from './levels.ts';
import {
  buy, DECOR, finishLevel, LEVEL_COUNT, levelDone, levelUnlocked, loadProgress, LOOK_UNLOCK, lookUnlocked,
  nextLevel, saveProgress, totalStars, weekUnlocked, type Progress,
} from './progress.ts';

class Abort extends Error {}

interface Mover { x: number; y: number; tx: number; ty: number }
type Input = { kind: 'btn'; i: number } | { kind: 'tap'; pick: Target | null };
interface Btn { label: string; icon: string; cls?: string }

const NARR = (text: string): Say => ({ who: 'narrator', text });
const same = (a: Target | null, b: Target) => !!a && a.kind === b.kind && a.id === b.id;
const POKES: Record<NpcId, string[]> = {
  chief: ['Order! Order! 🔨', 'In my time...', 'Hmm-hmm. 🧐'],
  kemi: ['Eh-hen! 👀', 'Did you hear?!', 'Ahn ahn! 😂'],
  amaka: ['Drink water o! 💧', 'Hello dear! 👋', 'I need sleep... 😴'],
  femi: ['Big deal loading... 📈', 'CEO mindset! 😎', 'Alert don land? 📱'],
  bisi: ['Pure water! Pure water! 💧', 'Buy something na! 🛒', 'No credit today o! 😅'],
  tobi: ['Vibes only! 🎧', 'Like and subscribe! 👍', 'Content! 🎥'],
};

export class Story implements StoryApi {
  p: Progress = loadProgress();
  scene: Scene;
  /** Multiplies every wait (tests set it low). */
  speed = 1;
  private s: GameState = createState('You', 1);
  private cast = new Map<NpcId, Mover>();
  private dancing = new Set<NpcId>();
  private poked = new Map<NpcId, number>();
  private carrying: Prop = null;
  private bucket: { x: number; y: number; upside: boolean } | null = null;
  private pot = false;
  private prints = false;
  private goat: (Mover & { bone: boolean }) | null = null;
  private clouds = 0;
  private cloudsTarget = 0;
  private rain = false;
  private collecting = false;
  private flying: Array<{ x0: number; y0: number; x1: number; y1: number; t0: number; c: string }> = [];
  private confetti: Array<{ x: number; y: number; vx: number; vy: number; c: string; life: number }> = [];
  private level = 0;
  private token = 0;
  private mistakes = 0;
  private earned = 0;
  private pending = new Set<(e: Error) => void>();
  private waiter: ((i: Input | null) => void) | null = null;
  private skipper: (() => void) | null = null;
  private loops = new Set<number>();
  private clock = 0;
  private pointTarget: Target | null = null;
  private started = 0;

  constructor(private app: App) {
    const canvas = $('#s-scene') as HTMLCanvasElement;
    this.scene = new Scene(canvas, {
      getState: () => this.s,
      where: () => ({ status: 'away' }),
      playerLook: () => PLAYER_LOOKS[this.p.look] ?? PLAYER_LOOKS[0],
      playerKey: () => `player${this.p.look}` as CharKey,
      markers: () => new Set(),
      settings: () => ({ labels: false, reduceMotion: app.settings.reduceMotion }),
      npcPos: (id) => this.cast.get(id) ?? null,
      dance: (id) => this.dancing.has(id) || (this.poked.get(id) ?? 0) > this.clock,
      ambient: () => false,
      tick: (dt) => this.tick(dt),
      drawWorld: (ctx, t) => this.drawWorld(ctx, t),
      drawFront: (ctx) => this.drawFront(ctx),
      drawTop: (ctx, t) => this.drawTop(ctx, t),
    });

    canvas.addEventListener('click', (e) => {
      if (modalOpen()) return;
      if (this.skipper) { this.skipper(); return; }
      const w = this.scene.toWorld(e.clientX, e.clientY);
      const pick = this.pickAt(w.x, w.y);
      if (this.waiter) this.waiter({ kind: 'tap', pick });
      else if (pick?.kind === 'npc') this.poke(pick.id);
    });
    canvas.addEventListener('pointermove', (e) => {
      const w = this.scene.toWorld(e.clientX, e.clientY);
      const pick = this.pickAt(w.x, w.y);
      this.scene.hover = pick && pick.kind !== 'prop' ? pick : null;
      canvas.style.cursor = pick ? 'pointer' : 'default';
    });
    $('#s-say').addEventListener('click', () => this.skipper?.());
    $('#s-menu').addEventListener('click', () => this.pause());
    document.addEventListener('keydown', (e) => this.onKey(e));
  }

  // ───────────────────────── Screens ─────────────────────────

  /** PLAY on the title: straight into the next unfinished level. */
  playNext(): void {
    void this.play(nextLevel(this.p));
  }

  /** Hide Story screens and stop everything (called when other screens open). */
  leave(): void {
    this.abort();
    this.scene.stop();
    $('#screen-story').hidden = true;
    $('#screen-levels').hidden = true;
  }

  private hideOthers(): void {
    for (const id of ['screen-title', 'screen-game', 'screen-results', 'screen-story', 'screen-levels']) $('#' + id).hidden = true;
  }

  showMap(): void {
    this.abort();
    this.scene.stop();
    this.hideOthers();
    const el = $('#screen-levels');
    el.hidden = false;
    playMusic('title');
    clear(el);
    const p = this.p;
    const cards = LEVELS.map((L, i) => {
      const open = levelUnlocked(p, i);
      const stars = p.stars[i] ?? 0;
      return h('button', {
        class: `lvl${open ? '' : ' locked'}${i === nextLevel(p) && !levelDone(p, i) ? ' next' : ''}`, type: 'button', disabled: !open,
        'aria-label': `Level ${i + 1}: ${L.title}. ${open ? `${stars} of 3 stars` : 'Locked'}`,
        onclick: () => void this.play(i),
      },
      h('span', { class: 'lvl-num' }, open ? String(i + 1) : '🔒'),
      h('span', { class: 'lvl-emoji', 'aria-hidden': 'true' }, L.emoji),
      h('span', { class: 'lvl-title' }, L.title),
      h('span', { class: 'lvl-teaser' }, open ? L.teaser : `Finish level ${i} to open`),
      h('span', { class: 'lvl-stars', 'aria-hidden': 'true' }, '★'.repeat(stars) + '☆'.repeat(3 - stars)));
    });
    const week = weekUnlocked(p) || !!localStorage.getItem('compoundWahala.save.v1');
    el.append(h('div', { class: 'map-wrap' },
      h('header', { class: 'map-head' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Back to title', onclick: () => this.app.showTitle() }, '←'),
        h('h1', {}, 'Pick a level'),
        h('div', { class: 'map-totals' }, h('span', { class: 'coins', id: 'map-coins' }, `🪙 ${p.coins}`), h('span', { class: 'coins' }, `⭐ ${totalStars(p)}/${LEVEL_COUNT * 3}`))),
      h('div', { class: 'lvl-grid' }, ...cards),
      h('div', { class: 'map-extras' },
        h('button', { class: 'big', type: 'button', id: 'btn-shop', onclick: () => this.shop() }, '🛍️ Decorate'),
        h('button', { class: 'big', type: 'button', id: 'btn-looks', onclick: () => this.looks() }, '👕 My player'),
        h('button', { class: 'big ghost' + (week ? '' : ' locked'), type: 'button', id: 'btn-week', onclick: () => this.weekMode(week) },
          week ? '🏘️ Full Week mode' : '🔒 Full Week mode')),
      h('p', { class: 'map-note' }, week ? 'Full Week mode: the big 7-day challenge with money, bills and compound meetings.' : 'Finish all 5 levels to unlock Full Week mode — the big 7-day challenge.'),
    ));
    (el.querySelector('.lvl.next, .lvl:not(.locked)') as HTMLElement | null)?.focus();
  }

  private weekMode(open: boolean): void {
    if (!open) {
      openModal({ title: 'Full Week mode 🔒', dismissable: true, body: h('p', {}, 'Finish all 5 levels first. Then you can try surviving a whole week in the compound!'), actions: [{ label: 'OK', primary: true, onClick: () => {} }] });
      return;
    }
    this.app.weekMenu();
  }

  // ───────────────────────── Shop & looks ─────────────────────────

  shop(): void {
    track('store_opened', { where: 'decorate' });
    const body = h('div', { class: 'shop' });
    const render = () => {
      clear(body);
      body.append(h('p', { class: 'shop-coins' }, `You have 🪙 ${this.p.coins} coins. Earn coins by playing levels — they can never be bought with real money.`));
      for (const d of DECOR) {
        const owned = this.p.owned.includes(d.id);
        const can = this.p.coins >= d.cost;
        body.append(h('div', { class: 'shop-item' + (owned ? ' owned' : '') },
          h('span', { class: 'shop-emoji', 'aria-hidden': 'true' }, d.emoji),
          h('span', { class: 'shop-text' }, h('strong', {}, d.name), h('small', {}, d.blurb)),
          owned ? h('span', { class: 'shop-owned' }, '✓ Yours')
            : h('button', { class: 'big' + (can ? ' primary' : ''), type: 'button', disabled: !can, 'aria-label': `Buy ${d.name} for ${d.cost} coins`,
              onclick: () => { if (buy(this.p, d.id)) { saveProgress(this.p); sfx.mission(); track('decor_bought', { id: d.id }); render(); this.refreshCoins(); } } },
            `🪙 ${d.cost}`)));
      }
    };
    render();
    const premium = h('div', { class: 'shop premium' });
    openModal({ title: '🛍️ Decorate your compound', dismissable: true, body: [body, premium], actions: [{ label: 'Done', primary: true, onClick: () => {} }] });
    // Optional "support the game" items — only shown when real payments have been enabled.
    void catalog().then((items) => {
      if (!items?.length) return;
      premium.append(h('h3', { class: 'premium-h' }, '❤️ Support the game (grown-ups only)'),
        h('p', { class: 'sub' }, 'Optional extras paid with real money by a parent. Everything in the game can be played without them.'));
      for (const it of items) {
        premium.append(h('div', { class: 'shop-item' + (ownsPremium(it.sku) ? ' owned' : '') },
          h('span', { class: 'shop-text' }, h('strong', {}, it.name), h('small', {}, price(it))),
          ownsPremium(it.sku) ? h('span', { class: 'shop-owned' }, '✓ Yours') : h('button', { class: 'big', type: 'button', onclick: () => this.grownUpCheckout(it) }, 'Ask a grown-up')));
      }
      premium.append(h('button', { class: 'linkish', type: 'button', onclick: async () => {
        const code = prompt('Grown-ups: enter the receipt code (Paystack reference) to restore a purchase:');
        if (!code) return;
        const sku = await restore(code).catch(() => null);
        alert(sku ? 'Restored! ✓' : 'No active purchase found for that code.');
      } }, 'Restore a purchase'));
    });
  }

  /** A grown-up check, then the parent's email for the Paystack receipt, then Paystack's own checkout page. */
  private grownUpCheckout(it: StoreItem): void {
    const { q, a } = grownUpQuestion();
    const ans = h('input', { type: 'number', inputmode: 'numeric', 'aria-label': 'Answer', class: 'gate-input' }) as HTMLInputElement;
    const email = h('input', { type: 'email', placeholder: 'Parent email (for the receipt)', 'aria-label': 'Parent email', class: 'gate-input' }) as HTMLInputElement;
    openModal({
      title: 'For grown-ups', dismissable: true,
      body: [h('p', {}, `${it.name} costs ${price(it)} (real money). To continue, a grown-up must answer: what is ${q}?`), ans, email,
        h('p', { class: 'sub' }, "You will pay on Paystack's secure page. We never see card details. Refunds: see the Feedback page.")],
      actions: [
        { label: 'Continue to payment', primary: true, onClick: () => {
          if (Number(ans.value) !== a) { alert('That answer is not right.'); return false; }
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.value)) { alert('Please enter a valid email for the receipt.'); return false; }
          void startCheckout(it, email.value).then((url) => { location.href = url; }).catch((e) => alert(e.message));
        } },
        { label: 'Cancel', onClick: () => {} },
      ],
    });
  }

  looks(): void {
    const body = h('div', { class: 'looks big-looks' });
    const render = () => {
      clear(body);
      PLAYER_LOOKS.forEach((l, i) => {
        const open = lookUnlocked(this.p, i);
        const c = h('canvas', { width: 160, height: 160, 'aria-hidden': 'true' });
        if (!drawFace(c, `player${i}` as CharKey)) drawPortrait(c, l, '#d6ecff');
        body.append(h('button', {
          class: 'look' + (i === this.p.look ? ' active' : '') + (open ? '' : ' locked'), type: 'button', disabled: !open,
          'aria-label': open ? `Player ${i + 1}${i === this.p.look ? ' (chosen)' : ''}` : `Locked: needs ${LOOK_UNLOCK[i]} stars`,
          onclick: () => { this.p.look = i; saveProgress(this.p); sfx.click(); render(); },
        }, c, h('span', {}, open ? (i === this.p.look ? '✓ Me' : 'Choose') : `🔒 ${LOOK_UNLOCK[i]} ⭐`)));
      });
    };
    render();
    openModal({ title: '👕 Choose your player', dismissable: true, body: [body, h('p', { class: 'sub' }, `Earn stars in levels to unlock more players. You have ${totalStars(this.p)} ⭐.`)], actions: [{ label: 'Done', primary: true, onClick: () => {} }] });
  }

  private refreshCoins(): void {
    for (const sel of ['#s-coins', '#map-coins']) {
      const el = document.querySelector(sel);
      if (el) el.textContent = `🪙 ${this.p.coins}`;
    }
  }

  // ───────────────────────── Level lifecycle ─────────────────────────

  async play(i: number): Promise<void> {
    if (!levelUnlocked(this.p, i)) i = nextLevel(this.p);
    this.abort();
    this.hideOthers();
    $('#screen-story').hidden = false;
    this.reset();
    this.level = i;
    this.mistakes = 0;
    this.earned = 0;
    this.started = performance.now();
    $('#s-level').textContent = `Level ${i + 1} · ${LEVELS[i].title}`;
    this.refreshCoins();
    this.scene.resize();
    this.scene.start();
    const tok = this.token;
    track('level_start', { level: i + 1 });
    if (i === 0 && !levelDone(this.p, 0)) track('tutorial_start', {});
    try {
      await LEVELS[i].run(this);
      if (tok !== this.token) return;
      await this.sleep(700);
      this.complete();
    } catch (e) {
      if (e instanceof Abort) return;
      console.error(e);
      this.crashCard();
    }
  }

  private reset(): void {
    this.s = createState('You', 1);
    this.s.counters['laundry_taken'] = 0;
    this.cast.clear();
    this.dancing.clear();
    this.poked.clear();
    this.carrying = null;
    this.bucket = null;
    this.pot = this.prints = this.rain = this.collecting = false;
    this.goat = null;
    this.clouds = this.cloudsTarget = 0;
    this.flying = [];
    this.confetti = [];
    Object.assign(this.scene, { pointAt: null, highlight: null, focusX: null, hidePlayer: false, selected: null, hover: null });
    clear($('#s-say'));
    clear($('#s-actions'));
    $('#s-goal').hidden = true;
    $('#s-banner').hidden = true;
    $('#s-card').hidden = true;
  }

  private abort(): void {
    this.token++;
    for (const fail of [...this.pending]) fail(new Abort());
    this.pending.clear();
    this.waiter = null;
    this.skipper = null;
    for (const id of this.loops) clearInterval(id);
    this.loops.clear();
  }

  private complete(): void {
    const i = this.level;
    const firstClear = !levelDone(this.p, i);
    const bonus = 0;
    const r = finishLevel(this.p, i, this.mistakes, bonus);
    const starBonus = r.stars * 5;
    this.p.coins += starBonus;
    saveProgress(this.p);
    this.refreshCoins();
    track('level_complete', { level: i + 1, stars: r.stars, mistakes: this.mistakes, seconds: Math.round((performance.now() - this.started) / 1000), first: firstClear });
    if (i === 0 && firstClear) { track('tutorial_complete', {}); track('first_mission_complete', {}); }
    sting('win');
    sfx.mission();
    const last = i === LEVEL_COUNT - 1;
    const L = LEVELS[i];
    const card = $('#s-card');
    clear(card);
    clear($('#s-actions'));
    $('#s-goal').hidden = true;
    const affordable = DECOR.some((d) => !this.p.owned.includes(d.id) && this.p.coins >= d.cost);
    const starEls = [0, 1, 2].map((k) => h('span', { class: 'star' + (k < r.stars ? ' on' : ''), style: `animation-delay:${0.25 + k * 0.3}s` }, '★'));
    card.append(h('div', { class: 's-card-inner', role: 'dialog', 'aria-label': `Level ${i + 1} complete` },
      h('div', { class: 'kicker' }, last ? '🏆 ALL LEVELS COMPLETE!' : `LEVEL ${i + 1} COMPLETE!`),
      h('h2', {}, L.title),
      h('div', { class: 'stars', 'aria-label': `${r.stars} of 3 stars` }, ...starEls),
      h('p', { class: 'win' }, L.win),
      h('p', { class: 'earned' }, `🪙 +${this.earned + starBonus} coins`),
      h('p', { class: 'sub' }, r.stars === 3 ? 'Perfect! 🌟' : 'Tip: fewer wrong guesses = more stars. Play again to get all 3!'),
      r.unlocked !== null ? h('p', { class: 'unlock' }, `🔓 New level: ${LEVELS[r.unlocked].title}`) : null,
      last && firstClear ? h('p', { class: 'unlock' }, '🔓 Full Week mode is now open!') : null,
      ...r.newLooks.map(() => h('p', { class: 'unlock' }, '👕 New player look unlocked!')),
      affordable ? h('p', { class: 'unlock' }, '🛍️ You can buy a new decoration!') : null,
      h('div', { class: 's-card-btns' },
        last
          ? h('button', { class: 'big primary', type: 'button', id: 'btn-next', onclick: () => this.showMap() }, '🏘️ All levels')
          : h('button', { class: 'big primary', type: 'button', id: 'btn-next', onclick: () => void this.play(i + 1) }, '▶ NEXT LEVEL'),
        h('button', { class: 'big', type: 'button', id: 'btn-again', onclick: () => void this.play(i) }, '↻ Play again'),
        affordable ? h('button', { class: 'big', type: 'button', onclick: () => this.shop() }, '🛍️ Decorate') : null,
        rewardedAvailable() ? this.adButton() : null,
        last ? null : h('button', { class: 'big ghost', type: 'button', onclick: () => this.showMap() }, '🏘️ All levels')),
    ));
    card.hidden = false;
    starEls.forEach((_, k) => { if (k < r.stars) setTimeout(() => sfx.star(), (250 + k * 300) * this.speed); });
    ($('#btn-next') as HTMLButtonElement).focus();
  }

  /** Optional rewarded ad for bonus coins. Only exists when an ad provider is configured. */
  private adButton(): HTMLButtonElement {
    const offer = newOffer('level_bonus');
    const b = h('button', { class: 'big ghost', type: 'button', id: 'btn-ad' }, '📺 Optional: watch an ad for +20 bonus coins') as HTMLButtonElement;
    b.onclick = async () => {
      b.disabled = true;
      const ok = await showRewarded(offer);
      if (ok) {
        this.p.coins += 20;
        saveProgress(this.p);
        this.refreshCoins();
        sfx.coin();
        b.textContent = '✓ +20 coins. Thank you!';
      } else b.textContent = 'No reward this time — no problem!';
    };
    return b;
  }

  private crashCard(): void {
    const card = $('#s-card');
    clear(card);
    card.append(h('div', { class: 's-card-inner' },
      h('h2', {}, 'Oops! Small wahala 😅'),
      h('p', {}, 'Something went wrong in this level. Your coins and stars are safe.'),
      h('div', { class: 's-card-btns' },
        h('button', { class: 'big primary', type: 'button', onclick: () => void this.play(this.level) }, '↻ Try again'),
        h('button', { class: 'big ghost', type: 'button', onclick: () => this.showMap() }, '🏘️ All levels'))));
    card.hidden = false;
  }

  pause(): void {
    if ($('#screen-story').hidden || !$('#s-card').hidden) return;
    openModal({
      title: 'Paused', kicker: `Level ${this.level + 1}`, dismissable: true,
      actions: [
        { label: '▶ Keep playing', primary: true, onClick: () => {} },
        { label: '↻ Start this level again', onClick: () => { setTimeout(() => void this.play(this.level), 0); } },
        { label: '🏘️ All levels', onClick: () => { setTimeout(() => this.showMap(), 0); } },
        { label: '⚙️ Settings', onClick: () => { setTimeout(() => this.app.openSettings(), 0); } },
        { label: '🏠 Title screen', onClick: () => { setTimeout(() => this.app.showTitle(), 0); } },
      ],
    });
  }

  private onKey(e: KeyboardEvent): void {
    if ($('#screen-story').hidden || modalOpen()) return;
    if (!$('#s-card').hidden) return; // card buttons are normal focusable buttons
    if (/^[1-9]$/.test(e.key)) {
      (document.querySelector(`#s-actions button[data-key="${e.key}"]:not([disabled])`) as HTMLButtonElement | null)?.click();
    } else if ((e.key === 'Enter' || e.key === ' ') && this.skipper) {
      e.preventDefault();
      this.skipper();
    } else if (e.key === 'Escape' || e.key.toLowerCase() === 'p') {
      this.pause();
    }
  }

  // ───────────────────────── Waiting primitives ─────────────────────────

  private paused(): boolean {
    return modalOpen() || document.hidden;
  }

  /** Pausable, abortable sleep. `skippable` lets a tap / Enter end it early. */
  private sleep(ms: number, skippable = false): Promise<void> {
    return new Promise((resolve, reject) => {
      let left = ms * this.speed;
      const cleanup = () => {
        clearInterval(id);
        this.pending.delete(fail);
        if (this.skipper === done) this.skipper = null;
      };
      const done = () => { cleanup(); resolve(); };
      const fail = (e: Error) => { cleanup(); reject(e); };
      this.pending.add(fail);
      if (skippable) this.skipper = done;
      const id = window.setInterval(() => {
        if (!this.paused()) left -= 50;
        if (left <= 0) done();
      }, 50);
    });
  }

  /** Wait for a button press or a tap on the picture. `expired` ends the wait with null. */
  private input(expired?: () => boolean): Promise<Input | null> {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearInterval(id);
        this.pending.delete(fail);
        if (this.waiter === finish) this.waiter = null;
      };
      const finish = (v: Input | null) => { cleanup(); resolve(v); };
      const fail = (e: Error) => { cleanup(); reject(e); };
      this.pending.add(fail);
      this.waiter = finish;
      const id = window.setInterval(() => { if (expired?.()) finish(null); }, 50);
    });
  }

  // ───────────────────────── StoryApi: world ─────────────────────────

  setHour(hr: number): void { this.s.hour = hr; }
  setPower(nepa: boolean): void { this.s.power.outages = nepa ? [] : [[0, 24]]; }
  setGen(fuel: number, on: boolean): void { this.s.stats.fuel = fuel; this.s.power.genOn = on; }

  place(cast: Partial<Record<NpcId, [number, number]>>, player: [number, number]): void {
    this.cast.clear();
    for (const [id, [x, y]] of Object.entries(cast) as Array<[NpcId, [number, number]]>) this.cast.set(id, { x, y, tx: x, ty: y });
    const pl = this.scene.player;
    pl.x = pl.tx = player[0];
    pl.y = pl.ty = player[1];
    pl.cb = null;
  }

  async move(id: NpcId | 'goat', x: number, y: number): Promise<void> {
    const m = id === 'goat' ? this.goat : this.cast.get(id);
    if (!m) return;
    m.tx = x;
    m.ty = y;
    if (this.app.settings.reduceMotion) { m.x = x; m.y = y; return; }
    while (Math.hypot(m.tx - m.x, m.ty - m.y) > 2) {
      await this.sleep(50 / Math.max(this.speed, 0.01));
      if (m.tx !== x || m.ty !== y) return; // re-targeted by someone else
    }
  }

  walk(x: number, y: number): Promise<void> {
    this.scene.focusX = null;
    return new Promise((resolve, reject) => {
      const fail = (e: Error) => { this.pending.delete(fail); reject(e); };
      this.pending.add(fail);
      this.scene.walkTo(x, y, () => { this.pending.delete(fail); resolve(); });
    });
  }

  dance(ids: NpcId[] | 'all' | 'none'): void {
    this.dancing = new Set(ids === 'all' ? NPC_IDS : ids === 'none' ? [] : ids);
  }

  carry(p: Prop): void { this.carrying = p; }
  setBucket(at: [number, number] | null, upsideDown = false): void { this.bucket = at ? { x: at[0], y: at[1], upside: upsideDown } : null; }
  setPot(on: boolean): void { this.pot = on; }
  setPrints(on: boolean): void { this.prints = on; }
  setGoat(at: [number, number] | null, bone = false): void { this.goat = at ? { x: at[0], y: at[1], tx: at[0], ty: at[1], bone } : null; }
  setClouds(k: number): void { this.cloudsTarget = k; }
  setRain(on: boolean): void { this.rain = on; }
  resetLaundry(): void { this.s.counters['laundry_taken'] = 0; }
  music(t: Track): void { playMusic(t); }
  sound(name: Parameters<StoryApi['sound']>[0]): void { sfx[name](); }
  oops(): void { this.mistakes++; }

  every(ms: number, fn: () => void): () => void {
    const id = window.setInterval(() => { if (!this.paused()) fn(); }, ms);
    this.loops.add(id);
    return () => { clearInterval(id); this.loops.delete(id); };
  }

  // ───────────────────────── StoryApi: talking ─────────────────────────

  async say(who: Who, text: string, plain?: string): Promise<void> {
    const box = $('#s-say');
    clear(box);
    const showPlain = plain && this.app.settings.translations;
    box.append(
      who === 'narrator' ? h('span', { class: 'say-icon', 'aria-hidden': 'true' }, '📣') : this.face(who),
      h('div', { class: 'say-text' },
        who === 'narrator' ? null : h('strong', {}, who === 'you' ? 'You' : NPCS[who].short),
        h('span', { class: 'say-line' + (who === 'narrator' ? ' narr' : '') }, text),
        showPlain ? h('span', { class: 'say-plain' }, `(${plain})`) : null),
      h('span', { class: 'say-skip', 'aria-hidden': 'true' }, '▸'),
    );
    box.classList.remove('old');
    if (who !== 'narrator') {
      this.scene.say(who === 'you' ? 'player' : who, text, 4);
      const x = who === 'you' ? this.scene.player.x : this.cast.get(who)?.x;
      if (x !== undefined) this.scene.focusX = x;
    }
    const words = (text + (showPlain ? ' ' + plain : '')).split(/\s+/).length;
    await this.sleep(Math.min(5500, Math.max(1700, 700 + words * 230)), true);
  }

  async lines(l: Say[]): Promise<void> {
    for (const x of l) {
      if (x.sound) sfx[x.sound]();
      await this.say(x.who, x.text, x.plain);
    }
  }

  async banner(text: string, plain?: string): Promise<void> {
    const b = $('#s-banner');
    clear(b);
    b.append(h('div', { class: 'banner-text' }, text));
    if (plain) b.append(h('div', { class: 'banner-plain' }, plain));
    b.hidden = false;
    sfx.notify();
    try {
      await this.sleep(2300, true);
    } finally {
      b.hidden = true;
    }
  }

  wait(ms: number): Promise<void> {
    return this.sleep(ms);
  }

  reward(coins: number, why: string): void {
    this.p.coins += coins;
    this.earned += coins;
    saveProgress(this.p);
    this.refreshCoins();
    const c = $('#s-coins');
    c.classList.remove('bump');
    void c.offsetWidth;
    c.classList.add('bump');
    const pl = this.scene.player;
    this.scene.float(pl.x, pl.y - 200, `+${coins} 🪙 ${why}`, 'neutral');
    sfx.coin();
  }

  celebrate(): void {
    this.dance('all');
    sfx.cheer();
    if (this.app.settings.reduceMotion) return;
    const colors = ['#f2b632', '#1f6f50', '#c8553d', '#2d6cdf', '#fd79a8', '#ffffff'];
    for (let i = 0; i < 90; i++) {
      this.confetti.push({ x: 640 + (Math.random() - 0.5) * 300, y: 250, vx: (Math.random() - 0.5) * 520, vy: -200 - Math.random() * 380, c: colors[i % colors.length], life: 2.6 });
    }
  }

  bubble(who: NpcId | 'you', text: string): void {
    this.scene.say(who === 'you' ? 'player' : who, text, 2.2);
  }

  private face(who: NpcId | 'you'): HTMLCanvasElement {
    const c = h('canvas', { class: 'say-face', width: 112, height: 112, 'aria-hidden': 'true' });
    if (who === 'you') { if (!drawFace(c, `player${this.p.look}` as CharKey)) drawPortrait(c, PLAYER_LOOKS[this.p.look], '#d6ecff'); }
    else if (!drawFace(c, who)) drawPortrait(c, NPCS[who].look);
    return c;
  }

  // ───────────────────────── StoryApi: input steps ─────────────────────────

  private setGoal(text: string, extra?: Node): void {
    const g = $('#s-goal');
    clear(g);
    g.append(h('span', { class: 'goal-icon', 'aria-hidden': 'true' }, '🎯'), h('span', { class: 'goal-text' }, text));
    if (extra) g.append(extra);
    g.hidden = false;
    g.classList.remove('nudge');
    $('#s-say').classList.add('old');
  }

  private nudge(): void {
    const g = $('#s-goal');
    g.classList.remove('nudge');
    void g.offsetWidth;
    g.classList.add('nudge');
  }

  private setButtons(btns: Btn[], numbered = true): void {
    const box = $('#s-actions');
    clear(box);
    box.classList.toggle('many', btns.length > 3);
    box.classList.remove('busy');
    btns.forEach((b, i) => {
      box.append(h('button', { class: 'act ' + (b.cls ?? ''), type: 'button', 'data-key': numbered ? i + 1 : undefined, onclick: () => { sfx.click(); this.waiter?.({ kind: 'btn', i }); } },
        numbered && btns.length > 1 ? h('span', { class: 'kbd', 'aria-hidden': 'true' }, String(i + 1)) : null,
        h('span', { class: 'act-icon', 'aria-hidden': 'true' }, b.icon),
        h('span', { class: 'act-label' }, b.label)));
    });
  }

  private busy(on: boolean): void {
    $('#s-actions').classList.toggle('busy', on);
    for (const b of document.querySelectorAll<HTMLButtonElement>('#s-actions button')) b.disabled = on;
  }

  private done(): void {
    clear($('#s-actions'));
    $('#s-goal').hidden = true;
    this.point(null);
  }

  /** Arrow + glow on the thing to tap, and pan the camera to it on phones. */
  private point(t: Target | null): void {
    const sc = this.scene;
    this.pointTarget = t;
    sc.highlight = t && t.kind !== 'prop' ? t.id : null;
    sc.pointAt = t ? this.anchor(t) : null;
    sc.focusX = sc.pointAt?.x ?? null;
  }

  private anchor(t: Target): { x: number; y: number } | null {
    if (t.kind === 'obj') { const b = OBJ_BOXES[t.id]; return { x: b.ax, y: b.ay }; }
    if (t.kind === 'npc') {
      const m = this.cast.get(t.id);
      if (!m) return null;
      return { x: m.x, y: m.y - ((bodyImg(t.id) ? 176 : 150) + 8) * NPCS[t.id].look.height };
    }
    if (t.id === 'goat' && this.goat) return { x: this.goat.x + 10, y: this.goat.y - 72 };
    if (t.id === 'bucket' && this.bucket) return { x: this.bucket.x, y: this.bucket.y - 46 };
    return null;
  }

  /** A tap that isn't the answer: residents react, everything else nudges the goal. */
  private react(pick: Target | null): void {
    if (pick?.kind === 'npc') this.poke(pick.id);
    else if (pick) this.nudge();
  }

  private poke(id: NpcId): void {
    const pool = POKES[id];
    this.scene.say(id, pool[Math.floor(Math.random() * pool.length)], 1.8);
    this.poked.set(id, this.clock + 0.9);
    sfx.click();
  }

  async choose(goal: string, opts: Opt[], target?: Target): Promise<void> {
    this.setGoal(goal);
    this.point(null);
    const correct = opts.findIndex((o) => o.ok);
    const tried = new Set<number>();
    let hinted = false;
    const render = () => this.setButtons(opts.map((o, i) => ({ label: o.label, icon: o.icon, cls: (tried.has(i) ? 'tried' : '') + (hinted && i === correct ? ' hint' : '') })));
    render();
    for (;;) {
      const inp = await this.input();
      let i = -1;
      if (inp?.kind === 'btn') i = inp.i;
      else if (inp?.kind === 'tap') {
        if (target && same(inp.pick, target)) i = correct;
        else { this.react(inp.pick); continue; }
      }
      if (i < 0) continue;
      if (i === correct) {
        sfx.good();
        this.done();
        return;
      }
      this.oops();
      sfx.boing();
      tried.add(i);
      this.busy(true);
      await this.lines(opts[i].reply ?? [NARR('Hmm, not that one. Try again!')]);
      hinted = true;
      render();
      this.setGoal(goal);
      if (target) this.point(target);
    }
  }

  async tap(goal: string, target: Target, button: { label: string; icon: string }): Promise<void> {
    this.setGoal(goal);
    this.point(target);
    this.setButtons([{ ...button, cls: 'primary pulse' }]);
    for (;;) {
      const inp = await this.input();
      if (inp?.kind === 'btn' || (inp?.kind === 'tap' && same(inp.pick, target))) break;
      if (inp?.kind === 'tap') this.react(inp.pick);
    }
    sfx.good();
    this.done();
  }

  async search(goal: string, found: Target[], spots: Array<{ target: Target; label: string; reply: Say[] }>, hint: { after: number; at: Target; line: Say }): Promise<void> {
    this.setGoal(goal);
    this.point(null);
    // Buttons too, so it works without tapping the picture. The right spot sits among the others.
    const all = [...spots.slice(0, 3), { target: found[found.length - 1], label: 'Chairs', reply: [] as Say[] }, ...spots.slice(3)];
    const visited = new Set<number>();
    const render = () => this.setButtons(all.map((s, i) => ({ label: s.label, icon: visited.has(i) ? '✓' : '🔍', cls: 'chip' + (visited.has(i) ? ' tried' : '') })), false);
    render();
    let misses = 0;
    for (;;) {
      const inp = await this.input();
      let idx = -1;
      if (inp?.kind === 'btn') idx = inp.i;
      else if (inp?.kind === 'tap') {
        if (found.some((f) => same(inp.pick, f))) break;
        idx = all.findIndex((s) => same(inp.pick, s.target));
        if (idx < 0) { this.react(inp.pick); continue; }
      }
      if (idx < 0) continue;
      if (all[idx].reply.length === 0) break; // the right spot
      visited.add(idx);
      misses++;
      this.busy(true);
      sfx.boing();
      await this.lines(all[idx].reply);
      if (misses === hint.after) {
        await this.lines([hint.line]);
        this.point(hint.at);
      }
      render();
      this.setGoal(goal);
    }
    sfx.good();
    this.done();
  }

  async mash(goal: string, target: Target, times: number, button: { label: string; icon: string }, each: (n: number) => void): Promise<void> {
    let n = 0;
    const counter = h('span', { class: 'goal-count' }, `0/${times}`);
    this.setGoal(goal, counter);
    this.point(target);
    const render = () => this.setButtons([{ label: `${button.label} ${n}/${times}`, icon: button.icon, cls: 'primary pulse' }]);
    render();
    while (n < times) {
      const inp = await this.input();
      if (inp?.kind === 'btn' || (inp?.kind === 'tap' && same(inp.pick, target))) {
        n++;
        counter.textContent = `${n}/${times}`;
        each(n);
        render();
        if (n < times) this.point(target); // re-anchor (the goat moves)
      } else if (inp?.kind === 'tap') this.react(inp.pick);
    }
    this.done();
  }

  async collect(goal: string, seconds: number, onGrab: (i: number) => void): Promise<boolean> {
    const total = LAUNDRY_ITEMS.length;
    const count = h('span', { class: 'goal-count' }, `0/${total}`);
    const bar = h('span', { class: 'timer' }, h('span', { class: 'timer-fill' }));
    this.setGoal(goal, h('span', { class: 'goal-extra' }, count, bar));
    this.point({ kind: 'obj', id: 'laundry' });
    this.scene.highlight = null;
    this.setButtons([{ label: 'GRAB A CLOTH', icon: '🧺', cls: 'primary' }]);
    this.collecting = true;
    this.pointTarget = null;
    let left = seconds * 1000;
    const fill = bar.firstElementChild as HTMLElement;
    const timer = window.setInterval(() => {
      if (!this.paused()) left -= 50;
      fill.style.width = `${Math.max(0, (left / (seconds * 1000)) * 100)}%`;
      bar.classList.toggle('low', left < 5000);
    }, 50);
    this.loops.add(timer);
    const taken = () => this.s.counters['laundry_taken'] ?? 0;
    const grab = (i: number) => {
      this.s.counters['laundry_taken'] = taken() | (1 << i);
      const [x, w, hh, c] = LAUNDRY_ITEMS[i];
      const k = this.cast.get('kemi');
      this.flying.push({ x0: x + w / 2, y0: laundryY(x) + hh / 2, x1: (k?.x ?? 340) + 40, y1: (k?.y ?? 600) - 30, t0: this.clock, c });
      this.scene.float(x + w / 2, laundryY(x) - 10, '✓', 'good');
      onGrab(i);
    };
    let n = 0;
    try {
      while (n < total) {
        const inp = await this.input(() => left <= 0);
        if (!inp) return false;
        if (inp.kind === 'btn') {
          const i = LAUNDRY_ITEMS.findIndex((_, k) => !(taken() & (1 << k)));
          if (i >= 0) { grab(i); n++; }
        } else if (inp.pick?.kind === 'prop' && inp.pick.id.startsWith('cloth')) {
          const i = Number(inp.pick.id.slice(5));
          if (!(taken() & (1 << i))) { grab(i); n++; }
        } else this.react(inp.pick);
        count.textContent = `${n}/${total}`;
      }
      sfx.good();
      return true;
    } finally {
      clearInterval(timer);
      this.loops.delete(timer);
      this.collecting = false;
      this.done();
      if (n < total) this.oops();
    }
  }

  async interview(goal: string, people: Array<{ id: NpcId; lines: Say[] }>): Promise<void> {
    const heard = new Set<NpcId>();
    const render = () => {
      this.setButtons(people.map((p) => ({ label: NPCS[p.id].short, icon: heard.has(p.id) ? '✓' : '💬', cls: 'chip' + (heard.has(p.id) ? ' tried' : '') })), false);
      const next = people.find((p) => !heard.has(p.id));
      this.point(next ? { kind: 'npc', id: next.id } : null);
    };
    this.setGoal(goal);
    render();
    while (heard.size < people.length) {
      const inp = await this.input();
      let who: NpcId | null = null;
      if (inp?.kind === 'btn') who = people[inp.i].id;
      else if (inp?.kind === 'tap' && inp.pick?.kind === 'npc' && people.some((p) => p.id === (inp.pick as { id: NpcId }).id)) who = inp.pick.id;
      else if (inp?.kind === 'tap') { this.react(inp.pick); continue; }
      if (!who) continue;
      this.busy(true);
      this.point(null);
      await this.lines(people.find((p) => p.id === who)!.lines);
      heard.add(who);
      this.setGoal(goal);
      render();
    }
    this.done();
  }

  // ───────────────────────── Picking ─────────────────────────

  private pickAt(x: number, y: number): Target | null {
    if (this.collecting) {
      let best = -1, bestD = Infinity;
      LAUNDRY_ITEMS.forEach(([lx, w, hh], i) => {
        if ((this.s.counters['laundry_taken'] ?? 0) & (1 << i)) return;
        const ly = laundryY(lx);
        if (x < lx - 14 || x > lx + w + 14 || y < ly - 24 || y > ly + hh + 24) return;
        const d = Math.hypot(x - (lx + w / 2), y - (ly + hh / 2));
        if (d < bestD) { bestD = d; best = i; }
      });
      if (best >= 0) return { kind: 'prop', id: 'cloth' + best };
    }
    const g = this.goat;
    if (g && x > g.x - 45 && x < g.x + 55 && y > g.y - 80 && y < g.y + 10) return { kind: 'prop', id: 'goat' };
    const b = this.bucket;
    if (b && x > b.x - 30 && x < b.x + 30 && y > b.y - 50 && y < b.y + 8) return { kind: 'prop', id: 'bucket' };
    return this.scene.pick(x, y);
  }

  // ───────────────────────── Per-frame + drawing ─────────────────────────

  private tick(dt: number): void {
    this.clock += dt;
    const step = (m: Mover, speed: number) => {
      const dx = m.tx - m.x, dy = m.ty - m.y, d = Math.hypot(dx, dy);
      if (d < 1) { m.x = m.tx; m.y = m.ty; return; }
      const k = Math.min(1, (speed * dt) / d);
      m.x += dx * k;
      m.y += dy * k;
    };
    for (const m of this.cast.values()) step(m, 240);
    if (this.goat) step(this.goat, 420);
    // Keep the arrow on moving targets (the goat runs!).
    if (this.pointTarget) this.scene.pointAt = this.anchor(this.pointTarget);
    this.clouds += (this.cloudsTarget - this.clouds) * Math.min(1, dt * 1.5);
    for (const c of this.confetti) { c.vy += 520 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.life -= dt; }
    this.confetti = this.confetti.filter((c) => c.life > 0);
    this.flying = this.flying.filter((f) => this.clock - f.t0 < 0.6);
  }

  private drawWorld(ctx: CanvasRenderingContext2D, t: number): void {
    const own = (id: string) => this.p.owned.includes(id);
    if (own('bunting')) {
      ctx.strokeStyle = '#4a3a2a'; ctx.lineWidth = 1.5;
      for (const [x0, x1] of [[384, 700], [700, 1016]]) {
        ctx.beginPath(); ctx.moveTo(x0, 160); ctx.quadraticCurveTo((x0 + x1) / 2, 185, x1, 160); ctx.stroke();
        for (let i = 0; i < 12; i++) {
          const k = (i + 0.5) / 12, x = x0 + (x1 - x0) * k, y = 160 + Math.sin(k * Math.PI) * 12.5;
          ctx.fillStyle = i % 2 ? '#ffffff' : '#1f8a4c';
          ctx.beginPath(); ctx.moveTo(x - 8, y); ctx.lineTo(x + 8, y); ctx.lineTo(x, y + 16 + Math.sin(t * 3 + i) * 1.5); ctx.closePath(); ctx.fill();
        }
      }
    }
    if (own('plants')) {
      for (const [x, c] of [[30, '#e84393'], [250, '#fdcb6e'], [1250, '#e17055'], [1010, '#a29bfe']] as const) {
        ctx.fillStyle = '#b5543c'; ctx.beginPath(); ctx.moveTo(x - 16, 470); ctx.lineTo(x + 16, 470); ctx.lineTo(x + 12, 494); ctx.lineTo(x - 12, 494); ctx.fill();
        ctx.fillStyle = '#2e7d32';
        for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.ellipse(x + i * 6, 458, 4, 14, i * 0.4, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = c;
        for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.arc(x + i * 10, 446 - Math.abs(i) * -4, 6, 0, Math.PI * 2); ctx.fill(); }
      }
    }
    if (ownsPremium('decor-naija-flags')) {
      for (let i = 0; i < 9; i++) {
        const x = 1040 + i * 26, y = 290;
        ctx.fillStyle = '#5d4037'; ctx.fillRect(x, y - 30, 2, 30);
        const wave = Math.sin(t * 3 + i) * 2;
        ctx.fillStyle = '#008751'; ctx.fillRect(x + 2, y - 30 + wave, 6, 14);
        ctx.fillStyle = '#ffffff'; ctx.fillRect(x + 8, y - 30 + wave, 6, 14);
        ctx.fillStyle = '#008751'; ctx.fillRect(x + 14, y - 30 + wave, 6, 14);
      }
    }
    if (ownsPremium('decor-owambe')) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(560, 560, 320, 10);
      for (let i = 0; i < 10; i++) { ctx.fillStyle = i % 2 ? '#f2b632' : '#c8553d'; ctx.beginPath(); ctx.moveTo(560 + i * 32, 520); ctx.lineTo(592 + i * 32, 520); ctx.lineTo(588 + i * 32, 548); ctx.lineTo(564 + i * 32, 548); ctx.fill(); }
      ctx.fillStyle = '#7b2d26'; ctx.fillRect(564, 520, 4, 140); ctx.fillRect(872, 520, 4, 140);
    }
    if (own('mural')) {
      ctx.fillStyle = '#7b2d26'; ctx.fillRect(66, 244, 6, 46); ctx.fillRect(208, 244, 6, 46);
      ctx.fillStyle = '#f2b632'; ctx.strokeStyle = '#7b2d26'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(52, 226, 176, 34, 8); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#1f6f50'; ctx.font = '900 15px "Arial Black", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('UNITY COMPOUND', 140, 249); ctx.textAlign = 'left';
    }
    if (this.prints) {
      ctx.fillStyle = 'rgba(70,45,25,0.55)';
      for (let i = 0; i < 9; i++) {
        const x = 760 + i * 36, y = 640 + Math.sin(i) * 10 + (i % 2) * 8;
        ctx.beginPath(); ctx.ellipse(x, y, 3.5, 5, 0.3, 0, Math.PI * 2); ctx.ellipse(x + 7, y, 3.5, 5, -0.3, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (this.pot) {
      ctx.fillStyle = '#2d3436'; ctx.beginPath(); ctx.ellipse(720, 600, 26, 18, 0, 0, Math.PI); ctx.fill();
      ctx.fillRect(694, 584, 52, 16);
      ctx.fillStyle = '#636e72'; ctx.beginPath(); ctx.ellipse(720, 584, 28, 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      for (let i = 0; i < 3; i++) { const k = (t * 0.6 + i / 3) % 1; ctx.globalAlpha = 0.5 * (1 - k); ctx.beginPath(); ctx.arc(712 + i * 8 + Math.sin(t * 2 + i) * 4, 574 - k * 40, 4 + k * 5, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
    }
    if (this.bucket) drawBucket(ctx, this.bucket.x, this.bucket.y, this.bucket.upside, false);
    if (this.goat) {
      drawGoat(ctx, this.goat.x, this.goat.y, t);
      if (this.goat.bone) { ctx.fillStyle = '#f5f0e1'; ctx.strokeStyle = '#8d6e63'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect(this.goat.x + 40, this.goat.y - 46, 20, 6, 3); ctx.fill(); ctx.stroke(); }
    }
  }

  private drawFront(ctx: CanvasRenderingContext2D): void {
    const pl = this.scene.player;
    if (this.carrying === 'jerrycan') drawJerrycan(ctx, pl.x + 18, pl.y - 40, '#e1b12c');
    else if (this.carrying) drawBucket(ctx, pl.x + 30, pl.y - 34, false, this.carrying === 'bucketFull');
    // Kemi's basket during the rain level
    if (this.collecting || (this.s.counters['laundry_taken'] ?? 0)) {
      const k = this.cast.get('kemi');
      if (k) {
        ctx.fillStyle = '#c69c6d'; ctx.strokeStyle = '#7a5230'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(k.x + 18, k.y - 50); ctx.lineTo(k.x + 66, k.y - 50); ctx.lineTo(k.x + 60, k.y - 18); ctx.lineTo(k.x + 24, k.y - 18); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }
    for (const f of this.flying) {
      const k = Math.min(1, (this.clock - f.t0) / 0.6);
      const x = f.x0 + (f.x1 - f.x0) * k, y = f.y0 + (f.y1 - f.y0) * k - Math.sin(k * Math.PI) * 80;
      ctx.fillStyle = f.c; ctx.beginPath(); ctx.roundRect(x - 10, y - 10, 20, 20, 4); ctx.fill();
    }
  }

  private drawTop(ctx: CanvasRenderingContext2D, t: number): void {
    if (this.p.owned.includes('lights')) {
      const cols = ['#ff6b6b', '#ffd23f', '#3ddc84', '#4fc3f7', '#fd79a8'];
      for (let i = 0; i < 26; i++) {
        const x = 392 + i * 24.5, y = 252 + Math.sin(i * 0.9) * 3;
        const on = (Math.floor(t * 2) + i) % 3 !== 0;
        ctx.fillStyle = cols[i % cols.length];
        ctx.globalAlpha = on ? 1 : 0.35;
        ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
        if (on) { ctx.globalAlpha = 0.25; ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
    }
    if (this.clouds > 0.01) {
      ctx.fillStyle = `rgba(40,48,66,${0.32 * this.clouds})`;
      ctx.fillRect(0, 0, 1280, 720);
      ctx.fillStyle = `rgba(70,78,96,${0.95 * this.clouds})`;
      for (let i = 0; i < 6; i++) {
        const x = ((i * 240 + t * 14) % 1500) - 110, y = 40 + (i % 3) * 30;
        ctx.beginPath(); ctx.ellipse(x, y, 110, 34, 0, 0, Math.PI * 2); ctx.ellipse(x + 70, y - 18, 70, 30, 0, 0, Math.PI * 2); ctx.ellipse(x - 70, y + 4, 60, 24, 0, 0, Math.PI * 2); ctx.fill();
      }
    }
    if (this.rain) {
      ctx.strokeStyle = 'rgba(190,215,255,0.55)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < 160; i++) {
        const x = (i * 97 + t * 260) % 1340 - 30, y = (i * 53 + t * 900) % 760 - 20;
        ctx.moveTo(x, y); ctx.lineTo(x - 7, y + 22);
      }
      ctx.stroke();
    }
    for (const c of this.confetti) {
      ctx.fillStyle = c.c;
      ctx.globalAlpha = Math.min(1, c.life);
      ctx.fillRect(c.x, c.y, 8, 5);
    }
    ctx.globalAlpha = 1;
  }
}

function drawBucket(ctx: CanvasRenderingContext2D, x: number, y: number, upside: boolean, full: boolean): void {
  ctx.fillStyle = '#1e6fd9';
  ctx.strokeStyle = '#0d3f86';
  ctx.lineWidth = 2;
  const top = y - 38, w1 = upside ? 30 : 22, w2 = upside ? 22 : 30;
  ctx.beginPath();
  ctx.moveTo(x - w2, top); ctx.lineTo(x + w2, top); ctx.lineTo(x + w1, y); ctx.lineTo(x - w1, y); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#4b92f0'; ctx.fillRect(x - w2 + 4, top + 6, (w2 - 4) * 2 * 0.3, 26);
  if (!upside) {
    ctx.beginPath(); ctx.arc(x, top, w2 - 2, Math.PI, 0); ctx.stroke();
    if (full) { ctx.fillStyle = '#9fd8ff'; ctx.beginPath(); ctx.ellipse(x, top + 2, w2 - 3, 4, 0, 0, Math.PI * 2); ctx.fill(); }
  }
}

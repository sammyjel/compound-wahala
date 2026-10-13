import { setSound, sfx } from '../audio/sfx.ts';
import { playMusic, setMusic } from '../audio/music.ts';
import { OBJECTS, type ObjId } from '../data/actions.ts';
import { MISSIONS } from '../data/missions.ts';
import { NPCS, PLAYER_LOOKS } from '../data/npcs.ts';
import { getBill, PAYERS, payerName, payShare } from '../engine/bills.ts';
import { Game, type ChoiceView, type DaySummary } from '../engine/game.ts';
import { loadSettings, saveGame, saveSettings, type Settings } from '../engine/save.ts';
import {
  describeEffects, drainFeedback, flag, fmtHour, naira, phaseOf, powerLabel, STAT_LABEL, trustTier,
} from '../engine/state.ts';
import { drawPortrait } from '../render/people.ts';
import { drawFace, type CharKey } from '../render/sprites.ts';
import { OBJ_BOXES, Scene } from '../render/scene.ts';
import { DAY_END, LAST_DAY, NPC_IDS } from '../types.ts';
import type { Line, NpcId, StatKey } from '../types.ts';
import { $, clear, h, icon, type IconKey } from './dom.ts';
import { hints, markers } from './hints.ts';
import { renderLines } from './lines.ts';
import { runMeetingUI } from './meeting.ts';
import { choiceButton, closeTopModal, confirmDialog, modalOpen, openModal, topModal, trapFocus } from './modal.ts';
import { openPauseMenu, runTutorial, settingsModal, showResults, showTitle, weekMenu } from './screens.ts';

type PanelMode =
  | { kind: 'home' }
  | { kind: 'npc'; id: NpcId; lines: Line[]; choices: ChoiceView[] | null; topicId: string | null; blocked: boolean }
  | { kind: 'obj'; id: ObjId; result: string | null; ok: boolean }
  | { kind: 'missions' }
  | { kind: 'bills' }
  | { kind: 'log' };

export class App {
  game: Game | null = null;
  settings: Settings = loadSettings();
  scene: Scene;
  panel: PanelMode = { kind: 'home' };
  private flowing = false;
  private sleepRequested = false;
  private portraitCache = new Map<string, HTMLCanvasElement>();
  private panelKey = '';
  /** Story Mode (set in main.ts). */
  story: { leave(): void; playNext(): void; showMap(): void } | null = null;

  constructor() {
    this.applySettings();
    const canvas = $('#scene') as HTMLCanvasElement;
    this.scene = new Scene(canvas, {
      getState: () => this.game?.s ?? null,
      where: (id) => this.game!.npcWhere(id),
      playerLook: () => PLAYER_LOOKS[this.game?.s.counters['look'] ?? 0] ?? PLAYER_LOOKS[0],
      playerKey: () => `player${this.game?.s.counters['look'] ?? 0}` as CharKey,
      markers: () => (this.game ? markers(this.game) : new Set()),
      settings: () => this.settings,
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!this.game) return;
      const w = this.scene.toWorld(e.clientX, e.clientY);
      this.scene.hover = this.scene.pick(w.x, w.y);
      canvas.style.cursor = this.scene.hover ? 'pointer' : 'default';
    });
    canvas.addEventListener('pointerleave', () => (this.scene.hover = null));
    canvas.addEventListener('click', (e) => {
      if (!this.game || modalOpen()) return;
      const w = this.scene.toWorld(e.clientX, e.clientY);
      const p = this.scene.pick(w.x, w.y);
      if (!p) {
        if (w.y > 490) this.scene.walkTo(w.x, w.y);
        return;
      }
      if (p.kind === 'npc') this.selectNpc(p.id);
      else this.selectObj(p.id);
    });

    document.addEventListener('keydown', (e) => this.onKey(e));
    // Whenever a dialog closes, continue any queued events / meetings / day end.
    window.addEventListener('cw:modal-closed', () => {
      if (this.game && !this.flowing && !modalOpen()) setTimeout(() => void this.pump(), 0);
    });
    $('#btn-menu').addEventListener('click', () => openPauseMenu(this));
  }

  // ───────────────────────── Settings ─────────────────────────

  applySettings(): void {
    const size = { small: '14px', normal: '16px', large: '18.5px', xl: '21px' }[this.settings.textSize];
    document.documentElement.style.fontSize = size;
    document.documentElement.classList.toggle('reduce-motion', this.settings.reduceMotion);
    setSound(this.settings.sound);
    setMusic(this.settings.music, this.settings.musicVolume);
    saveSettings(this.settings);
    if (this.game) this.renderAll();
  }

  // ───────────────────────── Lifecycle ─────────────────────────

  start(game: Game): void {
    this.game = game;
    this.panel = { kind: 'home' };
    this.story?.leave();
    for (const id of ['screen-title', 'screen-results']) $('#' + id).hidden = true;
    $('#screen-game').hidden = false;
    this.scene.resize();
    this.scene.player.x = this.scene.player.tx = 820;
    this.scene.player.y = this.scene.player.ty = 540;
    this.scene.start();
    this.renderAll();
    this.save();
    void this.pump();
  }

  quitToTitle(): void {
    this.save();
    this.scene.stop();
    this.game = null;
    $('#screen-game').hidden = true;
    showTitle(this);
  }

  showTitle(): void {
    showTitle(this);
  }

  openSettings(): void {
    settingsModal(this);
  }

  weekMenu(): void {
    weekMenu(this);
  }

  save(): void {
    if (this.game) saveGame(this.game.s);
  }

  // ───────────────────────── The flow pump ─────────────────────────

  /** Re-render, show feedback, then work through queued events, meetings and day end. */
  async pump(): Promise<void> {
    this.renderAll();
    this.showFeedback();
    if (this.flowing || modalOpen()) return;
    this.flowing = true;
    try {
      for (let guard = 0; guard < 50; guard++) {
        const g = this.game;
        if (!g) break;
        if (g.currentEvent()) {
          await this.showEvent();
          continue;
        }
        if (!g.s.tutorialDone) {
          g.s.tutorialDone = true;
          this.save();
          await runTutorial(this);
          continue;
        }
        if (g.s.meetingPending) {
          await runMeetingUI(this, g);
          g.afterMeeting();
          this.save();
          this.renderAll();
          this.showFeedback();
          continue;
        }
        if (g.s.hour >= DAY_END || this.sleepRequested) {
          if (g.motionToday()) {
            g.callMeetingNow();
            continue;
          }
          this.sleepRequested = false;
          const done = await this.endDayFlow();
          if (done) break;
          continue;
        }
        break;
      }
    } finally {
      this.flowing = false;
    }
    this.save();
    this.renderAll();
  }

  private showEvent(): Promise<void> {
    const g = this.game!;
    const ev = g.currentEvent()!;
    sfx.notify();
    return new Promise((resolve) => {
      const m = openModal({
        kicker: `Day ${g.s.day} · ${fmtHour(g.s.hour)}`,
        title: ev.title,
        className: 'event-modal ev-' + ev.icon,
        body: renderLines(typeof ev.lines === 'function' ? ev.lines(g.s) : ev.lines, { player: g.s.playerName, translations: this.settings.translations }),
        numbered: true,
        actions: g.eventChoices(ev).map((c, i) => ({
          label: c.label,
          plain: this.settings.translations ? c.plain : undefined,
          hint: c.hint,
          disabled: c.disabled,
          onClick: () => {
            const text = g.chooseEvent(i);
            this.renderAll();
            this.showFeedback();
            m.setBody(h('div', { class: 'result-card' }, text));
            m.setActions([{ label: 'Continue', primary: true, onClick: () => resolve() }], false);
            return false;
          },
        })),
      });
    });
  }

  private async endDayFlow(): Promise<boolean> {
    const g = this.game!;
    sfx.night();
    const sum = g.endDay();
    this.save();
    this.renderAll();
    await this.showSummary(sum);
    if (sum.final) {
      this.scene.stop();
      showResults(this, g.s);
      return true;
    }
    g.nextDay();
    this.panel = { kind: 'home' };
    this.scene.player.x = this.scene.player.tx = 820;
    this.scene.player.y = this.scene.player.ty = 540;
    this.save();
    this.renderAll();
    return false;
  }

  private showSummary(sum: DaySummary): Promise<void> {
    const g = this.game!;
    return new Promise((resolve) => {
      const stat = (d: DaySummary['statDeltas'][number]) => {
        const diff = d.key === 'fuel' ? Math.round((d.to - d.from) * 10) / 10 : Math.round(d.to - d.from);
        const fmt = (v: number) => (d.key === 'cash' ? naira(v) : d.key === 'fuel' ? `${v}L` : String(Math.round(v)));
        return h('div', { class: 'sum-stat' }, icon(STAT_ICON[d.key]), h('span', { class: 'sum-label' }, STAT_LABEL[d.key]),
          h('span', { class: 'sum-val' }, fmt(d.to)),
          h('span', { class: 'delta ' + (diff > 0 ? 'up' : diff < 0 ? 'down' : '') }, diff === 0 ? '—' : `${diff > 0 ? '+' : '−'}${d.key === 'cash' ? naira(Math.abs(diff)) : Math.abs(diff)}`));
      };
      const rel = (d: DaySummary['trustDeltas'][number]) => {
        const diff = d.to - d.from;
        return h('div', { class: 'sum-rel' }, this.portrait(d.npc, 36), h('span', {}, NPCS[d.npc].short),
          h('span', { class: 'delta ' + (diff > 0 ? 'up' : diff < 0 ? 'down' : '') }, diff === 0 ? '—' : `♥ ${diff > 0 ? '+' : '−'}${Math.abs(diff)}`));
      };
      openModal({
        kicker: sum.final ? 'The week is over' : 'Night falls on Unity Compound',
        title: `Day ${sum.day} complete`,
        className: 'summary-modal',
        body: [
          h('div', { class: 'sum-grid' }, ...sum.statDeltas.map(stat)),
          h('h3', {}, 'Relationships'),
          h('div', { class: 'sum-rels' }, ...sum.trustDeltas.map(rel)),
          sum.missionsDone.length ? h('h3', {}, 'Missions completed') : null,
          sum.missionsDone.length ? h('ul', { class: 'sum-list good' }, ...sum.missionsDone.map((m) => h('li', {}, '✓ ' + m))) : null,
          h('h3', {}, 'What happened today'),
          h('ul', { class: 'sum-list' }, ...sum.log.slice(-12).map((l) => h('li', {}, l))),
          sum.tomorrow.length ? h('h3', {}, 'Tomorrow') : null,
          sum.tomorrow.length ? h('ul', { class: 'sum-list warn' }, ...sum.tomorrow.map((l) => h('li', {}, l))) : null,
        ].filter(Boolean) as Node[],
        actions: [{ label: sum.final ? 'See final results' : `Sleep → Day ${g.s.day + 1} of ${LAST_DAY}`, primary: true, onClick: () => resolve() }],
      });
    });
  }

  requestSleep(): void {
    const g = this.game;
    if (!g || modalOpen()) return;
    const motion = g.motionToday();
    const text = motion
      ? `Chief's meeting "${motion.title}" is at 6pm. Ending the day takes you to the meeting first.`
      : `End Day ${g.s.day} now? Unused hours are lost, but you'll wake up fresh.`;
    void confirmDialog(motion ? 'Go to the meeting?' : 'Sleep now?', text, motion ? 'Go to the meeting' : 'Sleep').then((ok) => {
      if (!ok) return;
      this.sleepRequested = true;
      void this.pump();
    });
  }

  // ───────────────────────── Feedback ─────────────────────────

  private showFeedback(): void {
    const g = this.game;
    if (!g) return;
    const fb = drainFeedback();
    const shown = fb.length > 4 ? fb.filter((f) => !f.npc).slice(0, 4) : fb;
    const rest = fb.filter((f) => !shown.includes(f));
    if (rest.length) this.toast('Ripple effects', rest.map((f) => f.text).join(' · '), 'info');
    for (const f of shown) {
      let pos = { x: this.scene.player.x, y: this.scene.player.y - 175 };
      if (f.npc) {
        const p = this.scene.npcPos(f.npc);
        if (p) pos = { x: p.x, y: p.y - 175 };
      }
      this.scene.float(pos.x, pos.y, f.text, f.tone);
    }
    if (fb.some((f) => f.text.startsWith('+₦'))) sfx.coin();
    else if (fb.some((f) => f.text.startsWith('−₦'))) sfx.spend();
    const raw = g.notices.splice(0);
    // Merge "New mission" notices into one toast so the scene isn't buried.
    const fresh = raw.filter((n) => n.kind === 'mission-new');
    const notices = raw.filter((n) => n.kind !== 'mission-new');
    if (fresh.length) notices.unshift({ kind: 'mission-new', title: fresh.length > 1 ? `${fresh.length} new missions` : 'New mission', text: fresh.map((n) => n.text).join(' · ') });
    for (const n of notices) {
      this.toast(n.title, n.text, n.kind);
      if (n.kind === 'mission-done') sfx.mission();
      else if (n.kind === 'mission-failed') sfx.bad();
      else if (n.kind === 'power') (n.title.startsWith('UP') ? sfx.powerOn : sfx.powerOff)();
      else sfx.notify();
    }
  }

  toast(title: string, text: string, kind = 'info'): void {
    const box = $('#toasts');
    const t = h('div', { class: 'toast t-' + kind, role: 'status' }, h('strong', {}, title), h('span', {}, text));
    box.append(t);
    const max = window.matchMedia('(max-width: 640px)').matches ? 2 : 4;
    while (box.children.length > max) box.firstElementChild?.remove();
    setTimeout(() => t.classList.add('out'), 3600);
    setTimeout(() => t.remove(), 4100);
  }

  // ───────────────────────── Selection ─────────────────────────

  selectNpc(id: NpcId): void {
    const g = this.game;
    if (!g || modalOpen()) return;
    const where = g.npcWhere(id);
    this.scene.selected = { kind: 'npc', id };
    this.panel = { kind: 'npc', id, lines: [], choices: null, topicId: null, blocked: true };
    this.renderPanel();
    this.focusPanel();
    const open = () => {
      if (this.panel.kind !== 'npc' || this.panel.id !== id) return; // player picked someone else meanwhile
      const t = g.openTalk(id);
      const lines: Line[] = [];
      if (t.message) lines.push({ who: 'narrator', text: t.message });
      if (t.opener) lines.push(t.opener);
      this.panel = { kind: 'npc', id, lines, choices: null, topicId: null, blocked: !t.ok };
      void this.pump();
    };
    if (where.status === 'here') {
      const a = this.scene.approach({ kind: 'npc', id });
      this.scene.walkTo(a.x, a.y, open);
    } else if (where.status === 'inside') {
      const d = DOOR_STAND[id];
      this.scene.walkTo(d.x, d.y, open); // walk to their door and knock
    } else {
      this.scene.player.cb = null;
      open();
    }
  }

  selectObj(id: ObjId): void {
    if (!this.game || modalOpen()) return;
    this.scene.selected = { kind: 'obj', id };
    const st = OBJ_BOXES[id].stand;
    this.panel = { kind: 'obj', id, result: null, ok: true };
    this.scene.walkTo(st.x, st.y); // replaces any pending walk callback
    sfx.click();
    this.renderAll();
    this.focusPanel();
  }

  setPanel(kind: 'home' | 'missions' | 'bills' | 'log'): void {
    this.panel = { kind } as PanelMode;
    this.scene.selected = null;
    this.renderAll();
    this.focusPanel();
  }

  private focusPanel(): void {
    if (window.matchMedia('(max-width: 900px)').matches) $('#panel').scrollIntoView({ behavior: this.settings.reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
  }

  // ───────────────────────── Rendering ─────────────────────────

  renderAll(): void {
    if (!this.game) return;
    this.syncMusic();
    this.renderHud();
    this.renderDock();
    this.renderPanel();
  }

  /** Pick the music for what is happening right now. */
  syncMusic(): void {
    const g = this.game;
    if (!g || $('#screen-game').hidden) return;
    const ev = g.currentEvent()?.id;
    if (g.s.meetingPending) playMusic('meeting');
    else if (ev === 'noisy_music') playMusic('tobi');
    else if (ev === 'owambe') playMusic('owambe');
    else playMusic(g.s.hour >= 18 ? 'night' : 'day');
  }

  portrait(id: NpcId | 'you', size: number): HTMLCanvasElement {
    const key = id + size;
    let c = this.portraitCache.get(key);
    if (!c) {
      c = h('canvas', { width: size * 2, height: size * 2, class: 'portrait', style: `width:${size}px;height:${size}px`, 'aria-hidden': 'true' });
      const look = id === 'you' ? PLAYER_LOOKS[this.game?.s.counters['look'] ?? 0] : NPCS[id].look;
      const charKey = (id === 'you' ? `player${this.game?.s.counters['look'] ?? 0}` : id) as CharKey;
      const photo = drawFace(c, charKey);
      if (!photo) drawPortrait(c, look, id === 'you' ? '#d6ecff' : PORTRAIT_BG[id]);
      // Only cache real photos, so a fallback drawn before the art loads gets replaced later.
      if (id !== 'you' && photo) this.portraitCache.set(key, c);
      return c;
    }
    const copy = h('canvas', { width: c.width, height: c.height, class: 'portrait', style: c.getAttribute('style') ?? '', 'aria-hidden': 'true' });
    copy.getContext('2d')!.drawImage(c, 0, 0);
    return copy;
  }

  private renderHud(): void {
    const s = this.game!.s;
    const hud = $('#hud-main');
    clear(hud);
    const pw = powerLabel(s);
    const ph = phaseOf(s.hour);
    const pct = Math.min(1, (s.hour - 7) / (DAY_END - 7));
    hud.append(
      h('div', { class: 'clock', 'aria-label': `Day ${s.day} of ${LAST_DAY}, ${fmtHour(s.hour)}, ${ph}` },
        icon(ph === 'night' || ph === 'evening' ? 'moon' : 'sun'),
        h('div', {}, h('div', { class: 'day' }, `Day ${s.day}/${LAST_DAY}`), h('div', { class: 'time' }, fmtHour(s.hour))),
        h('div', { class: 'daybar', 'aria-hidden': 'true' }, h('span', { style: `width:${pct * 100}%` })),
      ),
      h('div', { class: 'power p-' + pw.tone, title: 'Power: ' + pw.label }, icon(pw.tone === 'bad' ? 'nopower' : 'power'), h('span', {}, pw.label)),
    );
    const stats = $('#hud-stats');
    clear(stats);
    const chip = (k: StatKey, value: string, bar: number | null, warn: boolean) =>
      h('div', { class: 'stat' + (warn ? ' warn' : ''), title: STAT_HELP[k], 'aria-label': `${STAT_LABEL[k]}: ${value}` },
        icon(STAT_ICON[k]),
        h('div', { class: 'stat-text' }, h('span', { class: 'stat-label' }, STAT_LABEL[k]), h('span', { class: 'stat-val' }, value)),
        bar === null ? null : h('div', { class: 'statbar', 'aria-hidden': 'true' }, h('span', { style: `width:${bar}%` })),
      );
    stats.append(
      chip('cash', naira(s.stats.cash), null, s.stats.cash < 2000),
      chip('happiness', String(Math.round(s.stats.happiness)), s.stats.happiness, s.stats.happiness < 30),
      chip('reputation', String(Math.round(s.stats.reputation)), s.stats.reputation, false),
      chip('fuel', `${s.stats.fuel}L`, (s.stats.fuel / 20) * 100, s.stats.fuel <= 0),
      chip('water', `${Math.round(s.stats.water)}%`, s.stats.water, s.stats.water < 20),
      chip('condition', String(Math.round(s.stats.condition)), s.stats.condition, s.stats.condition < 35),
    );
  }

  private renderDock(): void {
    const g = this.game!;
    const s = g.s;
    const res = $('#dock-residents');
    clear(res);
    for (const id of NPC_IDS) {
      const w = g.npcWhere(id);
      const status = w.status === 'here' ? 'In the compound' : w.status === 'inside' ? 'Inside their room (knock)' : 'Out of the compound';
      const marked = markers(g).has(id);
      const b = h('button', {
        class: `res res-${w.status}${this.panel.kind === 'npc' && this.panel.id === id ? ' active' : ''}`,
        type: 'button', title: `${NPCS[id].name} — ${status}`, 'aria-label': `${NPCS[id].short}, ${status}${marked ? ', has something for you' : ''}`,
        onclick: () => this.selectNpc(id),
      }, this.portrait(id, 40), h('span', { class: 'res-name' }, NPCS[id].short.replace('Aunty ', '').replace('Brother ', '').replace('Nurse ', '').replace('Iya ', 'Iya ')),
      h('span', { class: 'dot', 'aria-hidden': 'true' }), marked ? h('span', { class: 'res-mark', 'aria-hidden': 'true' }, '!') : null);
      res.append(b);
    }
    const places = $('#dock-places');
    clear(places);
    for (const id of Object.keys(OBJECTS) as ObjId[]) {
      places.append(h('button', {
        class: `place${this.panel.kind === 'obj' && this.panel.id === id ? ' active' : ''}${markers(g).has(id) ? ' marked' : ''}`,
        type: 'button', onclick: () => this.selectObj(id),
      }, OBJ_BOXES[id].label));
    }
    const nav = $('#dock-nav');
    clear(nav);
    const activeCount = MISSIONS.filter((m) => s.missions[m.id] === 'active').length;
    const owes = s.bills.some((b) => b.status !== 'settled' && !b.paid.you);
    const navBtn = (label: string, kind: 'home' | 'missions' | 'bills' | 'log', badge?: string) =>
      h('button', { class: 'nav' + (this.panel.kind === kind ? ' active' : ''), type: 'button', id: 'btn-' + kind, onclick: () => this.setPanel(kind) },
        label, badge ? h('span', { class: 'badge' }, badge) : null);
    nav.append(
      navBtn('Today', 'home'),
      navBtn('Missions', 'missions', activeCount ? String(activeCount) : undefined),
      navBtn('Bills', 'bills', owes ? '!' : undefined),
      navBtn('Log', 'log'),
      h('button', { class: 'nav sleep', type: 'button', id: 'btn-sleep', onclick: () => this.requestSleep() }, g.motionToday() && s.hour < 18 ? 'Meeting / Sleep' : 'Sleep'),
    );
  }

  renderPanel(): void {
    const g = this.game;
    if (!g) return;
    const p = $('#panel');
    const m = this.panel;
    const key = m.kind + ('id' in m ? m.id : '') + (m.kind === 'npc' ? m.lines.length + (m.lines[0]?.text ?? '') : m.kind === 'obj' ? m.result ?? '' : '');
    if (key !== this.panelKey) p.scrollTop = 0;
    this.panelKey = key;
    clear(p);
    if (m.kind === 'home') p.append(this.panelHome());
    else if (m.kind === 'npc') p.append(this.panelNpc(m));
    else if (m.kind === 'obj') p.append(this.panelObj(m));
    else if (m.kind === 'missions') p.append(this.panelMissions());
    else if (m.kind === 'bills') p.append(this.panelBills());
    else p.append(this.panelLog());
  }

  private header(title: string, sub?: string, back = true): HTMLElement {
    return h('div', { class: 'panel-head' },
      back ? h('button', { class: 'back', type: 'button', 'aria-label': 'Back to Today', onclick: () => { this.scene.selected = null; this.setPanel('home'); } }, '←') : null,
      h('div', {}, h('h2', {}, title), sub ? h('div', { class: 'sub' }, sub) : null));
  }

  private panelHome(): HTMLElement {
    const g = this.game!;
    const s = g.s;
    const ph = phaseOf(s.hour);
    const greet = { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening', night: 'Late night' }[ph];
    const active = MISSIONS.filter((m) => s.missions[m.id] === 'active');
    return h('div', { class: 'panel-inner' },
      this.header(`${greet}, ${s.playerName}`, `Day ${s.day} of ${LAST_DAY} · ${DAY_END - s.hour}h left today`, false),
      h('div', { class: 'card hints' }, h('h3', {}, 'What now?'), h('ul', {}, ...hints(g).map((t) => h('li', {}, t)))),
      h('div', { class: 'card' }, h('h3', {}, 'Active missions'),
        active.length
          ? h('ul', { class: 'mini-missions' }, ...active.slice(0, 5).map((m) => {
            const next = m.objectives.find((o) => !o.done(s));
            const prog = next?.progress?.(s);
            return h('li', {}, h('button', { class: 'linkish', type: 'button', onclick: () => this.setPanel('missions') }, h('strong', {}, m.title)),
              next ? h('div', { class: 'sub' }, '→ ' + next.text + (prog ? ` (${typeof prog[0] === 'number' && prog[1] > 1000 ? naira(prog[0]) + ' / ' + naira(prog[1]) : prog[0] + '/' + prog[1]})` : '')) : null);
          }))
          : h('p', { class: 'sub' }, 'No active missions. Explore the compound!')),
      h('p', { class: 'tip' }, 'Tap a resident or a place in the compound. Everything you do takes time; the day ends at 10pm.'),
    );
  }

  private panelNpc(m: Extract<PanelMode, { kind: 'npc' }>): HTMLElement {
    const g = this.game!;
    const s = g.s;
    const npc = NPCS[m.id];
    const where = g.npcWhere(m.id);
    const tier = trustTier(s.trust[m.id]);
    const knows = flag(s, 'know_' + m.id);
    const status = where.status === 'here' ? 'In the compound' : where.status === 'inside' ? `Inside (${npc.room})` : 'Out of the compound';
    const box = h('div', { class: 'panel-inner' },
      h('div', { class: 'npc-head' },
        h('button', { class: 'back', type: 'button', 'aria-label': 'Back to Today', onclick: () => { this.scene.selected = null; this.setPanel('home'); } }, '←'),
        this.portrait(m.id, 64),
        h('div', { class: 'npc-id' }, h('h2', {}, npc.name), h('div', { class: 'sub' }, `${npc.role} · ${status}`),
          h('div', { class: 'trust t-' + tier, title: `Trust ${s.trust[m.id]}/100` }, icon('heart'),
            h('div', { class: 'trustbar' }, h('span', { style: `width:${s.trust[m.id]}%` })), h('span', {}, `${s.trust[m.id]} · ${tier}`)))),
      h('div', { class: 'cares' + (knows ? '' : ' unknown') }, knows ? '💡 ' + npc.caresAbout : '💡 Cares about: ??? — chat with them, or ask Aunty Kemi for gist.'),
    );
    if (m.blocked && !m.lines.length) box.append(h('p', { class: 'sub walking' }, where.status === 'inside' ? 'Walking to their door…' : 'Walking over…'));
    if (m.lines.length) box.append(renderLines(m.lines, { npc: m.id, player: s.playerName, translations: this.settings.translations }));
    const acts = h('div', { class: 'actions' });
    if (m.choices) {
      m.choices.forEach((c, i) => acts.append(choiceButton({
        label: c.label, plain: this.settings.translations ? c.plain : undefined, hint: c.hint, disabled: c.disabled,
        onClick: () => {
          const reply = g.chooseTopic(m.topicId!, i);
          this.panel = { ...m, lines: [{ who: 'you', text: c.label.replace(/^"|"$/g, '') }, ...reply], choices: null, topicId: null };
          void this.pump();
        },
      }, i + 1, () => {})));
    } else if (!m.blocked) {
      const topics = g.topics(m.id);
      topics.forEach((t, i) => {
        const hint = [t.time && t.time !== 0.5 ? `${t.time}h` : '30m', describeEffects(t.effects).replace(/^\d+h · |^30m · /, '')].filter(Boolean).join(' · ');
        acts.append(choiceButton({
          label: (TOPIC_TAG[t.kind] ?? '') + t.label, hint,
          onClick: () => {
            const r = g.runTopic(t.id);
            if (r.error) { this.toast('Not now', r.error, 'info'); return; }
            this.panel = { ...m, lines: r.lines, choices: r.choices.length ? r.choices : null, topicId: r.choices.length ? t.id : null };
            void this.pump();
          },
        }, i + 1, () => {}));
      });
      if (!topics.length) acts.append(h('p', { class: 'sub' }, 'Nothing new to talk about right now. Come back tomorrow.'));
    }
    box.append(acts);
    return box;
  }

  private panelObj(m: Extract<PanelMode, { kind: 'obj' }>): HTMLElement {
    const g = this.game!;
    const o = OBJECTS[m.id];
    const box = h('div', { class: 'panel-inner' }, this.header(o.name), h('p', { class: 'desc' }, o.describe(g.s)));
    if (m.result) box.append(h('div', { class: 'result-card' + (m.ok ? '' : ' bad') }, m.result));
    const acts = h('div', { class: 'actions' });
    g.actions(m.id).forEach((a, i) => {
      const block = a.blocked?.(g.s) ?? (g.s.hour + a.time > DAY_END ? 'Not enough time today' : null);
      const parts = [a.time ? (a.time >= 1 ? `${a.time}h` : '30m') : '', describeEffects(a.effects)].filter(Boolean);
      acts.append(choiceButton({
        label: a.label(g.s), hint: parts.join(' · '), disabled: block,
        onClick: () => {
          if (a.ui === 'bills') return this.setPanel('bills');
          if (a.ui === 'missions') return this.setPanel('missions');
          if (a.ui === 'sleep') return this.requestSleep();
          const r = g.doAction(a.id);
          if (a.id === 'genon' && r.ok) sfx.gen();
          this.panel = { kind: 'obj', id: m.id, result: r.text, ok: r.ok };
          void this.pump();
        },
      }, i + 1, () => {}));
    });
    if (!g.actions(m.id).length) acts.append(h('p', { class: 'sub' }, 'Nothing to do here right now.'));
    box.append(acts);
    return box;
  }

  private panelMissions(): HTMLElement {
    const s = this.game!.s;
    const box = h('div', { class: 'panel-inner' }, this.header('Missions', `${MISSIONS.filter((m) => s.missions[m.id] === 'done').length} of ${MISSIONS.length} complete`));
    const groups: Array<['active' | 'done' | 'failed', string]> = [['active', 'Active'], ['done', 'Completed'], ['failed', 'Failed']];
    for (const [st, label] of groups) {
      const list = MISSIONS.filter((m) => s.missions[m.id] === st);
      if (!list.length) continue;
      box.append(h('h3', { class: 'group' }, label));
      for (const m of list) {
        box.append(h('div', { class: 'mission m-' + st },
          h('div', { class: 'm-title' }, m.giver !== 'compound' ? this.portrait(m.giver, 28) : null, h('strong', {}, m.title)),
          st === 'active' ? h('p', { class: 'sub' }, m.blurb) : null,
          st === 'active' ? h('ul', { class: 'objectives' }, ...m.objectives.map((o) => {
            const d = o.done(s);
            const pr = o.progress?.(s);
            return h('li', { class: d ? 'done' : '' }, d ? '✓ ' : '○ ', o.text,
              pr && !d ? h('div', { class: 'progress' }, h('span', { style: `width:${Math.min(100, (pr[0] / pr[1]) * 100)}%` })) : null);
          })) : null,
          st === 'active' ? h('div', { class: 'reward' }, '🎁 ' + m.rewardText) : st === 'failed' ? h('div', { class: 'sub' }, m.failText ?? '') : null,
        ));
      }
    }
    return box;
  }

  private panelBills(): HTMLElement {
    const g = this.game!;
    const s = g.s;
    const box = h('div', { class: 'panel-inner' }, this.header('Shared bills', 'Every flat pays its share. Chief (landlord) is exempt.'));
    if (!s.bills.length) box.append(h('p', { class: 'sub' }, 'No bills yet. Enjoy it while it lasts.'));
    const order = { overdue: 0, open: 1, settled: 2 } as const;
    for (const b of [...s.bills].sort((a, c) => order[a.status] - order[c.status])) {
      const rows = PAYERS.map((who) => {
        const paid = b.paid[who];
        return h('div', { class: 'payer' + (paid ? ' paid' : '') },
          who === 'you' ? this.portrait('you', 26) : this.portrait(who as NpcId, 26),
          h('span', { class: 'pname' }, payerName(s, who)),
          h('span', { class: 'pstat' }, paid ? '✓ Paid' : '✗ Owing'),
          !paid && b.status !== 'settled'
            ? h('button', { class: 'mini' + (who === 'you' ? ' primary' : ''), type: 'button', disabled: s.stats.cash < b.perFlat,
              title: s.stats.cash < b.perFlat ? 'Not enough cash' : undefined,
              onclick: () => { if (payShare(s, b.id, who)) { sfx.spend(); g.checkMissions(); void this.pump(); } } },
              who === 'you' ? `Pay ${naira(b.perFlat)}` : `Cover ${naira(b.perFlat)}`)
            : null);
      });
      box.append(h('div', { class: 'bill b-' + b.status },
        h('div', { class: 'bill-head' }, h('strong', {}, b.name), h('span', { class: 'pill' }, b.status === 'settled' ? 'Settled' : b.status === 'overdue' ? 'OVERDUE' : `Due end of Day ${b.dueDay}`)),
        h('div', { class: 'sub' }, `${naira(b.perFlat)} per flat · ${Object.values(b.paid).filter(Boolean).length}/${PAYERS.length} paid`),
        h('div', { class: 'payers' }, ...rows)));
    }
    if (getBill(s, 'nepa')?.status === 'overdue') box.append(h('p', { class: 'tip bad' }, 'The compound is disconnected until every NEPA share is paid. Covering a neighbour earns trust and reputation.'));
    box.append(h('p', { class: 'tip' }, 'Residents pay on their own schedule: Amaka early, Kemi and Bisi near the deadline, Tobi only if he trusts you, Femi... only with a push.'));
    return box;
  }

  private panelLog(): HTMLElement {
    const s = this.game!.s;
    const entries = s.log.filter((l) => l.day === s.day).slice().reverse();
    return h('div', { class: 'panel-inner' }, this.header('Compound log', `Day ${s.day}`),
      h('ul', { class: 'log' }, ...entries.map((l) => h('li', { class: 'k-' + l.kind }, h('span', { class: 'when' }, fmtHour(l.hour)), l.text))));
  }

  // ───────────────────────── Keyboard ─────────────────────────

  private onKey(e: KeyboardEvent): void {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    trapFocus(e);
    const top = topModal();
    if (top) {
      if (e.key === 'Escape') closeTopModal();
      if (/^[1-9]$/.test(e.key)) (top.el.querySelector(`button[data-key="${e.key}"]:not([disabled])`) as HTMLButtonElement | null)?.click();
      return;
    }
    if (!this.game || $('#screen-game').hidden) return;
    if (/^[1-9]$/.test(e.key)) {
      (document.querySelector(`#panel button[data-key="${e.key}"]:not([disabled])`) as HTMLButtonElement | null)?.click();
      return;
    }
    const k = e.key.toLowerCase();
    if (k === 'escape') { if (this.panel.kind !== 'home') this.setPanel('home'); else openPauseMenu(this); }
    else if (k === 'm') this.setPanel('missions');
    else if (k === 'b') this.setPanel('bills');
    else if (k === 'l') this.setPanel('log');
    else if (k === 't') this.setPanel('home');
    else if (k === 'p') openPauseMenu(this);
  }
}

const STAT_ICON: Record<StatKey, IconKey> = { cash: 'cash', happiness: 'happiness', reputation: 'reputation', fuel: 'fuel', water: 'water', condition: 'condition' };
const STAT_HELP: Record<StatKey, string> = {
  cash: 'Your money (in-game naira). Earn it with jobs.',
  happiness: 'Your mood. Below 30, jobs pay less.',
  reputation: 'How the compound sees you. Makes persuasion stronger and goodwill stick.',
  fuel: 'Litres in the shared generator. Burns 1L per hour.',
  water: 'Overhead tank level. Pumping needs power.',
  condition: 'How clean and well-kept the compound is.',
};
/** Where you stand to knock on each resident's door. */
const DOOR_STAND: Record<NpcId, { x: number; y: number }> = {
  chief: { x: 478, y: 520 }, kemi: { x: 626, y: 520 }, amaka: { x: 420, y: 520 },
  femi: { x: 556, y: 520 }, bisi: { x: 848, y: 520 }, tobi: { x: 890, y: 520 },
};
const PORTRAIT_BG: Record<NpcId, string> = { chief: '#f7d9d0', kemi: '#ead7f5', amaka: '#d5f1ee', femi: '#ffe1cf', bisi: '#d9f2df', tobi: '#ffd9e6' };
const TOPIC_TAG: Record<string, string> = { intro: '👋 ', mission: '❗ ', info: '💡 ', chat: '💬 ', service: '✂️ ' };


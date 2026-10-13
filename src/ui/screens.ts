import { sfx } from '../audio/sfx.ts';
import { playMusic } from '../audio/music.ts';
import { MISSIONS } from '../data/missions.ts';
import { MOTIONS } from '../data/meetings.ts';
import { NPCS, PLAYER_LOOKS } from '../data/npcs.ts';
import { finalResults, Game } from '../engine/game.ts';
import { deleteSave, loadGame, saveInfo, storageAvailable, type Settings } from '../engine/save.ts';
import { naira, trustTier } from '../engine/state.ts';
import { drawPerson, drawPortrait } from '../render/people.ts';
import { bodyImg, drawFace, drawSprite, type CharKey } from '../render/sprites.ts';
import { NPC_IDS } from '../types.ts';
import type { GameState } from '../types.ts';
import type { App } from './app.ts';
import { $, clear, h } from './dom.ts';
import { confirmDialog, openModal } from './modal.ts';

// ───────────────────────── Title ─────────────────────────

export function showTitle(app: App): void {
  const el = $('#screen-title');
  $('#screen-game').hidden = true;
  $('#screen-results').hidden = true;
  el.hidden = false;
  playMusic('title');
  clear(el);
  const info = saveInfo();
  const art = h('canvas', { class: 'title-art', width: 1200, height: 420, 'aria-hidden': 'true' });
  const canContinue = info && !info.ended;
  el.append(
    h('div', { class: 'title-wrap' },
      art,
      h('h1', { class: 'logo' }, h('span', { class: 'l1' }, 'COMPOUND'), h('span', { class: 'l2' }, 'WAHALA')),
      h('p', { class: 'subtitle' }, 'Naija Neighbourhood Wars'),
      h('p', { class: 'tagline' }, 'Six flats. One generator. Everybody has a secret, and nobody wants to pay their share.'),
      h('div', { class: 'title-btns' },
        canContinue ? h('button', { class: 'big primary', type: 'button', id: 'btn-continue', onclick: () => continueGame(app) }, `Continue — Day ${info!.day} (${info!.name})`) : null,
        h('button', { class: 'big' + (canContinue ? '' : ' primary'), type: 'button', id: 'btn-new', onclick: () => newGameFlow(app) }, 'New Game'),
        h('button', { class: 'big ghost', type: 'button', onclick: () => howToPlay() }, 'How to Play'),
        h('button', { class: 'big ghost', type: 'button', onclick: () => settingsModal(app) }, 'Settings'),
      ),
      !storageAvailable() ? h('p', { class: 'warn-note' }, 'Your browser is blocking storage, so progress cannot be saved in this window.') : null,
      h('p', { class: 'fineprint' }, 'All characters are fictional. In-game naira only — no real money, ads or data collection. A week is about 10–15 minutes.'),
    ),
  );
  let t = 0;
  const draw = () => {
    if (el.hidden) return;
    const ctx = art.getContext('2d')!;
    ctx.clearRect(0, 0, art.width, art.height);
    const order = ['amaka', 'femi', 'chief', 'kemi', 'tobi', 'bisi'] as const;
    order.forEach((id, i) => {
      const x = 170 + i * 172;
      const img = bodyImg(id);
      if (img) drawSprite(ctx, img, x, 410 - (i % 2) * 10, { t: t + i, height: 390 * NPCS[id].look.height, dance: id === 'tobi' });
      else drawPerson(ctx, x, 400 - (i % 2) * 12, 2.15, NPCS[id].look, { t: t + i, dance: id === 'tobi', wave: id === 'kemi', talking: id === 'chief' && Math.sin(t) > 0 });
    });
    t += 0.016;
    requestAnimationFrame(draw);
  };
  if (!app.settings.reduceMotion) requestAnimationFrame(draw);
  else { t = 1; draw(); }
  (el.querySelector('#btn-continue, #btn-new') as HTMLElement | null)?.focus();
}

function continueGame(app: App): void {
  const s = loadGame();
  if (!s) {
    app.toast('No save found', 'Starting fresh.', 'info');
    newGameFlow(app);
    return;
  }
  sfx.good();
  app.start(new Game(s));
}

async function newGameFlow(app: App): Promise<void> {
  const info = saveInfo();
  if (info && !info.ended) {
    const ok = await confirmDialog('Start a new game?', `This will erase your saved game (${info.name}, Day ${info.day}). This cannot be undone.`, 'Erase and start new', true);
    if (!ok) return;
  }
  let look = 0;
  const input = h('input', { id: 'name-input', type: 'text', maxlength: 18, value: 'Ade', autocomplete: 'off', 'aria-label': 'Your name' }) as HTMLInputElement;
  const looks = h('div', { class: 'looks', role: 'radiogroup', 'aria-label': 'Choose your look' });
  const renderLooks = () => {
    clear(looks);
    PLAYER_LOOKS.forEach((l, i) => {
      const c = h('canvas', { width: 120, height: 120, style: 'width:60px;height:60px', 'aria-hidden': 'true' });
      if (!drawFace(c, `player${i}` as CharKey)) drawPortrait(c, l, '#d6ecff');
      looks.append(h('button', { class: 'look' + (i === look ? ' active' : ''), type: 'button', role: 'radio', 'aria-checked': String(i === look), 'aria-label': `Look ${i + 1}`, onclick: () => { look = i; renderLooks(); } }, c));
    });
  };
  renderLooks();
  openModal({
    title: 'Welcome to Unity Compound',
    kicker: '7 Adebayo Close',
    dismissable: true,
    body: [
      h('p', {}, "You've just rented Room 4. You fix phones for a living, you have ₦8,000 to your name, and you have one week to find your place in the compound."),
      h('label', { for: 'name-input', class: 'field-label' }, 'What do your neighbours call you?'),
      input,
      h('div', { class: 'field-label' }, 'Choose your look'),
      looks,
    ],
    actions: [{
      label: 'Move in!', primary: true,
      onClick: () => {
        deleteSave();
        const g = Game.create(input.value || 'Ade');
        g.s.counters['look'] = look;
        sfx.good();
        app.start(g);
      },
    }],
  });
  setTimeout(() => { input.focus(); input.select(); }, 30);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') (document.querySelector('.modal .choice.primary') as HTMLButtonElement | null)?.click(); });
}

// ───────────────────────── Help / Settings / Pause ─────────────────────────

export function howToPlay(): void {
  openModal({
    title: 'How to play',
    dismissable: true,
    className: 'help-modal',
    body: [
      h('h3', {}, 'The goal'),
      h('p', {}, 'Survive one week in Unity Compound: keep money in your pocket, light in the sockets, water in the tank — and win your neighbours over.'),
      h('h3', {}, 'Each day'),
      h('ul', {},
        h('li', {}, 'Tap residents to talk, or places (gate, kiosk, generator, tank, meter...) to act. The residents bar and places bar at the bottom do the same.'),
        h('li', {}, 'Time only moves when you act: chats take 30 minutes, jobs take hours. The day ends at 10pm or when you sleep.'),
        h('li', {}, 'Events pop up — power cuts, missing laundry, goats. Every choice shows its cost and effect.'),
        h('li', {}, 'Orange ! markers point to people and places with something for you.')),
      h('h3', {}, 'Compound meetings'),
      h('p', {}, 'Some evenings Chief calls a meeting. Pick a side, then use your moves: persuade with arguments that match what people care about, cover their share, amend the motion, or call in Aunty Kemi. Every vote is explained — no dice rolls.'),
      h('h3', {}, 'Controls'),
      h('ul', {},
        h('li', {}, 'Mouse or touch: tap anything.'),
        h('li', {}, 'Keyboard: 1–9 pick a choice · M missions · B bills · L log · T today · Esc back / pause.')),
      h('h3', {}, 'Pidgin'),
      h('p', {}, 'Some lines use Nigerian Pidgin or slang. Plain-English versions appear underneath — switch them off in Settings once you are fluent.'),
    ],
    actions: [{ label: 'Got it', primary: true, onClick: () => {} }],
  });
}

export function settingsModal(app: App): void {
  const st = app.settings;
  const body = h('div', { class: 'settings' });
  const render = () => {
    clear(body);
    const toggle = (key: keyof Settings, label: string, help: string) =>
      h('button', { class: 'toggle', type: 'button', role: 'switch', 'aria-checked': String(!!st[key]),
        onclick: () => { (st as unknown as Record<string, boolean>)[key] = !st[key]; app.applySettings(); render(); } },
        h('span', { class: 'tlabel' }, label, h('small', {}, help)), h('span', { class: 'knob' }, st[key] ? 'On' : 'Off'));
    body.append(
      h('div', { class: 'field-label' }, 'Text size'),
      h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Text size' },
        ...(['small', 'normal', 'large', 'xl'] as const).map((sz) =>
          h('button', { type: 'button', role: 'radio', 'aria-checked': String(st.textSize === sz), class: st.textSize === sz ? 'active' : '',
            onclick: () => { st.textSize = sz; app.applySettings(); render(); } }, { small: 'A−', normal: 'A', large: 'A+', xl: 'A++' }[sz]))),
      toggle('music', 'Music', 'Original Afrobeats, highlife and Afro-jazz soundtrack.'),
      h('div', { class: 'seg', role: 'radiogroup', 'aria-label': 'Music volume' },
        ...([['Quiet', 0.25], ['Medium', 0.5], ['Loud', 0.85]] as const).map(([label, v]) =>
          h('button', { type: 'button', role: 'radio', 'aria-checked': String(st.musicVolume === v), class: st.musicVolume === v ? 'active' : '', disabled: !st.music,
            onclick: () => { st.musicVolume = v; app.applySettings(); render(); } }, label))),
      toggle('sound', 'Sound effects', 'The game is fully playable without sound.'),
      toggle('translations', 'Plain-English translations', 'Shows plain English under Pidgin and slang.'),
      toggle('labels', 'Place & name labels', 'Labels over people and objects in the compound.'),
      toggle('reduceMotion', 'Reduce motion', 'Fewer animations, instant walking.'),
    );
  };
  render();
  openModal({ title: 'Settings', dismissable: true, body, actions: [{ label: 'Done', primary: true, onClick: () => {} }] });
}

export function openPauseMenu(app: App): void {
  if (!app.game) return;
  openModal({
    title: 'Paused',
    kicker: `Day ${app.game.s.day} · ${app.game.s.playerName}`,
    dismissable: true,
    actions: [
      { label: 'Resume', primary: true, onClick: () => {} },
      { label: 'Settings', onClick: () => { setTimeout(() => settingsModal(app), 0); } },
      { label: 'How to play', onClick: () => { setTimeout(() => howToPlay(), 0); } },
      { label: 'Replay the tutorial', onClick: () => { setTimeout(() => void runTutorial(app), 0); } },
      { label: 'Save and quit to title', onClick: () => app.quitToTitle() },
      {
        label: 'Restart the week', danger: true,
        onClick: () => {
          setTimeout(async () => {
            const ok = await confirmDialog('Restart from Day 1?', 'Your current progress will be erased. This cannot be undone.', 'Erase and restart', true);
            if (!ok || !app.game) return;
            const name = app.game.s.playerName;
            const look = app.game.s.counters['look'] ?? 0;
            deleteSave();
            const g = Game.create(name);
            g.s.counters['look'] = look;
            app.start(g);
          }, 0);
        },
      },
    ],
  });
}

// ───────────────────────── Tutorial ─────────────────────────

interface Step { target: () => DOMRect | null; title: string; text: string }

export function runTutorial(app: App): Promise<void> {
  const canvasPoint = (x: number, y: number, w: number, hgt: number) => () => {
    const r = $('#scene').getBoundingClientRect();
    const a = app.scene.toScreen(x - w / 2, y - hgt);
    const b = app.scene.toScreen(x + w / 2, y);
    return new DOMRect(r.left + a.x, r.top + a.y, b.x - a.x, b.y - a.y);
  };
  const el = (sel: string) => () => (document.querySelector(sel) as HTMLElement | null)?.getBoundingClientRect() ?? null;
  const kemi = app.scene.npcPos('kemi') ?? { x: 500, y: 572 };
  const steps: Step[] = [
    { target: el('#hud-stats'), title: 'Your stats', text: 'Cash (₦), Mood, Reputation, generator Fuel, the Water tank and the Compound\'s condition. Watch them move as you play.' },
    { target: canvasPoint(kemi.x, kemi.y + 8, 110, 175), title: 'Talk to people', text: 'Tap a resident to walk over and talk. Aunty Kemi is waving — she knows everybody\'s business. Orange ! markers mean someone has something for you.' },
    { target: el('#dock-residents'), title: 'Residents bar', text: 'You can also reach residents here. A grey dot means they are inside their room (knocking may annoy them); faded means they are out.' },
    { target: el('#dock-places'), title: 'Places', text: 'Jump to the gate, kiosk, generator, water tank, meter and more. Your room is where you work and sleep.' },
    { target: el('.clock'), title: 'Time', text: 'Time only moves when you act. Chats take 30 minutes; jobs take hours. The day ends at 10pm — or when you choose to sleep.' },
    { target: el('#btn-missions'), title: 'Missions', text: 'Your goals live here, with progress and rewards. Start with "New Kid on the Block": greet everyone.' },
  ];
  return new Promise((resolve) => {
    let i = 0;
    const spot = h('div', { class: 'coach-spot', 'aria-hidden': 'true' });
    const m = openModal({ title: '', className: 'coach-modal', body: [] });
    m.el.classList.add('coach-backdrop');
    m.el.prepend(spot);
    const show = () => {
      const st = steps[i];
      (m.el.querySelector('.modal-title') as HTMLElement).textContent = `${st.title} (${i + 1}/${steps.length})`;
      m.setBody(h('p', {}, st.text));
      m.setActions([
        { label: i === steps.length - 1 ? 'Start playing!' : 'Next', primary: true, onClick: () => { i++; if (i >= steps.length) { m.close(); resolve(); } else show(); return false; } },
        { label: 'Skip tutorial', onClick: () => { m.close(); resolve(); return false; } },
      ], false);
      const r = st.target();
      const card = m.el.querySelector('.modal') as HTMLElement;
      if (r && r.width > 0) {
        const pad = 6;
        Object.assign(spot.style, { display: 'block', left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + pad * 2}px`, height: `${r.height + pad * 2}px` });
        const below = r.top + r.height / 2 < window.innerHeight / 2;
        card.style.top = below ? `${Math.min(window.innerHeight - 220, r.bottom + 14)}px` : '';
        card.style.bottom = below ? '' : `${Math.min(window.innerHeight - 220, window.innerHeight - r.top + 14)}px`;
      } else {
        spot.style.display = 'none';
        card.style.top = '30%';
        card.style.bottom = '';
      }
    };
    show();
  });
}

// ───────────────────────── Results ─────────────────────────

export function showResults(app: App, s: GameState): void {
  $('#screen-game').hidden = true;
  const el = $('#screen-results');
  el.hidden = false;
  playMusic('title');
  clear(el);
  const r = finalResults(s);
  const portrait = (id: (typeof NPC_IDS)[number]) => {
    const c = h('canvas', { width: 96, height: 96, style: 'width:48px;height:48px', 'aria-hidden': 'true' });
    if (!drawFace(c, id)) drawPortrait(c, NPCS[id].look);
    return c;
  };
  const meetings = MOTIONS.map((m) => ({ m, rec: s.meetings[m.id] }));
  const shareText = `COMPOUND WAHALA — ${s.playerName} finished the week as "${r.title}" (score ${r.score}). Cash ${naira(s.stats.cash)}, reputation ${Math.round(s.stats.reputation)}, ${r.done.length}/${MISSIONS.length} missions.`;
  el.append(h('div', { class: 'results-wrap' },
    h('div', { class: 'res-hero' },
      h('div', { class: 'kicker' }, 'One week in Unity Compound'),
      h('h1', {}, r.title),
      h('p', {}, r.blurb),
      h('div', { class: 'score' }, 'Score ', h('b', {}, String(r.score)))),
    h('div', { class: 'res-grid' },
      h('div', { class: 'card' }, h('h3', {}, 'Your week'),
        h('dl', { class: 'facts' },
          h('dt', {}, 'Cash'), h('dd', {}, naira(s.stats.cash)),
          h('dt', {}, 'Total earned'), h('dd', {}, naira(s.earnedTotal)),
          h('dt', {}, 'Reputation'), h('dd', {}, `${Math.round(s.stats.reputation)}/100`),
          h('dt', {}, 'Mood'), h('dd', {}, `${Math.round(s.stats.happiness)}/100`),
          h('dt', {}, 'Compound condition'), h('dd', {}, `${Math.round(s.stats.condition)}/100`),
          h('dt', {}, 'Meetings won'), h('dd', {}, `${r.wins}/${Object.keys(s.meetings).length}`))),
      h('div', { class: 'card' }, h('h3', {}, 'Relationships'),
        ...NPC_IDS.map((id) => h('div', { class: 'rel' }, portrait(id), h('div', { class: 'rel-body' }, h('strong', {}, NPCS[id].short),
          h('div', { class: 'trustbar' }, h('span', { style: `width:${s.trust[id]}%` })), h('span', { class: 'sub' }, `${s.trust[id]} · ${trustTier(s.trust[id])}`))))),
      h('div', { class: 'card' }, h('h3', {}, `Missions (${r.done.length}/${MISSIONS.length})`),
        h('ul', { class: 'res-missions' }, ...MISSIONS.map((m) => {
          const st = s.missions[m.id] ?? 'locked';
          return h('li', { class: 's-' + st }, st === 'done' ? '✓ ' : st === 'failed' ? '✗ ' : '○ ', m.title);
        }))),
      h('div', { class: 'card' }, h('h3', {}, 'Compound meetings'),
        h('ul', { class: 'res-missions' }, ...meetings.map(({ m, rec }) =>
          h('li', { class: rec ? (rec.passed ? 's-done' : 's-failed') : '' }, `${m.title}: `, rec ? `${rec.passed ? 'passed' : 'failed'} ${rec.yes}–${rec.no}${rec.playerSide === 'none' ? ' (you walked out)' : ` (you voted ${rec.playerSide})`}` : 'not held')))),
    ),
    h('div', { class: 'title-btns' },
      h('button', { class: 'big primary', type: 'button', onclick: () => { deleteSave(); newGameFlow(app); } }, 'Play another week'),
      h('button', { class: 'big', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(shareText); app.toast('Copied!', 'Paste it to your group chat.', 'info'); } catch { app.toast('Copy failed', shareText, 'info'); } } }, 'Copy my results'),
      h('button', { class: 'big ghost', type: 'button', onclick: () => showTitle(app) }, 'Title screen'),
    ),
  ));
  sfx.mission();
}

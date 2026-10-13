import { sfx } from '../audio/sfx.ts';
import { playMusic, sting } from '../audio/music.ts';
import { motionById, VALUE_LABEL } from '../data/meetings.ts';
import { NPCS } from '../data/npcs.ts';
import type { Game } from '../engine/game.ts';
import {
  amend, chooseSide, computeLean, kemiRally, leanLabel, persuade, pledgeShare, resolveMeeting, startMeeting, tally, termsOf, walkOut,
} from '../engine/meeting.ts';
import { flag, naira } from '../engine/state.ts';
import { NPC_IDS } from '../types.ts';
import type { NpcId, ValueKey } from '../types.ts';
import type { App } from './app.ts';
import { h } from './dom.ts';
import { renderLines } from './lines.ts';
import { openModal, type ModalHandle } from './modal.ts';

export function runMeetingUI(app: App, g: Game): Promise<void> {
  return new Promise((resolve) => {
    const s = g.s;
    const motion = motionById(s.meetingPending!);
    const session = startMeeting(s, motion.id);
    let openArgs: NpcId | null = null;
    let lastNote = '';
    sfx.gavel();
    playMusic('meeting');

    const m: ModalHandle = openModal({
      kicker: `Compound Meeting · Day ${s.day} · 6pm`,
      title: `"${motion.title}"`,
      className: 'meeting-modal',
      body: [
        h('p', { class: 'problem' }, motion.problem),
        renderLines(motion.intro, { player: s.playerName, translations: app.settings.translations }),
      ],
      actions: [{ label: 'Hear the motion', primary: true, onClick: () => { showMotion(); return false; } }],
    });

    function motionCard(): HTMLElement {
      const t = termsOf(motion, session);
      return h('div', { class: 'motion-card' + (session.amended ? ' amended' : '') },
        h('div', { class: 'motion-label' }, session.amended ? 'AMENDED MOTION' : 'THE MOTION'),
        h('p', {}, t.summary),
        t.costPerFlat ? h('div', { class: 'cost' }, `Cost to each flat: ${naira(t.costPerFlat)}`) : h('div', { class: 'cost' }, 'No money involved — but feelings are.'),
      );
    }

    function showMotion() {
      m.setBody([
        motionCard(),
        h('p', { class: 'sub' }, 'Everyone votes yes or no. Each resident\'s vote depends on what they care about, what it costs them, how much they trust you, and how earlier meetings went. Nothing is random.'),
        h('h3', {}, 'Where do you stand?'),
      ]);
      m.setActions([
        { label: 'Support the motion', hint: 'Vote YES and lobby for it', primary: true, onClick: () => { chooseSide(session, 'yes'); lobby(); return false; } },
        { label: 'Oppose the motion', hint: 'Vote NO and lobby against it', onClick: () => { chooseSide(session, 'no'); lobby(); return false; } },
        { label: 'Refuse to take part', hint: 'Walk out. No vote, no lobbying. Rep −4', danger: true, onClick: () => { walkOut(s, session); vote(); return false; } },
      ], true);
    }

    function argStrength(id: NpcId, v: ValueKey): { label: string; cls: string } {
      if (!flag(s, 'know_' + id)) return { label: '?', cls: 'unknown' };
      const val = NPCS[id].values[v];
      if (val >= 2) return { label: 'Strong', cls: 'strong' };
      if (val === 1) return { label: 'Some', cls: 'some' };
      if (val === 0) return { label: 'No effect', cls: 'none' };
      return { label: 'Backfires', cls: 'backfire' };
    }

    function residentCard(id: NpcId): HTMLElement {
      const l = computeLean(s, session, id);
      const knows = flag(s, 'know_' + id);
      const clamped = Math.max(-50, Math.min(50, l.total));
      const fillStyle = clamped >= 0 ? `left:50%;width:${clamped}%` : `left:${50 + clamped}%;width:${-clamped}%`;
      const t = termsOf(motion, session);
      const card = h('div', { class: `rcard ${l.vote}` },
        h('div', { class: 'rhead' }, app.portrait(id, 40), h('div', {}, h('strong', {}, NPCS[id].short), h('div', { class: 'sub' }, knows ? 'Cares: ' + topValues(id) : 'Cares: ???'))),
        h('div', { class: 'lean', role: 'img', 'aria-label': `${NPCS[id].short}: ${leanLabel(l.total)} (${l.total})` },
          h('span', { class: 'mid' }), h('span', { class: 'fill ' + l.vote, style: fillStyle })),
        h('div', { class: 'lean-label ' + l.vote }, `${leanLabel(l.total)} (${l.total > 0 ? '+' : ''}${l.total})`),
        h('details', { class: 'why' }, h('summary', {}, 'Why?'),
          h('ul', {}, ...l.parts.map((p) => h('li', {}, h('span', {}, p.label), h('b', { class: p.value > 0 ? 'up' : p.value < 0 ? 'down' : '' }, (p.value > 0 ? '+' : '') + p.value))))),
      );
      if (session.side !== 'none' && session.movesLeft > 0) {
        const row = h('div', { class: 'rbtns' });
        row.append(h('button', { class: 'mini', type: 'button', 'aria-expanded': String(openArgs === id), onclick: () => { openArgs = openArgs === id ? null : id; lobby(); } }, 'Persuade'));
        if (session.side === 'yes' && id !== 'chief' && t.costPerFlat > 0 && !session.pledged.includes(id)) {
          row.append(h('button', { class: 'mini', type: 'button', onclick: () => { const r = pledgeShare(s, session, id); lastNote = r.text; if (r.ok) sfx.coin(); lobby(); } }, `Cover share (${naira(t.costPerFlat)})`));
        }
        card.append(row);
        if (openArgs === id) {
          const args = session.side === 'yes' ? motion.args.yes : motion.args.no;
          const tried = session.tried[id] ?? [];
          card.append(h('div', { class: 'args' }, ...args.map((a) => {
            const st = argStrength(id, a.value);
            return h('button', { class: 'arg', type: 'button', disabled: tried.includes(a.value),
              onclick: () => { const r = persuade(s, session, id, a.value); lastNote = r.text; openArgs = null; sfx.click(); lobby(); } },
              h('span', { class: 'arg-val' }, VALUE_LABEL[a.value]), h('span', { class: 'arg-text' }, a.label), h('span', { class: 'arg-st ' + st.cls }, st.label));
          })));
        }
      }
      if (session.pledged.includes(id)) card.append(h('div', { class: 'pledged' }, '✓ You pledged their share'));
      return card;
    }

    function lobby() {
      const proj = tally(s, session);
      const unknown = NPC_IDS.filter((id) => !flag(s, 'know_' + id)).length;
      m.setBody([
        motionCard(),
        h('div', { class: 'lobby-bar' },
          h('div', { class: 'moves' }, `Your side: ${session.side === 'yes' ? 'YES' : 'NO'} · Moves left: `, h('b', {}, String(session.movesLeft))),
          h('div', { class: 'proj ' + (proj.passed ? 'yes' : 'no') }, `If voted now: ${proj.yes} Yes – ${proj.no} No → ${proj.passed ? 'PASSES' : 'FAILS'}${proj.tieBreak ? ' (Chief breaks the tie)' : ''}`)),
        lastNote ? h('div', { class: 'note' }, lastNote) : null,
        unknown ? h('p', { class: 'sub' }, `Tip: you don't know what ${unknown} resident(s) care about, so argument strength shows "?". Learn it by chatting or from Aunty Kemi's gist.`) : null,
        h('div', { class: 'rgrid' }, ...NPC_IDS.map(residentCard)),
      ].filter(Boolean) as Node[]);
      const acts: Parameters<ModalHandle['setActions']>[0] = [];
      if (!session.amended && session.movesLeft > 0)
        acts.push({ label: 'Propose amendment', hint: motion.amendment.label + ' (1 move)', disabled: session.pledged.length ? 'Amend before pledging money' : null,
          onClick: () => { lastNote = amend(s, session).text; lobby(); return false; } });
      if (!session.kemiRallied && session.movesLeft > 0)
        acts.push({ label: 'Ask Aunty Kemi to work the room', hint: 'Nudges everyone toward your side (1 move)', disabled: s.trust.kemi < 65 ? `Needs Kemi's trust 65+ (now ${s.trust.kemi})` : null,
          onClick: () => { lastNote = kemiRally(s, session).text; sfx.notify(); lobby(); return false; } });
      acts.push({ label: session.movesLeft > 0 ? 'Call the vote now' : 'Call the vote', primary: true, onClick: () => { vote(); return false; } });
      m.setActions(acts, false);
    }

    function vote() {
      const r = resolveMeeting(s, session);
      sfx.gavel();
      const chips = h('div', { class: 'votes' });
      const outcome = h('div', { class: 'outcome hidden' });
      m.setBody([motionCard(), h('h3', {}, 'The vote'), chips, outcome]);
      m.setActions([], false);
      const reveal = (i: number) => {
        if (i >= r.votes.length) {
          outcome.classList.remove('hidden');
          outcome.append(
            h('div', { class: 'banner ' + (r.passed ? 'pass' : 'fail') }, `${r.passed ? 'MOTION PASSED' : 'MOTION FAILED'} · ${r.yes}–${r.no}`),
            r.tieBreak ? h('p', { class: 'sub' }, 'Tied vote — Chief, as chairman, cast the deciding vote.') : '',
            session.side === 'none' ? h('p', { class: 'sub' }, 'You walked out, so you had no say. Reputation −4.') : h('p', { class: 'sub' }, (session.side === 'yes') === r.passed ? 'Your side won! Reputation and mood up.' : 'Your side lost this time. People remember who stood where.'),
            h('div', { class: 'result-card' }, r.summary),
          );
          if (session.side === 'none') sfx.bad();
          else sting((session.side === 'yes') === r.passed ? 'win' : 'lose');
          m.setActions([{ label: 'Continue', primary: true, onClick: () => resolve() }], false);
          return;
        }
        const v = r.votes[i];
        const who = v.who === 'you' ? s.playerName : NPCS[v.who].short;
        chips.append(h('div', { class: 'vchip ' + v.vote }, v.who === 'you' ? app.portrait('you', 34) : app.portrait(v.who as NpcId, 34), h('span', {}, who), h('b', {}, v.vote.toUpperCase())));
        sfx.vote(v.vote === 'yes');
        if (app.settings.reduceMotion) reveal(i + 1);
        else setTimeout(() => reveal(i + 1), 380);
      };
      reveal(0);
    }
  });
}

function topValues(id: NpcId): string {
  return Object.entries(NPCS[id].values)
    .filter(([, v]) => v >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => VALUE_LABEL[k as ValueKey])
    .join(', ');
}


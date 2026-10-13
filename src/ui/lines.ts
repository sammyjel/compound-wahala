import { NPCS } from '../data/npcs.ts';
import type { Line, NpcId } from '../types.ts';
import { h } from './dom.ts';

/** Render dialogue lines. `npc` resolves who:'npc'. */
export function renderLines(lines: Line[], opts: { npc?: NpcId; player: string; translations: boolean }): HTMLElement {
  const box = h('div', { class: 'lines' });
  lines.forEach((l, i) => {
    let speaker = '';
    let cls = 'line';
    if (l.who === 'narrator') cls += ' narrator';
    else if (l.who === 'you') { speaker = opts.player; cls += ' you'; }
    else {
      const id = (l.who === 'npc' ? opts.npc : l.who) as NpcId | undefined;
      speaker = id ? NPCS[id].short : '';
      if (id) cls += ' npc-' + id;
    }
    box.append(
      h(
        'div',
        { class: cls, style: `animation-delay:${Math.min(i, 6) * 90}ms` },
        speaker ? h('span', { class: 'speaker' }, speaker) : null,
        h('span', { class: 'say' }, l.text),
        l.plain && opts.translations ? h('span', { class: 'plain' }, 'Plain English: ' + l.plain) : null,
      ),
    );
  });
  return box;
}

import { getBill } from '../engine/bills.ts';
import type { Game } from '../engine/game.ts';
import { flag, hasPower } from '../engine/state.ts';
import { NPC_IDS } from '../types.ts';
import type { ObjId } from '../data/actions.ts';

/** Short "what should I do next?" suggestions, most urgent first. */
export function hints(g: Game): string[] {
  const s = g.s;
  const out: string[] = [];
  const nepa = getBill(s, 'nepa');
  const metCount = NPC_IDS.filter((id) => flag(s, 'met_' + id)).length;
  if (nepa?.status === 'overdue') out.push('The compound is disconnected! Pay the missing NEPA shares at the meter.');
  if (s.missions['m_light'] === 'active' && s.stats.fuel <= 0) out.push("No light! Buy fuel at Iya Bisi's kiosk by the gate.");
  if (s.missions['m_light'] === 'active' && s.stats.fuel > 0) out.push('You have fuel — start the generator on the right.');
  if (metCount < 6) out.push(`Greet your neighbours (${metCount}/6). Look for the orange ! markers.`);
  for (const b of s.bills) {
    if (b.status !== 'settled' && !b.paid.you) out.push(`Pay your ${b.name} share at the meter (₦${b.perFlat.toLocaleString()}, due end of Day ${b.dueDay}).`);
  }
  const motion = g.motionToday();
  if (motion) out.push(`Compound meeting at 6pm: "${motion.title}". Learn what people care about before then.`);
  if (s.stats.water < 30) out.push(hasPower(s) ? 'Water is low — pump it at the tank while there is power.' : 'Water is low. Pumping needs power; the water vendor needs cash.');
  if (s.stats.happiness < 30) out.push("You're stressed: jobs pay 25% less. Rest, eat, or chat with someone.");
  if (s.stats.cash < 2500) out.push('Cash is low. Do phone repairs at your door (Room 4) or run deliveries at the gate.');
  if (!out.length) out.push('Do phone repairs at your door to earn money, or check your missions.');
  return out.slice(0, 3);
}

/** Which NPCs/objects should show an orange "!" marker. */
export function markers(g: Game): Set<string> {
  const s = g.s;
  const set = new Set<string>();
  for (const id of NPC_IDS) {
    const w = g.npcWhere(id);
    if (w.status !== 'here') continue;
    if (g.topics(id).some((t) => t.kind === 'intro' || t.kind === 'mission')) set.add(id);
  }
  const objs: Array<[ObjId, boolean]> = [
    ['kiosk', (s.missions['m_light'] === 'active' && s.stats.fuel <= 0) || g.actions('kiosk').some((a) => a.id === 'earplugs')],
    ['generator', s.missions['m_light'] === 'active' && s.stats.fuel > 0],
    ['laundry', g.actions('laundry').some((a) => a.id === 'inspect_line')],
    ['door', g.actions('door').some((a) => a.id === 'radio')],
    ['meter', s.bills.some((b) => b.status !== 'settled' && !b.paid.you) || getBill(s, 'nepa')?.status === 'overdue'],
    ['tank', s.stats.water < 25],
  ];
  for (const [id, on] of objs) if (on) set.add(id);
  return set;
}

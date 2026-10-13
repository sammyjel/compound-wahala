import { NPCS } from '../data/npcs.ts';
import type { Bill, GameState, NpcId } from '../types.ts';
import { addLog, addStat, addTrust, flag, naira, setFlag } from './state.ts';

export const PAYERS: Array<'you' | NpcId> = ['you', 'amaka', 'femi', 'kemi', 'bisi', 'tobi'];

export function payerName(_s: GameState, who: string): string {
  return who === 'you' ? 'You' : NPCS[who as NpcId].short;
}

export function createBill(s: GameState, id: string, name: string, perFlat: number, dueDay: number): Bill {
  const existing = s.bills.find((b) => b.id === id);
  if (existing) return existing;
  const paid: Record<string, boolean> = {};
  for (const p of PAYERS) paid[p] = false;
  const bill: Bill = { id, name, perFlat, dueDay, issuedDay: s.day, paid, status: 'open' };
  s.bills.push(bill);
  addLog(s, `New bill: ${name}, ${naira(perFlat)} per flat, due end of Day ${dueDay}.`, 'money');
  return bill;
}

export function getBill(s: GameState, id: string): Bill | undefined {
  return s.bills.find((b) => b.id === id);
}

export function paidCount(b: Bill): number {
  return Object.values(b.paid).filter(Boolean).length;
}

export function unpaid(b: Bill): string[] {
  return Object.entries(b.paid).filter(([, v]) => !v).map(([k]) => k);
}

/** Player pays a share (their own or someone else's). Returns false if broke. */
export function payShare(s: GameState, billId: string, who: string): boolean {
  const b = getBill(s, billId);
  if (!b || b.paid[who] || b.status === 'settled') return false;
  if (s.stats.cash < b.perFlat) return false;
  addStat(s, 'cash', -b.perFlat);
  b.paid[who] = true;
  if (who === 'you') {
    addLog(s, `You paid your ${b.name} share.`, 'money');
    addStat(s, 'reputation', 2);
  } else {
    const id = who as NpcId;
    addLog(s, `You covered ${NPCS[id].short}'s ${b.name} share.`, 'money');
    addTrust(s, id, 8);
    addStat(s, 'reputation', 3);
    s.counters['coveredShares'] = (s.counters['coveredShares'] ?? 0) + 1;
  }
  settleIfDone(s, b);
  return true;
}

function npcPays(s: GameState, b: Bill, id: NpcId, why: string): void {
  if (b.paid[id]) return;
  b.paid[id] = true;
  addLog(s, `${NPCS[id].short} paid their ${b.name} share${why}.`, 'money');
}

/** Will this resident pay today? Deterministic from personality + state. */
export function npcWillPay(s: GameState, b: Bill, id: NpcId): boolean {
  const style = NPCS[id].payStyle;
  const daysLeft = b.dueDay - s.day;
  switch (style) {
    case 'early':
      return true;
    case 'ontime':
      if (id === 'kemi' && s.trust.kemi < 40) return daysLeft <= 0;
      return daysLeft <= 1;
    case 'late':
      if (flag(s, 'tobi_deal') || flag(s, `tobi_will_pay_${b.id}`)) return daysLeft <= 1;
      return s.trust.tobi >= 70 && daysLeft <= 0;
    case 'never':
      if (flag(s, 'femi_job')) return daysLeft <= 1;
      return flag(s, `femi_will_pay_${b.id}`) && daysLeft <= 0;
    default:
      return false;
  }
}

export function settleIfDone(s: GameState, b: Bill): void {
  if (b.status === 'settled') return;
  if (paidCount(b) < PAYERS.length) return;
  b.status = 'settled';
  addLog(s, `${b.name} fully paid. Everybody can breathe.`, 'good');
  onSettled(s, b);
}

function onSettled(s: GameState, b: Bill): void {
  if (b.id === 'nepa') {
    if (s.power.disconnected) {
      s.power.disconnected = false;
      addLog(s, 'NEPA reconnected the compound. Light don come!', 'good');
    }
    setFlag(s, 'nepa_settled');
  }
  if (b.id === 'pump') {
    setFlag(s, 'pump_fixed');
    addLog(s, 'The borehole pump is fully repaired. Strong water pressure!', 'good');
  }
  if (b.id === 'waste') setFlag(s, 'waste_settled');
}

/** End-of-day bill processing: residents pay per personality, overdue bills bite. */
export function processBillsEndOfDay(s: GameState): void {
  for (const b of s.bills) {
    if (b.status === 'settled') continue;
    for (const p of PAYERS) {
      if (p === 'you' || b.paid[p]) continue;
      if (npcWillPay(s, b, p as NpcId)) npcPays(s, b, p as NpcId, '');
    }
    settleIfDone(s, b);
    if (b.status === 'open' && paidCount(b) < PAYERS.length && s.day >= b.dueDay) {
      b.status = 'overdue';
      const owing = unpaid(b).map((w) => payerName(s, w)).join(', ');
      addLog(s, `${b.name} is OVERDUE. Still owing: ${owing}.`, 'bad');
      onOverdue(s, b);
    }
  }
}

function onOverdue(s: GameState, b: Bill): void {
  if (b.id === 'nepa') {
    s.power.disconnected = true;
    addLog(s, 'NEPA officials came and cut the compound wire. No public power until the bill is paid.', 'bad');
    addStat(s, 'reputation', -6);
    setFlag(s, 'nepa_cut_off');
  }
  if (b.id === 'waste') {
    setFlag(s, 'refuse_pile');
    addStat(s, 'condition', -15);
    addLog(s, 'The refuse van skipped Unity Compound. The smell has started its own meeting.', 'bad');
  }
}

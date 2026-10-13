// Optional cosmetic purchases ("support the game"). OFF unless the game is built with
// VITE_PAYMENTS=on AND the analytics server reports payments enabled (Paystack configured there).
// - A grown-up check comes before any purchase screen (young players).
// - Checkout happens on Paystack's hosted page; this game never sees card details.
// - Items are granted only after the SERVER verifies the payment with Paystack.
// - Receipts can be restored on a new device with the receipt code.
import { track } from '../analytics.ts';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const API = (env.VITE_ANALYTICS_URL || '').replace(/\/$/, '');
const ON = env.VITE_PAYMENTS === 'on' && !!API;
const KEY = 'compoundWahala.receipts.v1';

export interface StoreItem { sku: string; name: string; kind: string; amount: number; currency: string }

export function receipts(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
export const ownsPremium = (sku: string) => !!receipts()[sku];
function saveReceipt(sku: string, receipt: string): void {
  const r = receipts();
  r[sku] = receipt;
  try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* ignore */ }
}

/** Items for sale, or null when purchases are not enabled. */
export async function catalog(): Promise<StoreItem[] | null> {
  if (!ON) return null;
  try {
    const r = await fetch(`${API}/pay/catalog`);
    const j = await r.json();
    return j.enabled ? j.items : null;
  } catch { return null; }
}

export const price = (i: StoreItem) => (i.currency === 'NGN' ? '₦' : i.currency + ' ') + (i.amount / 100).toLocaleString();

/** Simple grown-up check: a multiplication young children usually can't do. */
export function grownUpQuestion(): { q: string; a: number } {
  const x = 6 + Math.floor(Math.random() * 7), y = 12 + Math.floor(Math.random() * 8);
  return { q: `${x} × ${y}`, a: x * y };
}

export async function startCheckout(item: StoreItem, parentEmail: string): Promise<string> {
  track('purchase_initiated', { sku: item.sku });
  const back = location.href.split('?')[0];
  const r = await fetch(`${API}/pay/init`, { method: 'POST', body: JSON.stringify({ sku: item.sku, email: parentEmail, pid: localStorage.getItem('compoundWahala.pid.v1'), callback_url: back }) });
  const j = await r.json();
  if (!j.ok) { track('purchase_failed', { sku: item.sku, stage: 'init' }); throw new Error(j.error || 'Could not start checkout'); }
  return j.authorization_url as string;
}

/** Called on page load: Paystack sends the player back with ?reference=… */
export async function finishCheckoutFromUrl(): Promise<{ sku: string; reference: string } | null> {
  if (!ON) return null;
  const q = new URLSearchParams(location.search);
  const ref = q.get('reference') || q.get('trxref');
  if (!ref) return null;
  history.replaceState(null, '', location.pathname);
  try {
    const r = await fetch(`${API}/pay/verify?reference=${encodeURIComponent(ref)}`);
    const j = await r.json();
    if (!j.ok) { track('purchase_failed', { stage: 'verify' }); return null; }
    saveReceipt(j.sku, j.receipt);
    track('purchase_completed', { sku: j.sku });
    return { sku: j.sku, reference: ref };
  } catch {
    track('purchase_failed', { stage: 'network' });
    return null;
  }
}

export async function restore(reference: string): Promise<string | null> {
  const r = await fetch(`${API}/pay/restore`, { method: 'POST', body: JSON.stringify({ reference: reference.trim() }) });
  const j = await r.json();
  if (!j.ok) return null;
  saveReceipt(j.sku, j.receipt);
  return j.sku;
}

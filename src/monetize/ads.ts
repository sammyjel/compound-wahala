// Optional rewarded ads. OFF unless the game is built with VITE_ADS_PROVIDER=adsense and
// VITE_ADSENSE_CLIENT=ca-pub-… (an approved AdSense account with H5 Games ads).
// - Never required: ads only add bonus coins after a level.
// - No placeholder ads: with no provider the button simply doesn't exist.
// - The reward is granted only when the SDK reports the ad was watched (adViewed), once per offer.
//   Web ads have no server-side verification signal; the reward is cosmetic coins stored on the
//   player's own device, so there is nothing of value to defraud. Mobile builds should use AdMob
//   rewarded ads with server-side verification (see growth/MONETIZATION.md).
import { track } from '../analytics.ts';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
const PROVIDER = env.VITE_ADS_PROVIDER || 'none';
const CLIENT = env.VITE_ADSENSE_CLIENT || '';
export const DAILY_CAP = 3;
const KEY = 'compoundWahala.ads.v1';

type AdBreak = (o: unknown) => void;
let ready = false;
const used = new Set<string>();

function today(): { day: string; n: number } {
  const d = new Date().toISOString().slice(0, 10);
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || '{}');
    return s.day === d ? s : { day: d, n: 0 };
  } catch { return { day: d, n: 0 }; }
}

/** Load the provider SDK once (only when configured). */
export function initAds(childDirected = true): void {
  if (PROVIDER !== 'adsense' || !/^ca-pub-\d+$/.test(CLIENT) || ready) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${CLIENT}`;
  s.crossOrigin = 'anonymous';
  // Family audience: request child-directed treatment (no personalised ads).
  if (childDirected) s.setAttribute('data-tag-for-child-directed-treatment', '1');
  s.onload = () => {
    const w = window as unknown as { adsbygoogle: unknown[]; adBreak?: AdBreak; adConfig?: (o: unknown) => void };
    w.adsbygoogle = w.adsbygoogle || [];
    w.adBreak = w.adConfig = function (o: unknown) { (w.adsbygoogle as unknown[]).push(o); } as AdBreak;
    w.adConfig?.({ preloadAdBreaks: 'on', sound: 'on' });
    ready = true;
  };
  document.head.append(s);
}

export function rewardedAvailable(): boolean {
  return PROVIDER === 'adsense' && ready && today().n < DAILY_CAP;
}

/** Make an offer id for one button; the reward can be claimed at most once per id. */
export function newOffer(placement: string): string {
  track('ad_offered', { placement });
  return placement + ':' + Math.random().toString(36).slice(2);
}

/** Show a rewarded ad. Resolves true only if the SDK confirms the ad was watched. */
export function showRewarded(offer: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (used.has(offer) || !rewardedAvailable()) { resolve(false); return; }
    used.add(offer);
    const placement = offer.split(':')[0];
    let viewed = false;
    const w = window as unknown as { adBreak?: AdBreak };
    w.adBreak?.({
      type: 'reward',
      name: placement,
      beforeReward: (showAdFn: () => void) => { track('ad_started', { placement }); showAdFn(); },
      adViewed: () => {
        viewed = true;
        const t = today();
        try { localStorage.setItem(KEY, JSON.stringify({ day: t.day, n: t.n + 1 })); } catch { /* ignore */ }
        track('ad_completed', { placement });
      },
      adDismissed: () => track('ad_skipped', { placement }),
      adBreakDone: () => resolve(viewed),
    });
  });
}

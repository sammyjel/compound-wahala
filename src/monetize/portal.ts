// Game-portal builds (CrazyGames, GameDistribution). OFF unless built with VITE_PORTAL=crazygames|gamedistribution
// (GameDistribution also needs VITE_GD_GAME_ID from its dashboard). See docs/PORTALS.md.
// The portal hosts the game and runs the ads; we only ask for an ad at natural breaks:
// - midgame: when the player taps NEXT LEVEL (never during play, never on menu/settings/shop buttons)
// - rewarded: the existing optional "+20 bonus coins" button after a level (reward only on a completed ad)
// Audio is muted only while an ad actually plays. If no ad is available the game simply carries on.
import { muteForAd } from '../audio/music.ts';
import { muteSfxForAd } from '../audio/sfx.ts';
import { track } from '../analytics.ts';

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
export const PORTAL = (env.VITE_PORTAL || '') as '' | 'crazygames' | 'gamedistribution';
const GD_ID = env.VITE_GD_GAME_ID || '';

type CgCallbacks = { adStarted?: () => void; adFinished?: () => void; adError?: (e: { code?: string }) => void };
interface CrazySDK {
  init(): Promise<void>;
  environment: 'local' | 'crazygames' | 'disabled';
  ad: { requestAd(type: 'midgame' | 'rewarded', cb: CgCallbacks): void };
  game: { gameplayStart(): void; gameplayStop(): void; loadingStart(): void; loadingStop(): void };
}
interface GdSDK { showAd(type?: string): Promise<unknown>; preloadAd(type: string): Promise<unknown> }

let ready = false;
let inGameplay = false;
/** GameDistribution reports a completed rewarded ad through an event, not the promise. */
let gdRewardDone = false;

const cg = () => (window as unknown as { CrazyGames?: { SDK: CrazySDK } }).CrazyGames?.SDK;
const gd = () => (window as unknown as { gdsdk?: GdSDK }).gdsdk;

function adMute(on: boolean): void {
  muteForAd(on);
  muteSfxForAd(on);
}

function loadScript(src: string, id?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    if (id) s.id = id;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('portal SDK failed to load'));
    document.head.append(s);
  });
}

/** Load and start the portal SDK. Never throws: with an ad blocker or offline the game still runs. */
export async function initPortal(): Promise<void> {
  try {
    if (PORTAL === 'crazygames') {
      await loadScript('https://sdk.crazygames.com/crazygames-sdk-v3.js');
      const sdk = cg();
      if (!sdk) return;
      await sdk.init();
      ready = sdk.environment !== 'disabled';
    } else if (PORTAL === 'gamedistribution') {
      if (!/^[0-9a-f]{32}$/.test(GD_ID)) { console.warn('VITE_GD_GAME_ID missing: GameDistribution ads off'); return; }
      (window as unknown as { GD_OPTIONS: unknown }).GD_OPTIONS = {
        gameId: GD_ID,
        onEvent: (event: { name: string }) => {
          if (event.name === 'SDK_GAME_PAUSE') adMute(true);
          else if (event.name === 'SDK_GAME_START') adMute(false);
          else if (event.name === 'SDK_REWARDED_WATCH_COMPLETE') gdRewardDone = true;
          else if (event.name === 'SDK_READY') ready = true;
        },
      };
      await loadScript('https://html5.api.gamedistribution.com/main.min.js', 'gamedistribution-jssdk');
    }
  } catch (e) {
    console.warn(String(e));
  }
}

export const portalReady = (): boolean => !!PORTAL && ready;

/** Tell the portal when real play starts/stops (CrazyGames requirement; harmless elsewhere). */
export function gameplay(on: boolean): void {
  if (!portalReady() || PORTAL !== 'crazygames' || on === inGameplay) return;
  inGameplay = on;
  try { if (on) cg()!.game.gameplayStart(); else cg()!.game.gameplayStop(); } catch { /* ignore */ }
}

/** Ask for a between-levels ad. Always resolves; the portal decides whether one is shown (they cap frequency). */
export function midgame(): Promise<void> {
  if (!portalReady()) return Promise.resolve();
  gameplay(false);
  track('ad_midgame_requested', { portal: PORTAL });
  if (PORTAL === 'crazygames') {
    return new Promise((resolve) => {
      const done = () => { adMute(false); resolve(); };
      try {
        cg()!.ad.requestAd('midgame', { adStarted: () => adMute(true), adFinished: done, adError: done });
      } catch { done(); }
    });
  }
  return (gd()?.showAd() ?? Promise.resolve()).then(() => {}, () => {}).finally(() => adMute(false));
}

/** Rewarded ad. Resolves true only when the portal confirms the ad was watched to the end. */
export function portalRewarded(): Promise<boolean> {
  if (!portalReady()) return Promise.resolve(false);
  if (PORTAL === 'crazygames') {
    return new Promise((resolve) => {
      try {
        cg()!.ad.requestAd('rewarded', {
          adStarted: () => adMute(true),
          adFinished: () => { adMute(false); resolve(true); },
          adError: () => { adMute(false); resolve(false); },
        });
      } catch { resolve(false); }
    });
  }
  const sdk = gd();
  if (!sdk) return Promise.resolve(false);
  gdRewardDone = false;
  return sdk.showAd('rewarded').then(() => gdRewardDone, () => false).finally(() => adMute(false));
}

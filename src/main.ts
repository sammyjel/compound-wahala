import { recent, startSession, track } from './analytics.ts';
import { unlockMusic } from './audio/music.ts';
import { initAds } from './monetize/ads.ts';
import { finishCheckoutFromUrl } from './monetize/store.ts';
import { loadSprites } from './render/sprites.ts';
import { Story } from './story/play.ts';
import { App } from './ui/app.ts';
import { showResults, showTitle } from './ui/screens.ts';

const app = new App();
const story = new Story(app);
app.story = story;
startSession();
showTitle(app);
// Character photos stream in; the title line-up and portraits use them as soon as they arrive.
void loadSprites();
// Monetization stays inert unless configured at build time (see growth/MONETIZATION.md).
initAds();
void finishCheckoutFromUrl().then((r) => { if (r) app.toast('Thank you! ❤️', `Purchase confirmed. Receipt code: ${r.reference}`, 'info'); });

// Handy for debugging and automated tests: window.__cw.app.game.s, window.__cw.story.p
(window as unknown as { __cw: unknown }).__cw = { app, story, showResults, analytics: recent, track };

// Browsers only allow audio after a user gesture.
for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, unlockMusic, { once: true, capture: true });

window.addEventListener('beforeunload', () => app.save());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') app.save();
});

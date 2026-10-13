import { unlockMusic } from './audio/music.ts';
import { loadSprites } from './render/sprites.ts';
import { App } from './ui/app.ts';
import { showResults, showTitle } from './ui/screens.ts';

const app = new App();
// Show the title once character art has loaded (or after a short timeout).
void loadSprites().then(() => showTitle(app));

// Handy for debugging and automated tests: window.__cw.app.game.s
(window as unknown as { __cw: unknown }).__cw = { app, showResults };

// Browsers only allow audio after a user gesture.
for (const ev of ['pointerdown', 'keydown'] as const) window.addEventListener(ev, unlockMusic, { once: true, capture: true });

window.addEventListener('beforeunload', () => app.save());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') app.save();
});

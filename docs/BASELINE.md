# Phase 1 — Audit, baseline and changes (14 Oct 2026)

## What the project is

| Area | Finding |
|---|---|
| Engine | TypeScript + Vite 5, hand-drawn Canvas 2D scene + DOM UI. No game framework. Rules in `src/engine` are DOM-free and unit-tested. |
| Build / hosting | `npm run build` → `dist/` (one 255 KB `index.html`, 88 KB gzipped, plus `music/`, `chars/`, `media/`, `icons/`). Hosted free on GitHub Pages (`gh-pages` branch) at https://sammyjel.github.io/compound-wahala/ |
| Saving | `localStorage` only (game progress, Story progress, settings). No accounts. |
| Analytics before | None. |
| Monetization before | None. |
| Distribution before | Browser only. No landing page, store listings, privacy page or feedback channel. |

## Why the game felt hard (before)

1. Six stats in the HUD (cash, mood, reputation, fuel, water, compound) visible from second one.
2. A side panel, two dock bars (residents, places) and four menu buttons, before any goal was clear.
3. A 6-step coach-mark tutorial explaining UI instead of letting you play.
4. The objective lived in a "Missions" tab; time, bills and meetings all arrived on day 1.
5. Talking opened multi-choice dialogue trees; the meeting vote was a numbers puzzle.
6. A full week took 10–15 minutes — no short, finishable challenge.

## What changed (simplification)

- **New default Story Mode**: title → one big **PLAY** → Level 1 starts immediately. First choice appears ~10 s after PLAY without skipping talk (tap/Enter skips).
- **One goal at a time** in a banner, **2–3 big buttons**, and the thing to tap glows with a bouncing arrow. The picture is tappable too; buttons are always there for keyboard / accessibility.
- **Wrong answers are funny, never punished**: a joke reply, then the right button glows. Mistakes only affect stars (always ≥1 star).
- **5 short levels, one new idea each**: 1 NEPA Don Take Light (sequence), 2 Where My Bucket (search), 3 Rain Dey Come (timer), 4 Who Chop the Meat (clues → decide), 5 Fuel Palaver (fair rule + vote).
- **Rewards**: coins + 1–3 stars, level-complete card with NEXT LEVEL / Play again / All levels; level map; coin-bought decorations that appear in the compound; player looks unlocked by stars.
- **Full Week mode kept** (all original features), unlocked after level 5 or if a week save exists.
- Original-asset sound effects added (synthesised: boing, sputter, drum, thunder, goat, splash, cheer).
- Privacy page, feedback/bug page, web app manifest + icons (Add to Home screen).

## Baseline measurements (local, real runs)

| Measure | Result |
|---|---|
| First choice after PLAY (no skipping) | ~10 s desktop and phone |
| Level lengths (natural play, recorded) | L1 ≈ 53 s · L2 ≈ 63 s · L3 ≈ 37 s · L4 ≈ 56 s · L5 ≈ 55 s |
| PLAY usable, fast connection | 0.2 s |
| PLAY usable, throttled slow-3G (400 kbps, 400 ms), uncompressed test server | 5.6 s (character art 12.2 s). GitHub Pages gzips, so real-world is faster. |
| Music | 12 MB total, streamed only when a track plays; game never waits for it |
| Console errors during full automated play (desktop + phone) | 0 |

Not measured yet (needs real players + analytics endpoint): real-device load times, retention, completion rates.

## Tests run

| Suite | Result |
|---|---|
| `npm test` — game rules (12) + Story progress (5) | 17/17 pass |
| `npm run e2e` — Full Week browser flow (17) + Story Mode desktop & phone (28) | 45/45 pass |
| `npm run growth:test` — analytics, workflows, reports, payments | 17/17 pass |
| `npm run growth:integration` — game → consent → analytics server → dashboard → delete | 3/3 pass |
| `npm run growth:store-e2e` — purchase flow vs fake Paystack | 4/4 pass |

## Remaining issues for beginners

- Talk auto-advances (≈2–5 s per line). Slow readers can still read the bottom caption; very young children may need an adult for the Pidgin + English lines.
- Level 3's 20-second timer is generous but still a timer; failing just restarts the step.
- Character photos look real on an illustrated background (style mix).
- No real-device testing on low-end Android phones yet — the most important next check.

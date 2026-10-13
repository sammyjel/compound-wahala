# COMPOUND WAHALA: Naija Neighbourhood Wars

A comedy social-simulation for the browser. You've just rented Room 4 in **Unity Compound, 7 Adebayo Close**: six flats, one generator, one water tank and endless opinions. Survive one week. Earn money, keep the light on and the tank full, settle shared bills, sort out neighbourhood wahala and win votes at the compound meetings.

A week takes about 10–15 minutes. Works on desktop and phone, with mouse, touch or keyboard. It's fully playable with sound off.

---

## Play it

**Quickest:** open `dist/index.html` in any modern browser by double-clicking it. The whole game, art and sound included, is one self-contained file with no server and no internet needed.

**From source:**

```bash
npm install          # Vite, TypeScript, single-file plugin, playwright-core (no browser download)
npm run dev          # http://localhost:5173 (also on your LAN, for testing on a phone)
npm run build        # typecheck + build → dist/index.html (single file)
npm run preview      # serve the built file
```

Requires Node 18+ (Node 22.6+ for `npm test`, which runs TypeScript natively).

**Live:** https://sammyjel.github.io/compound-wahala/

**Deploying:** upload the whole `dist/` folder (`index.html` + `music/`) to any static host. It's currently on GitHub Pages, served from the `gh-pages` branch. To redeploy after changes (Git Bash):

```bash
npm run build && cd dist && touch .nojekyll && git init -q -b gh-pages && git add -A   && git commit -qm deploy && git push -f https://github.com/sammyjel/compound-wahala.git gh-pages && rm -rf .git
```

**Music:** original Suno tracks (made by Samuel) in `public/music/`, compressed to 112 kbps; the win/lose stings are 9-second cuts. The game works without them, and Music has its own toggle and volume in Settings.

**Characters:** photoreal portraits of fictional people, generated locally with Z-Image Turbo (Pinokio / Wan2GP) by `art/gen.py`, then cut out with rembg (`art/process.py`) into `public/chars/` (328 KB total). To regenerate one: run `art/gen.py <id>` with the Pinokio venv python, pick a take in `art/picks.json`, then run `art/process.py`. The vector characters in `src/render/people.ts` remain as a fallback.

## Controls

| Action | Mouse / touch | Keyboard |
|---|---|---|
| Talk to a resident | Tap them in the compound, or their face in the bottom bar | Tab to the button, Enter |
| Use a place (gate, kiosk, generator, tank, meter…) | Tap it, or its button in the Places bar | Tab, Enter |
| Pick a dialogue / event choice | Tap it | **1–9** |
| Missions / Bills / Log / Today | Bottom buttons | **M / B / L / T** |
| Back / pause menu | ← button / ☰ | **Esc** (P also pauses) |
| End the day | **Sleep** button (goes to the meeting first on meeting days) | |

Settings (title screen or ☰): text size (4 steps), sound, plain-English translations, labels, reduce motion.

## How it plays

- **Time moves only when you act.** A chat takes 30 minutes; jobs take 2–3 hours. Days run from 7am to 10pm and go morning → afternoon → evening → night, and the sky, lighting and residents' routines change with them.
- **Resources:** Cash (₦, in-game only), Mood, Reputation, Generator fuel, Water tank, Compound condition, plus **trust** with each resident.
- **Power:** NEPA (the power company) cuts out on a seeded daily schedule. Run the shared generator (it burns 1L an hour) or go without. Phone repairs pay less without power, and the pump needs power. At night, unlit windows go dark.
- **Shared bills:** NEPA (Day 1, due Day 3), refuse (Day 4, due Day 6), plus whatever meetings approve. Each resident pays according to their personality: Amaka early, Kemi and Bisi near the deadline, Tobi only if he trusts you, Femi only with a push or a job. A missed NEPA deadline means **disconnection** until every share is paid.
- **Events:** power cuts, the bill landing, missing laundry, a loud speaker, a surprise cousin from the village, a dry tank, a goat named Senator, heavy rain, a party next door, Chief's inspection, Tobi going viral, Femi's frozen investment app, Iya Bisi's freezer crisis. Every choice shows its cost and effect before you pick it.
- **14 missions**, with objectives, progress bars, rewards and some failure states.

### The signature mechanic: Compound Meetings

On Days 1, 3, 5 and 7, Chief calls a meeting at 6pm (fuel fund, borehole pump, quiet hours, development levy).

1. Hear the problem and the motion.
2. **Pick a side**: support, oppose, or walk out (no say, reputation −4).
3. **Lobby** with 3 moves (+1 at reputation 60+, +1 after the *Know Your Neighbours* mission):
   - **Persuade** with an argument. It's strong if it matches what that person cares about and backfires if it goes against it. You only see the predicted strength for residents whose values you've learned by chatting or from Aunty Kemi's gossip.
   - **Cover their share**: pledge to pay for them if the motion passes.
   - **Propose the amendment** (a compromise version of the motion).
   - **Ask Aunty Kemi to work the room**, if she trusts you (65+).
4. **Vote.** Votes are revealed one by one, and a tie is broken by Chief.

**Nothing is random.** Each resident's lean is the sum of visible parts: what they think of the idea (their values × the motion's appeal), the cost to their pocket (thrift; a job or brand deal lowers it), personal stakes, trust in you, history from earlier meetings, and your persuasion. Open **"Why?"** on any card to see the numbers. The projected tally updates live.

## Project structure

```
index.html              App shell (screens, HUD, panel, dock)
src/
  main.ts               Boot
  types.ts              Shared types (GameState, NpcDef, Effects…)
  data/                 CONTENT — edit these to add stuff
    npcs.ts             Residents: looks, values, thrift, routines, pay style; scene spots
    dialogue.ts         Conversation topics, choices, openers, knock reactions
    events.ts           Events + the per-day script + random pool
    missions.ts         Missions: unlock rule, objectives, reward, failure
    meetings.ts         Motions: terms, amendment, arguments, outcomes
    actions.ts          Places and what you can do at each (jobs, shop, pump…)
  engine/               RULES — no DOM; fully testable in Node
    game.ts             Game class: time ticks, power/water/fuel, events, missions, day cycle, results
    meeting.ts          Deterministic vote model + lobbying moves
    bills.ts            Shared bills, resident payment behaviour, overdue consequences
    state.ts            State creation, effects, feedback, helpers
    rng.ts              Seeded RNG (reloading never re-rolls a day)
    save.ts             localStorage save/load + settings
  render/               DRAWING — reads state, never changes it
    scene.ts            Canvas compound: sky, building, props, lighting, labels, camera
    people.ts           Procedural cartoon characters + portraits
  ui/                   DOM UI
    app.ts              Controller: HUD, panel, dock, flow (events → meeting → day end)
    meeting.ts          Meeting screen
    screens.ts          Title, new game, settings, pause, tutorial, results
    modal.ts, dom.ts, lines.ts, hints.ts
  audio/sfx.ts          Synthesised sound effects (Web Audio, no files)
  styles.css
tests/
  logic.test.ts         Rules tests (Node test runner)
  e2e.mjs               Browser end-to-end test through the real UI
  shots.mjs             Screenshot helper
  pw.mjs                Finds playwright-core + a local Chrome/Edge
```

### Extending

- **New resident:** add the id to `NpcId`/`NPC_IDS` in `types.ts`, a definition in `data/npcs.ts`, openers and knock text plus topics in `data/dialogue.ts`, and an entry in `PAYERS` in `engine/bills.ts` if they pay bills. Meetings pick them up automatically.
- **New event:** add an `EventDef` to `data/events.ts`, then either schedule it in `DAY_SCRIPT` or add it to `RANDOM_POOL`.
- **New mission:** add a `MissionDef` to `data/missions.ts`. Objectives are plain functions of state.
- **New meeting:** add a `MotionDef` to `data/meetings.ts` with a `day`.
- **Translations:** all player-facing text lives in `data/*` and the `ui/` files. Pidgin lines carry a `plain` field for plain-English subtitles.

## Tests

```bash
npm test             # 12 rules tests: missions, bills, disconnection, votes, determinism, save round-trip, full week
npm run build
npm run e2e          # 16 browser checks against dist/index.html using your installed Chrome/Edge
npm run shots        # screenshots to tests/screens (desktop + phone)
```

The browser tests use `playwright-core` with the system Chrome or Edge. Set `CHROME_PATH` if yours is somewhere unusual, or `GAME_URL` to test a dev server.

## Troubleshooting

- **Blank page from `index.html` in the project root:** that file is the dev entry. Open `dist/index.html` instead, or run `npm run dev`.
- **"Your browser is blocking storage":** private/incognito windows or blocked site data prevent saving. The game still plays; it just won't remember progress.
- **No sound:** browsers only allow audio after your first tap or click. Check that Sound is On in Settings.
- **`npm test` fails with a syntax error:** use Node 22.6 or newer (native TypeScript stripping).
- **`npm run e2e` can't find a browser:** install Chrome or Edge, or set `CHROME_PATH=/path/to/chrome`.
- **Progress looks stuck:** an event, meeting or day summary may be waiting in a dialog. Press **1** or Enter. You can always use ☰ → Save and quit, then Continue.

## Content and fairness notes

All characters, places and brands are fictional. Residents are written as people first and jokes second: the gossip is also the one who cooks pepper soup when you're sick, and the "never pays" guy turns around if you find him real work. Money is in-game naira only. There's no real-money gambling, no pay-to-win, no ads, no tracking and no personal data beyond the name you type, which stays in your own browser.

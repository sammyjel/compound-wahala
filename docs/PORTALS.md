# Game portals — CrazyGames & GameDistribution

The portal hosts a copy of the game and runs the ads; you get a revenue share. Your own site stays ad-free.

## What the portal build does differently
| | Website build | Portal build |
|---|---|---|
| Ads | none | portal's ads: one **between levels** (on NEXT LEVEL; the portal caps frequency) + the optional **"📺 +20 bonus coins"** after a level (max 3/day, reward only after a completed ad) |
| Own analytics + privacy prompt | yes (opt-in) | **off** — nothing sent to our server |
| Paystack store, AdSense | per settings | **off** |
| Links off the game (privacy, feedback) | yes | **removed** (portal rule) |
| Sound | normal | muted only while an ad actually plays |
| Gameplay start/stop signals | — | sent to CrazyGames when play starts/stops |

## CrazyGames
1. `node scripts/portal-build.mjs crazygames` → `dist-portal/compound-wahala-crazygames.zip` (≈12 MB, index.html at the root).
2. Test: `node tests/portal.mjs` plays it on localhost with the real SDK in test mode (6 checks).
3. developer.crazygames.com → sign up (free) → **Submit game** → HTML5 → upload the zip. Fill in name, description and cover images (use `public/media/og/*.jpg`; tell me the exact sizes the form asks for and I'll render them).
4. Their QA reviews it (they may ask for changes). Earnings and payout settings are in their developer portal.

## GameDistribution
1. gamedistribution.com → Developers → sign up (free) → **Add game** → copy the 32-character **gameId**.
2. `node scripts/portal-build.mjs gamedistribution <gameId>` → `dist-portal/compound-wahala-gamedistribution.zip`.
3. Upload the zip in their dashboard and submit. (Not yet tested against GD's live SDK — it needs your gameId. Their test mode shows on their preview page.)

## Rules the build follows (from the portals' ad requirements)
Midgame ads only at natural breaks, never during play or on menu/settings/shop buttons; the game keeps working when no ad is available or an ad blocker is on; rewarded ads are optional, never needed to finish a level, never chained, not rewarded on error; audio muted only while the ad plays.

Sources: CrazyGames docs (SDK intro, video ads, game module, ad requirements) and the GameDistribution GD-HTML5 wiki, read 2026-10-18.

# Launch plan, costs, risks and what I need from you

## Distribution: recommended order

| Option | Effort from today | Reach / friction | Money options | Verdict |
|---|---|---|---|---|
| **1. Browser (now)** | Done — redeploy only | One tap from any TikTok/WhatsApp link, no install, works on cheap Androids | Web ads (AdSense H5), Paystack | **Launch first.** Prove people play and come back. |
| **2. Android** (Trusted Web Activity or Capacitor wrapper) | 2–4 days: wrapper, Play listing, data-safety form, content rating, testing | Play Store discovery; Android ≈ most Nigerian phones | AdMob (with server-side verification), Play Billing | **Second**, once D1 retention is decent (aim ≥ 25%). |
| 3. Portals (CrazyGames / Poki) | 1–2 days for their SDK | Big existing web audience, they run ads | Revenue share | Good parallel test after the browser launch. |
| 4. iOS | 1–2 weeks: Mac + Xcode, App Store review, StoreKit | Smaller share in Nigeria; diaspora matters | Apple IAP | Later. |
| 5. PC (itch.io / Steam) | itch: hours · Steam: $100 fee + weeks | Niche for this genre | Paid/donations | Optional; itch.io is free. |

Ready now: responsive layout (tested 390 px phone → desktop), web app manifest + icons (Add to Home screen = first step to a TWA), privacy page, feedback page, landing page, trailer, screenshots.

### Store listing draft (for when you choose Android)
- Title: Compound Wahala — Naija Comedy
- Short description: Fix funny problems in a busy Nigerian compound. NEPA, goats and generator palaver!
- Full description: use `public/home.html` sections. Content rating: Everyone / PEGI 3 (no violence, no chat, no gambling). Data safety: no data collected unless the player opts in to anonymous statistics; no data shared.
- Assets: icons in `public/icons/` (512 px), phone screenshots in `tests/screens/` (`npm run shots`), trailer `public/media/trailer.mp4`.
- Test checklist: low-end Android (2 GB RAM) Chrome, offline start, back button, sound after first tap, text size A++, rotation, 3G load.

## First 4 weeks

| Week | Do | Success signal |
|---|---|---|
| 0 | Approve + redeploy (game v2 + landing + privacy). Deploy analytics Worker (free). Approve the first 3 videos. | Dashboard shows your own test session |
| 1–2 | Post 1 short/day on TikTok + YouTube Shorts + Reels (manual tasks, ~10 min/day). Share in 3–5 WhatsApp groups. Ask 10 people to playtest and send feedback. | 100+ players; tutorial completion ≥ 70%; level 1 finish ≥ 60% |
| 3 | Fix the level with the worst drop-off. Run `growth:report`. Double down on the series that brings players. | D1 retention measured on ≥ 50 players |
| 4 | Decide on ads/payments/Android based on retention, not hope. | D1 ≥ 25%, D7 ≥ 8% before monetizing hard |

## Operating costs (monthly)

| Item | Cost | Notes |
|---|---|---|
| GitHub Pages hosting | $0 | |
| Cloudflare Worker + D1 analytics | $0 | Free tier ≈ 100k requests/day. $5/mo only if outgrown. |
| Video rendering, gameplay capture | $0 | ffmpeg + Chrome on your PC |
| n8n self-hosted / Task Scheduler | $0 | Your existing n8n Cloud plan is separate |
| Claude API copywriting (optional) | $0 by default | Capped by `spend.aiMonthlyLimitUSD`; ≈ $0.02 per item |
| Paystack | 1.5% + ₦100 per local card payment (₦100 waived under ₦2,500; capped) / ~3.9% international — check current rates | Only on sales |
| AdSense | Google keeps a share; you receive the rest | Only if enabled |
| Google Play developer | $25 once | When you go Android |
| Apple developer | $99/year | iOS only |
| Paid ads | $0 | Never started by these tools; needs your explicit approval and budget |

**Expected starting total: $0/month.** No revenue is forecast here; the dashboard will show measured revenue when it exists.

## Risks

- **Music licensing:** the soundtrack is your Suno output. Commercial use (ads/monetized videos) requires a paid Suno plan at the time of generation — check your plan before monetizing videos or the game.
- **AI-generated characters:** disclosed in captions, landing page and YouTube's synthetic-media flag. Keep labelling on every platform.
- **Children:** keep ads child-directed or off; grown-up gate before payments; YouTube "made for kids" must be set honestly (affects comments/ads).
- **Platform APIs:** TikTok public posting via API needs an audited developer app; Instagram/Facebook need Meta App Review. Until then posting is manual (≈2 min per post per platform with the generated checklists).
- **Slow connections:** your PC reaches github.io at ~10 KB/s; players elsewhere are usually much faster, but test on real Nigerian mobile data.
- **Single-device saves:** no cloud saves; clearing browser data resets progress.

## Integrations status

| Integration | Status |
|---|---|
| Simplified game (Story Mode) | **Live** (deployed 2026-10-14) |
| Landing page, privacy, feedback, manifest | **Live** |
| Analytics client + consent + delete | **Live** (2026-10-15): opt-in events reach the Worker; verified by `npm run growth:live-check` |
| Analytics Worker (Cloudflare) | **Live, free tier**: https://compound-wahala-analytics.sammyjel.workers.dev (D1 `compound-wahala-analytics`) |
| Dashboard | **Working** on local server; shows real data only |
| Content generation (A) | **Working** — 7 real drafts in the review queue now |
| Review queue | **Working** |
| Publishing (B) | **Working in manual-task mode**; kill switch ON |
| YouTube API adapter | **Built, untested** — needs your Google Cloud OAuth credentials |
| TikTok / Instagram / Facebook API | **Not built** — need approved developer apps; manual tasks instead |
| Reporting (C) + suggestions (D) | **Working**; no post data yet |
| n8n workflows A–D | **Generated, not imported** — import into a self-hosted n8n |
| Notifications | Inbox file working; ntfy push needs your topic in `.env` |
| Rewarded ads (AdSense H5) | **Built, off** — needs AdSense account + approval |
| Paystack purchases | **Built, tested with fake Paystack, off** — needs business-verified Paystack account + your approval |
| App stores | **Not published** — needs Play Console ($25) / Apple ($99/yr) accounts |

## What I need from you (in order)

1. ~~OK to redeploy~~ — done.
2. ~~Cloudflare account~~ — done 2026-10-15.
3. Watch the 7 draft videos at `/review`; approve the ones you like.
4. ~~Which social accounts~~ — given 2026-10-15 (in `growth/config.json` → `account`): YouTube PraiseChannel, Facebook Psalmist Sammyjel, Instagram @biggysammyjel, TikTok Dispatch Channel (need its @username).
5. Optional: Google Cloud OAuth client for YouTube API; ntfy topic for phone alerts.
6. Later, only if you decide: AdSense, Paystack (business verification), Play Console.

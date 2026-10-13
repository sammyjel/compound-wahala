# Monetization — what's built, what's off, what you must provide

Principles: the whole game is playable free; nothing is pay-to-win; no countdowns, fake discounts, loot boxes or gambling; a grown-up check before any real-money screen; coins can never be bought.

## Status

| Piece | State |
|---|---|
| Coins, stars, coin-bought decorations | **Live in the game** (no real money) |
| Rewarded ad button ("+20 bonus coins, optional", max 3/day, after a level) | **Built, OFF.** Appears only when built with an ad provider |
| Premium cosmetics via Paystack (server-verified) | **Built and tested against a fake Paystack, OFF** |
| Restore purchases (receipt code) · refund webhook · ledger entries | Built + tested (fake Paystack) |
| Generator skins, outfit packs, extra mission packs | In the catalogue as `available: false` — **not sold until the art/levels exist** |
| Native in-app purchases (Google Play Billing / Apple IAP) | Not built — only needed for store apps (see below) |

## A. Rewarded ads (web)

Provider: **Google AdSense — H5 Games Ads (Ad Placement API)**, the main legitimate option for browser games.
- You need: an AdSense account, the site approved, and H5 Games Ads access (Google gates this). Then build with
  `VITE_ADS_PROVIDER=adsense VITE_ADSENSE_CLIENT=ca-pub-XXXXXXXX npm run build`.
- Family audience: the game requests child-directed treatment (no personalised ads). Review AdSense's policy for games played by children before enabling; you may decide not to run ads at all for under-13s.
- Reward rule: coins are granted only in the SDK's `adViewed` callback, once per offer. **Web ads have no server-side verification**; this is acceptable only because rewards are cosmetic coins stored on the player's own device. If ads ever unlock anything of value, move to a mobile build with **AdMob rewarded ads + Server-Side Verification** (verify the signed callback in the Worker before granting).
- Alternative distribution with built-in ads: CrazyGames / Poki (they host the game, handle ads, share revenue; submission needs their approval).
- Update `public/home.html` ("no ads") and `public/privacy.html` the day ads are enabled.

## B. Cosmetic purchases (web) — Paystack

- Server: `growth/analytics/payments.mjs` (in the Worker): prices on the server, `/pay/init` → Paystack hosted checkout (card details never touch us), `/pay/verify` re-checks with Paystack (exact amount + currency), each reference recorded once, `/pay/webhook` HMAC-SHA512 signature check, refunds revoke the item, revenue/fees/refunds written to the ledger as **measured**.
- Client: `src/monetize/store.ts` — "Support the game (grown-ups only)" in the Decorate shop, multiplication grown-up check, parent email (for Paystack's receipt only; not stored by us), restore by receipt code.
- To enable (needs your approval):
  1. Paystack business account — **requires business verification/registration** (CAC). Use **test keys** first.
  2. Worker secrets: `PAYSTACK_SECRET_KEY`, `ENTITLEMENT_SECRET` (random), var `PAYMENTS_ENABLED=true`.
  3. Paystack dashboard → Webhook URL `https://<worker>/pay/webhook`.
  4. Build game with `VITE_PAYMENTS=on VITE_ANALYTICS_URL=https://<worker>`.
  5. Test with Paystack test cards; then add a refund policy line to the privacy/feedback page; then switch to live keys.
- International players: Paystack supports cards from many countries; for USD/GBP-heavy diaspora traffic, Stripe would need its own adapter (not built).

## C. Native apps (later)
Google Play and Apple require their own billing for digital goods inside apps (Play Billing / StoreKit). If you ship store apps, cosmetics must use those (with server receipt validation) — Paystack stays for the web version only.

## D. Experiments (configurable, not started)
Ready to toggle once there are enough players (hundreds/week): ad button shown vs hidden (does it hurt D1 retention?), shop entry on the level card vs map only, bundle price points. Measure with the dashboard's retention + store events. Rule: stop any experiment that lowers D1 retention.

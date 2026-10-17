# How Compound Wahala can earn money — ranked plan

The technical pieces (rewarded ads, Paystack cosmetics, ledger) are already built and OFF — see `MONETIZATION.md`.
This file is the **business** side: which money routes fit this game, in what order, and what each needs from you.

## The honest starting point
- The game is live, free, and has **0 measured players so far** (analytics went live 2026-10-15). Every route below earns
  in proportion to players, so traffic comes first. No revenue is forecast here; the dashboard will show real numbers.
- The audience is **kids 7+ and families**, mostly Nigerian + diaspora. That rules out aggressive ads and anything that
  pressures children to pay, and it shapes which sponsors are acceptable.
- Ads shown to Nigerian visitors pay far less per view than ads shown in the UK/US. Diaspora players are worth more per ad; sponsors and paid
  content earn the same wherever the player is.
- Payouts: you already have a registered company (**DMBTREND LTD, RC 9910105**) with a **live Paystack account** (NGN; USD collection
  live since 2026-10-16, USD payout account still in review). The game's built-in Paystack store can run on it — tell Paystack you are
  adding digital game items first, since their risk review approved physical products. PayPal does not operate in Turkey.

## Ranked: best fit first

| # | Route | Why it fits | Needs from you | Cost | When |
|---|---|---|---|---|---|
| 1 | **Game portals: CrazyGames, GameDistribution (then Poki)** | They host a copy, bring millions of players, run the ads, and pay you a revenue share. Also gives SEO backlinks. | Developer accounts (free), OK to submit; I add each portal's SDK in a separate build | $0 | **Now** |
| 2 | **Classroom / homeschool pack** (Gumroad, later TPT) | Each level teaches something real (order of steps, clues, fairness, voting). A printable pack (worksheets, Pidgin↔English cards, discussion questions, answer keys) sells to teachers, diaspora parents and Nigerian private schools. Fits your ESL printables business and pipeline. | OK + price (e.g. $5–9); I build the PDF | $0 | **Now** |
| 3 | **Sponsored levels for NGOs / public-health / brands** ("serious game" commissions) | A level like "Malaria net palaver" or "Wash hand, no wahala" is exactly what Nigerian NGOs, health programmes and edu-funders pay for. One commission can outweigh months of ads. | Your outreach (I write the pitch deck + 1-page demo); a real dashboard number helps | $0 | After ~1,000 players |
| 4 | **In-world sponsorship** (a real brand's kiosk sign, generator, decorations) | The compound is a natural billboard. Brands that fit kids: telecom (airtime), stationery, banks' kids' accounts, solar/inverter companies. **No junk food or betting**, and Nigerian ads may need **ARCON** approval — check before signing. | Sponsor deals; I add a swappable sponsor slot + clear "Sponsored" label | $0 | After traffic proves out |
| 5 | **Rewarded ads** (AdSense H5 Games; AdinPlay as an alternative) | Already built: optional "+20 coins" after a level, max 3/day. Low earnings on Nigerian traffic; kids' rules apply (no personalised ads). | AdSense account + approval; your OK | $0 | After portals, if retention holds |
| 6 | **Cosmetic purchases** (owambe decorations, outfits) | Built + tested (Paystack). Grown-up gate, no pay-to-win. | Your existing DMBTREND LTD Paystack account (keys as Worker secrets, never in code) + your OK | Fees per sale | Later |
| 7 | **Android app** (Play Store) with AdMob + Play Billing | Store discovery; most Nigerian players are on Android. | $25 Play Console + your OK | $25 once | When D1 retention ≥ 25% |
| 8 | **Supporter tips / merch** (Ko-fi, Gumroad "pay what you want", WhatsApp sticker pack → stickers/T-shirts) | Small, but the characters and Pidgin lines are very shareable. Stickers are also free marketing. | Payout account | $0 (print-on-demand) | Anytime |

YouTube Shorts revenue from the game clips is a bonus, not a plan: it needs channel thresholds and pays little per view.

## Recommended next 30 days
1. **Week 1:** You create free CrazyGames + GameDistribution developer accounts → I make the portal builds (SDK, no analytics consent conflicts, their ad breaks only between levels) → you submit. I build the **Classroom Pack** PDF → you list it on Gumroad.
2. **Week 2–3:** Post the approved shorts; add the store/portal links to `home.html`; Search Console set up (see `SEO.md`).
3. **Week 4:** Read the dashboard (players, level completion, D1 retention, which source brings players). Then decide on ads (#5) vs. sponsorship pitch (#3/#4) **with numbers, not hope**.

## Rules this plan keeps
Whole game stays free · nothing pay-to-win · no loot boxes, countdowns or fake discounts · grown-up check before any payment ·
sponsor content labelled "Sponsored" · no junk-food/betting sponsors for a kids' game · update `home.html`/`privacy.html`/FAQ
the day ads or payments switch on (the build now refuses to deploy "no ads" text in an ads build).

## Decisions I need from you
1. OK to prepare **portal builds** (CrazyGames + GameDistribution)? You create the accounts.
2. OK to build the **Classroom Pack** PDF for Gumroad? Price?
3. OK to use the **DMBTREND LTD Paystack account** for the game's cosmetic items (NGN prices first)?
4. Any NGO/brand contacts for #3/#4? If not, I'll draft a target list and a pitch when there are player numbers to show.

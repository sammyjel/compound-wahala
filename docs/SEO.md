# SEO — what runs automatically, and the 3 things only you can do

## Automatic (every `npm run build`)
`scripts/seo.mjs` reads `seo/site.json` + the real level scripts and writes into `dist/`:

| What | Why it matters |
|---|---|
| Title, description, canonical, robots on every page | What Google shows in results; no duplicate-page confusion |
| Open Graph + Twitter cards with real 1200×630 gameplay stills | Big picture previews on WhatsApp, Facebook, X, Telegram, LinkedIn |
| JSON-LD: VideoGame (free, ages 7+, browser), FAQPage, VideoObject (trailer), BreadcrumbList, DefinedTermSet | Lets search engines and AI answers understand the game |
| 5 level pages (`nepa-don-take-light.html` …) | Each ranks for its own phrase and links to Play |
| `pidgin.html` — Pidgin words + every Pidgin line in the game with English | Long-tail searches like "what does wahala mean", "NEPA don take light meaning" |
| FAQ on `home.html`, `<noscript>` text on the game page | Crawlable text, not just a canvas |
| `sitemap.xml` (lastmod from git, images), `404.html` | Faster, complete indexing |

The build **fails** if a page has a broken link, a missing social image, a duplicate title, invalid JSON-LD, or says "no ads / nothing to buy" in a build where ads or payments are switched on. Tests: `npm run test:seo`.

After each deploy: `npm run seo:ping` → submits changed pages to IndexNow (Bing, Yandex, Seznam, Naver). First ping 2026-10-15: HTTP 202 for 10 URLs.

When the levels or art change: `npm run build && npm run seo:shots` (re-captures the stills), then build again.

## Only you can do these (free, ~15 minutes total)
1. **Google Search Console** → Add property → *URL prefix* → `https://sammyjel.github.io/compound-wahala/` → choose **HTML tag** → copy only the `content="…"` value into `seo/site.json` → `verification.google` → tell me (I rebuild + deploy) → click **Verify** → Sitemaps → submit `sitemap.xml`. Google has no ping; this is how it learns about every page.
2. **Bing Webmaster Tools** → *Import from Google Search Console* (one click once step 1 is done). Bing's index is also used by DuckDuckGo, Yahoo and some AI search tools.
3. **Links from real places** (the biggest ranking factor you control): list the game on itch.io (free), CrazyGames / GameDistribution (see MONEY-PLAN.md), Nigerian forums such as Nairaland (one honest post, not spam), your YouTube/TikTok bios, and parent/teacher groups. Every place that links to `home.html` helps.

## Honest limits
- No tool can "push the page to everyone". SEO makes the pages findable and attractive; ranking comes from links, clicks and time. Expect weeks to months, not days.
- `github.io/compound-wahala` is a sub-folder of your account's site. A custom domain (e.g. `compoundwahala.com.ng` or `.com`, roughly $5–15/year) looks more trustworthy and keeps the rankings if you ever move hosts. **Costs money → only with your OK.** Everything above would carry over automatically (change `siteUrl`).
- Google stopped showing FAQ rich results for most sites in 2023; the FAQ still helps as page text and for AI answers.
- Keywords in `seo/site.json` are educated guesses, not measured search volumes. Search Console will show the real queries after a few weeks — update the titles then.

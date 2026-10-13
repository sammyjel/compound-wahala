# Growth system — how to run it

Everything here is free and runs on your PC. Nothing publishes, spends money or sends data until you switch it on.

## 1. Setup (once)

```bash
copy growth\.env.example growth\.env      # then edit: set ADMIN_TOKEN to a long random string
npm install
npm run build
npm run growth:server                      # http://127.0.0.1:8787/dashboard  and  /review
```

`growth/.env` is git-ignored. Never paste keys into code, chats or commits.

## 2. Your switches — `growth/config.json`

| Switch | Default | Meaning |
|---|---|---|
| `publishing.killSwitch` | **true** | Global stop for automated publishing. |
| `workflows.paused` | false | true = generate / publish / report all exit immediately. |
| `publishing.autoPublishRoutine` | false | true = drafts of series you marked `"approved": true` in `content/series.json` skip review. |
| `publishing.platforms.<p>.mode` | manual | `manual` = posting checklist; `api` = official API (YouTube only). |
| `spend.aiMonthlyLimitUSD` | 0 | Claude copywriting is off at 0 (free templates are used). |
| `spend.adsMonthlyLimitUSD` | 0 | These tools never buy ads. |

## 3. The workflows

| | Command | What it does |
|---|---|---|
| A · Content | `npm run growth:generate` | Plans the next 7 days (1 post/day, 19:00 Lagos as a starting guess), records **real gameplay** in a phone-shaped browser, cuts a 17–35 s vertical highlight with hook, honesty label, end card and the game's own music, writes titles/captions/hashtags/script/thumbnail/image concepts, validates (1080×1920, 8–60 s, audio, label, AI-art disclosure, no "true story" claims) and saves **drafts** to the review queue. Notifies you. |
| Review | http://127.0.0.1:8787/review | Watch each video, copy captions, **Approve / Reject**. After posting manually, paste the post URL → "Mark posted". |
| B · Publish | `npm run growth:publish` (`-- --dry` to preview) | Approved + valid items due in 24 h: YouTube via official API (when enabled) else **manual posting tasks** in `growth/content/tasks/` with exact steps. Never marks anything posted without a real URL. Retries temporary errors. |
| C · Report | `npm run growth:report` | Real numbers only: YouTube API, `growth/content/metrics.csv` (paste TikTok/IG/FB insights), game analytics per campaign. Writes `growth/content/reports/<date>.md`. |
| D · Suggest | `node growth/marketing/suggest.mjs` | Sends the report's suggestions (needs ≥3 posts and ≥300 views per group before suggesting anything). Never changes settings. |

The 7 series live in `growth/content/series.json` (hooks, beats, questions, hashtags — all from real gameplay).

### Scheduling
- **n8n (self-hosted, free):** `npx n8n`, then Import → `growth/n8n/*.json` (A–D). They use Execute Command, so n8n must run on this PC (n8n ≥ 2 needs `N8N_NODES_EXCLUDE="[]"`). Your n8n Cloud can't run local commands or reach 127.0.0.1. Imported workflows start **inactive**. *These JSON files were generated but not yet imported into an n8n instance — first import is the real test.*
- **Or Windows Task Scheduler:** `pwsh -File growth\schedule.ps1 -Install` (`-Remove` to undo).

### Notifications
Always written to `growth/content/INBOX.md`. For phone pushes: install the free **ntfy** app, subscribe to a private topic name, set `NOTIFY_WEBHOOK=https://ntfy.sh/<that-topic>`.

## 4. Analytics

- In the game: asks once, plainly; nothing is sent before "Yes" or when no endpoint is set. Anonymous random id, no names/IPs. Settings → turn off / **Delete my statistics data**.
- Server: `growth/analytics/worker.mjs` — the same code runs locally (SQLite) and on **Cloudflare Workers + D1 (free tier)**. Deploy steps are at the top of `growth/analytics/wrangler.toml` (needs your Cloudflare account). Then rebuild the game with
  `VITE_ANALYTICS_URL=https://<worker>.workers.dev npm run build` and redeploy.
- Dashboard: http://127.0.0.1:8787/dashboard (or point it at the Worker URL + admin token): DAU/WAU/MAU, new players, tutorial completion, sessions per player, D1/D7/D30 retention with sample sizes, level completion and drop-off, traffic sources/campaigns, ads/store events, money (measured vs estimate), recurring costs and spending limits, content pipeline.
- Campaign tracking: YouTube/Facebook captions carry `utm_campaign=<post id>`; TikTok/Instagram use the bio link `home.html?utm_source=tiktok&utm_campaign=bio`. The landing page forwards tags to the game.

## 5. YouTube API (optional)
Google Cloud → enable YouTube Data API v3 + YouTube Analytics API → OAuth client (Desktop) → put id/secret in `.env` → `node growth/marketing/youtube-auth.mjs` → set `platforms.youtube.mode` to `api`. Uploads are marked as containing synthetic media (AI character art). Decide `madeForKids` honestly in config (YouTube/COPPA rule). Quota ≈ 6 uploads/day. *Not yet tested against the real API (needs your credentials).*

## 6. Tests
`npm run growth:test` · `npm run growth:integration` · `npm run growth:store-e2e`

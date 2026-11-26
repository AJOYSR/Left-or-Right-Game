# Left or Right (PWA)

Odd or even. Low or high. Three seconds. Installable, works offline, with Daily challenges,
friend challenges, Hard mode, stats and server-checked leaderboards.

## Run it locally

```bash
python3 scripts/dev-server.py      # http://localhost:5173 (caching off, service worker allowed on localhost)
npm test                           # game-rule tests (node:test, no install needed)
```

## Deploy (Vercel)

```bash
npx vercel@latest login
npx vercel@latest --prod           # run inside this pwa/ folder
```

The app is plain static files (no build step). `vercel.json` sets the service-worker and security headers.

## How it fits together

| Part | Where | What it does |
|---|---|---|
| Game rules | `src/core.js` | Seeded questions, scoring, pause rules, replay. Shared by the app, the server and the tests. |
| App | `index.html`, `styles.css`, `src/main.js` | Screens, input, animations, sharing, install prompt. |
| Server client | `src/api.js`, `src/config.js` | Calls the `api` function; queues finished games while offline. |
| Offline | `sw.js`, `manifest.webmanifest`, `icons/` | Caches the app shell; installable on Android, iPhone and desktop. |
| Backend | `../supabase/functions/api/`, Supabase project `left-or-right` | Starts games (picks the seed), re-scores every finished game from its events, serves leaderboards. Tables are closed to browsers. |

**Changing the rules:** edit `src/core.js`, run `npm test`, then `npm run sync-server` and redeploy the
`api` function, so the app and server never disagree. Bump `VERSION` in `sw.js` on every release so
installed copies pick up the new files.

**Players** have no account: a nickname and a secret player code stored on the device. The code
(Stats → Play on another device) moves a player to a new phone.

## Security

- Browsers can't touch the database directly: the public key has no table or function privileges,
  and row-level security is on for every table. Everything goes through the `api` function.
- The server picks every game's questions, times it, and re-scores it from the answers. It rejects
  runs that finish faster than the clock allows, answers that are superhumanly fast or machine-steady,
  and replays or double submits. The database also refuses impossible scores.
- Daily questions come from a server secret (not the date), so they can't be worked out in advance.
- Limits: 5 new players per network per hour (20 a day), 40 game starts per player per 10 minutes,
  one nickname change per 10 minutes, 16 KB per request. Nicknames are unique and cleaned of
  invisible or look-alike characters.
- Player codes are 256-bit random secrets; only their SHA-256 hash is stored.
- The site sends a strict Content-Security-Policy, refuses to be framed, and forces HTTPS.

## Keep-alive

Supabase pauses free projects after a week with no activity. `api/keepalive.js` runs once a day
(Vercel cron, 18:00 UTC = 7am NZ, see `vercel.json`) and reads the leaderboard through the game API,
which queries the database. It only runs for Vercel's scheduler: the `CRON_SECRET` environment
variable in Vercel must match. Run it by hand with `npx vercel@latest crons run /api/keepalive`;
check it under the project's Logs in the Vercel dashboard.

## Link previews

Shared links show a picture on LinkedIn, X, WhatsApp, Slack and others:
- `/s/<gameId>`: that game's verified score card (`api/share.js` writes the preview tags,
  `api/og.js` draws the 1200×630 image from the game server's data, so it can't be faked).
- `/c/<code>`: a challenge invite ("Beat 3,416").
- The home page uses the general game preview (`/api/og`).
Social apps cache previews; to refresh one on LinkedIn, paste the link into
https://www.linkedin.com/post-inspector/.

## Players, progress and moderation

- **Play first:** new visitors get a guest player automatically ("Guest 4821") and a 4-step practice.
  After their first posted game, the results screen offers to save a nickname.
- **Streak freezes:** every 7 Dailies in a row earn a freeze (hold up to 2); a freeze covers one missed day.
- **Levels and badges:** every 10 points scored is 1 XP; 11 badges. Rules are in `src/core.js` (tested).
- **Daily reminders:** web push at 6 pm local time on days the Daily hasn't been played. The database
  calls the server every hour (`lor-reminders` cron job); keys for signing are made and kept server-side.
- **Error reports:** browsers send uncaught errors (max 5 per visit, rate-limited) to `client_errors`.
- **Admin page:** `/admin`, unlocked with `app_secrets.admin_key`: totals, remove/restore/rename players, recent errors.
- **Privacy:** `/privacy`. Players can delete themselves (Stats → Delete my player). Fonts are self-hosted.
- **Visitor counts:** Vercel Web Analytics (cookie-free). Enable it in the Vercel dashboard.

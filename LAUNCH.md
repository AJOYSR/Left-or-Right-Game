# Launching Left or Right

Drafts and steps for getting the first players. Nothing here has been posted.
Every post links to the game; each shared score link shows a score-card picture.

## Before you post

0. **Run a small closed playtest first** (5–10 people, a week): watch for confusion in practice, scores that
   don't post, and whether people come back for the Daily. Fix what they hit before posting publicly.

1. **Check the counts work.** The admin page (`/admin`) shows a 14-day funnel (visits, practice, games
   started and finished, scores that couldn't post). No outside analytics service is needed.
2. **Get a real domain (optional, about NZ$15–25 a year).** A name like `leftorright.app` or `oddevenlowhigh.com`
   is easier to remember and search than `left-or-right-peach.vercel.app`.
   - Buy it from any registrar (Cloudflare, Namecheap, Porkbun), or straight from Vercel → Domains.
   - Vercel → left-or-right → Settings → Domains → Add → follow the DNS steps it shows.
   - Then tell Claude the new address: the share links, previews, allowed origins and reminders need updating to it.
3. **Play a few Dailies yourself** so the leaderboard isn't empty when the first visitors arrive.
4. **Turn on reminders on your phone** (settings menu → Daily reminder) and check one arrives at 6 pm.

## Where to post

| Where | Why it fits | Notes |
|---|---|---|
| Reddit r/WebGames | Made for small browser games | Post the link with a one-line hook; reply to every comment |
| Reddit r/playmygame, r/IndieGaming | Feedback-friendly | Ask a question ("is 3 seconds too fast?") |
| itch.io | Players browse for small HTML games | Create a page with an "embed in page" or "external link" build |
| Product Hunt | Tech audience, one-day spike | Launch on a Tuesday–Thursday; prepare 3–4 screenshots |
| LinkedIn | Your own network | Share your Daily score card; keep the science claims light |
| Hacker News "Show HN" | Likes clean, no-signup web toys | Keep it plain and technical |

## Drafts

### Reddit (r/WebGames)
**Title:** Left or Right: odd or even, low or high, 3 seconds per answer (daily challenge, no sign-up)

> I made a tiny reflex game. A number appears and you swipe left or right: odd/even or low/high,
> and the question switches without warning. You have three seconds.
>
> There's a Daily (same 20 questions for everyone), challenge links that give a friend your exact
> questions, and a stats page that measures your "switch cost": how much slower you get when the rule changes.
> Works offline and installs on your phone.
>
> https://left-or-right-peach.vercel.app
>
> I'd love to hear if three seconds feels too generous or too harsh.

### LinkedIn
> I scored 3,452 on today's Left or Right Daily, a small game I built to test how fast you can switch between two simple rules.
>
> Odd or even? Low or high? Three seconds each. The twist is that the question changes without warning, and the stats page shows your "switch cost": how much slower you answer right after the rule changes. It's inspired by a classic task-switching experiment, but it's a game, not a test.
>
> Same 20 questions for everyone today. Can you beat it? 👇
> [paste your share link from the results screen: it shows your score card]

### Show HN
**Title:** Show HN: Left or Right – a 3-second task-switching game (PWA, no sign-up)

> A browser game inspired by the parity/magnitude task-switching paradigm. The server picks the questions and
> re-scores every run by replaying the answers, and rejects runs that are faster than the clock or machine-steady.
> Answer times still come from the browser, so it's "checked", not "cheat-proof"; there's a report button too.
> Installable PWA, works offline, daily seeded challenge, challenge links that share the exact question set.
> Stack: plain JS + Vercel + Supabase edge function.
>
> https://left-or-right-peach.vercel.app

### Product Hunt tagline (60 characters max)
> Odd or even. Low or high. Three seconds. Can you keep up?

## After launch

- Check the admin page (`/admin`) daily for odd nicknames and error reports. The key is in Supabase → Table editor → `app_secrets` → `admin_key`.
- Watch the funnel on the admin page: visits → practice → game started → game finished, and any "couldn't post".
- Next big feature planned: a 60-second time-attack mode.

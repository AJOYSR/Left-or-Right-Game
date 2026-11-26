# Launching Left or Right

Drafts and steps for getting the first players. Nothing here has been posted.
Every post links to the game; each shared score link shows a score-card picture.

## Before you post

1. **Turn on visitor counts.** Vercel dashboard → left-or-right → Analytics → Enable Web Analytics.
   (The game already loads the script; until this is on, it logs a harmless "not found" in the browser console.)
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
| LinkedIn | Your own network | Share your Daily score card; the brain-science angle works well |
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
> Odd or even? Low or high? Three seconds each. The twist is that the question changes without warning, and the stats page shows your "switch cost", the extra time your brain needs to swap rules. Psychologists use almost exactly this task to measure mental flexibility.
>
> Same 20 questions for everyone today. Can you beat it? 👇
> [paste your share link from the results screen: it shows your score card]

### Show HN
**Title:** Show HN: Left or Right – a 3-second task-switching game (PWA, no sign-up)

> A browser game built on the classic parity/magnitude task-switching paradigm. Every score is re-checked on
> the server by replaying the answers against the seed, so the leaderboard can't be faked by editing requests.
> Installable PWA, works offline, daily seeded challenge, challenge links that share the exact question set.
> Stack: plain JS + Vercel + Supabase edge function.
>
> https://left-or-right-peach.vercel.app

### Product Hunt tagline (60 characters max)
> Odd or even. Low or high. Three seconds. Can you keep up?

## After launch

- Check the admin page (`/admin`) daily for odd nicknames and error reports. The key is in Supabase → Table editor → `app_secrets` → `admin_key`.
- Watch Vercel Analytics: how many visitors start a game, and how many come back the next day.
- Next big feature planned: a 60-second time-attack mode.

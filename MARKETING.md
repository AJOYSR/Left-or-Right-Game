# Marketing Left or Right

How to get the first players: what to say, where to post, in what order, and how to tell whether it worked. Nothing here has been posted yet.

Game: https://left-or-right-peach.vercel.app

## What to say

**The hook.** The same number goes left one round and right the next, because the question changes. Lead every post with that, not with the tech.

**One line, for bios and short posts:**
> Odd or even. Low or high. The rule changes. Three seconds.

**Two lines, for the top of a post:**
> A number appears with one of two questions: odd or even, low or high. Left or right, three seconds, and the question can switch every round.

**Say:**
- No sign-up. It works on a phone and installs like an app.
- The same 20 Daily questions for everyone, so scores compare.
- A challenge link gives a friend your exact questions.
- After each game it tells you what tripped you up, for example "Low/High was your weaker rule".

**Don't say:**
- "Brain training" or "tests your mental flexibility". It's a game inspired by a task-switching experiment, not a test, and the claim invites pushback.
- "Can't be cheated" or "cheat-proof". The server re-scores every game, but answer times come from the player's device. Say "every score is checked by the server".
- "Viral", "addictive", "the best". Let players say it.

## Before posting publicly

1. **Run a closed playtest (5–10 people, about a week).** Send the link to friends or colleagues with two questions:
   - Did you play a second game straight away?
   - Did you come back for the next day's Daily?

   Watch them play if you can, and note where they hesitate in practice. Fix what more than one person hits.
2. **Check the numbers work.** Open `/admin` (the key is in Supabase → Table editor → `app_secrets` → `admin_key`). The 14-day table should show visits, practice, games started and finished, and scores that couldn't post.
3. **Fill the boards a little.** Play the Daily yourself for a few days, so the first visitors don't see an empty leaderboard.
4. **Test a reminder.** Settings menu → Daily reminder on your phone, and check one arrives at 6 pm on a day you haven't played.
5. **Optional: get a short domain (about NZ$15–25 a year).** A name like `leftorright.app` is easier to remember and type than `left-or-right-peach.vercel.app`.
   - Buy it from any registrar, or in Vercel → Domains.
   - Vercel → left-or-right → Settings → Domains → Add, then follow the DNS steps it shows.
   - Then ask Claude to update the share links, previews, allowed addresses and reminders to the new address.

## Where to post, in order

Space the posts out: one channel a day at most, so you can reply to everyone and see which one brings players.

| # | Where | Why | When |
|---|---|---|---|
| 1 | Closed playtest | Find problems while it's quiet | Week 1 |
| 2 | Reddit r/WebGames | Made for small browser games | Week 2, day 1 |
| 3 | Reddit r/playmygame | People there expect to give feedback | Day 2 or 3 |
| 4 | Hacker News "Show HN" | Likes small, no-signup web projects with honest technical notes | A weekday, early morning US time |
| 5 | LinkedIn | Your own network; the Daily score card works as a post | After the Reddit posts settle |
| 6 | itch.io | People browse it for HTML games; the page keeps bringing visitors | Any time, once |
| 7 | Reddit r/IndieGaming | Needs a short video to stand out | When you have a 15–20 s clip |
| 8 | Product Hunt | One busy day with a tech audience | Only after there are real players and the playtest fixes are in |

Read each subreddit's rules before posting. Some only allow self-promotion on certain days or ask for a flair.

## Titles and posts

### Reddit: r/WebGames

**Title:**
> Left or Right: odd or even, low or high, 3 seconds per answer. The rule changes without warning.

**Post:**
> I made a small reflex game. A number from 1 to 9 appears with a question, odd or even or low or high, and you go left or right. The catch is that the question can switch every round, so the same 2 is "right" for even and "left" for low.
>
> There's a Daily (the same 20 questions for everyone), challenge links that give a friend your exact questions, and a results screen that tells you what tripped you up. No sign-up, works on phones.
>
> https://left-or-right-peach.vercel.app
>
> Is 3 seconds too generous or too harsh?

### Reddit: r/playmygame

**Title:**
> I made a 3-second reflex game where the same number goes left or right depending on the rule. Looking for feedback on difficulty.

**Post:**
> The rules take one sentence: odd or low goes left, even or high goes right, and the question changes without warning. There's a short practice first.
>
> What I'd like to know:
> - Did the practice make the twist clear?
> - Is Hard mode (shrinking clock, number words, swapped sides) fair or frustrating?
> - Did you want a second game?
>
> https://left-or-right-peach.vercel.app

### Hacker News

**Title** (keep the "Show HN:" prefix):
> Show HN: Left or Right – a 3-second task-switching game (no sign-up, works offline)

**Text:**
> Left or Right is a small browser game inspired by the parity/magnitude task-switching experiment: a number appears with "odd or even?" or "low or high?", and you answer left or right within three seconds while the question switches.
>
> It's plain JavaScript with no framework, a service worker for offline play, and a Supabase Edge Function as the only way to read or write data. The server picks each game's questions and re-scores every run by replaying the answers, rejecting runs faster than the clock allows or with machine-even timing. Answer times still come from the browser, so this makes casual cheating hard but doesn't prove a score; there's a report button for the rest.
>
> A finished game is written to the device before it's sent and retried until the server answers, so a dropped connection doesn't lose a score.
>
> https://left-or-right-peach.vercel.app

Stay in the thread for the first two hours and answer questions plainly, including about what doesn't work.

### LinkedIn

Play the Daily first, then share it from the results screen with "Share score", so the link preview shows your score card.

> I built a game that's harder than it looks.
>
> A number appears with a question: odd or even, low or high. Left or right, three seconds each. The twist is that the question changes without warning, so the same number goes left one round and right the next.
>
> I scored [your score] on today's Daily. Everyone gets the same 20 questions today. Can you beat it?
>
> [your score link]

Replace the two bracketed parts with your real score and link before posting.

### itch.io

- **Title:** Left or Right
- **Short description:** Odd or even. Low or high. The rule changes. Three seconds.
- **Kind:** HTML, "external link" to the game.
- **Tags:** reflex, puzzle, casual, daily, mobile, brain-teaser, minimalist
- **Screenshots:** `docs/screenshots/home.png`, `game.png`, `results.png`.

### Product Hunt

- **Name:** Left or Right
- **Tagline** (60 characters max): Odd or even. Low or high. The rule changes. Three seconds.
- **First comment:** what it is in two sentences, why you made it, and one question for readers (for example, which mode they'd want next).
- Launch Tuesday to Thursday. Use the three screenshots and a short screen recording.

### Short video (for r/IndieGaming, X, TikTok, Reels)

Record 15–20 seconds of real play on a phone. Show a few fast rounds, one rule switch where the same number goes the other way, a miss, and the results screen with the takeaway. Caption: "Same number. Different rule. Different side."

## How to post so it works

- Lead with the twist, then the link.
- Share Daily score links rather than the bare site. The preview shows a score, and everyone that day plays the same questions, so the replies turn into a scoreboard.
- Ask one real question in every post, about difficulty, the 3-second clock or Hard mode. People answer questions.
- Reply to every comment on the first day. Thank people for criticism and fix the cheap things the same week.
- Don't repost the same text across many subreddits on one day; it reads as spam and gets removed.

## Measuring it

Open `/admin` the day after each post and compare with the day before:

| Row in the admin table | What it tells you |
|---|---|
| Visits | How many people the post brought |
| Practice started vs Practice finished | Whether the practice holds people or loses them |
| Classic / Daily started | Whether people get past the home screen |
| Games posted | Finished games that reached the leaderboard |
| Post retried / Post failed | Connection problems players hit |
| Score link opened, Invite opened | Whether sharing brings new players |

The numbers that matter most are how many visitors finish a second game, and how many come back for the next Daily. If one channel brings visitors who don't finish a game, change the hook for that channel rather than posting more.

## After the first week

- Check `/admin` daily for odd nicknames, reports and error reports.
- Note what players asked for, and pick one thing to build next.
- Post again only with something new: a feature, a fixed complaint, or an interesting Daily result.

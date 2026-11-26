-- Fixes from the production-readiness audit.

-- 1. Deleting a player no longer deletes the challenges they created (friends keep their results).
alter table public.challenges alter column created_by drop not null;
alter table public.challenges drop constraint challenges_created_by_fkey;
alter table public.challenges add constraint challenges_created_by_fkey
  foreign key (created_by) references public.players(id) on delete set null;

-- 2. Every run records which version of the rules generated its questions.
alter table public.games add column if not exists rules_version int not null default 1 check (rules_version between 1 and 9);
alter table public.challenges add column if not exists rules_version int not null default 1 check (rules_version between 1 and 9);

-- 3. Reminders use a real time-zone name, so daylight saving is handled.
alter table public.push_subscriptions add column if not exists tz text check (tz is null or char_length(tz) between 1 and 64);
alter table public.push_subscriptions add column if not exists fail_count int not null default 0;

-- 4. Where did this run place, and out of how many?
create or replace function public.run_placement(p_game uuid)
returns table (place int, total int)
language plpgsql stable set search_path = public as $$
declare g games%rowtype;
begin
  select * into g from games where id = p_game and status = 'finished';
  if not found then return; end if;
  if g.mode = 'classic' then
    return query
      with best as (
        select distinct on (x.player_id) x.player_id, x.score, x.avg_ms
        from games x join players p on p.id = x.player_id and not p.banned
        where x.mode = 'classic' and x.status = 'finished' and x.rounds = g.rounds and x.hard = g.hard
        order by x.player_id, x.score desc, x.avg_ms asc nulls last
      )
      select (1 + count(*) filter (where b.player_id <> g.player_id and
               (b.score > g.score or (b.score = g.score and coalesce(b.avg_ms, 99999) < coalesce(g.avg_ms, 99999)))))::int,
             (count(*) + case when bool_or(b.player_id = g.player_id) then 0 else 1 end)::int
      from best b;
  else
    return query
      select (1 + count(*) filter (where x.id <> g.id and
               (x.score > g.score or (x.score = g.score and coalesce(x.avg_ms, 99999) < coalesce(g.avg_ms, 99999)))))::int,
             count(*)::int
      from games x join players p on p.id = x.player_id and not p.banned
      where x.mode = g.mode and x.status = 'finished'
        and (g.mode <> 'daily' or x.day = g.day)
        and (g.mode <> 'challenge' or x.code = g.code);
  end if;
end $$;

-- 5. Lifetime totals over every finished game, so levels and badges never go backwards.
create or replace function public.player_lifetime(p_player uuid)
returns table (games int, total_score bigint, perfect int, hard_perfect int, fastest_ms int,
               marathon int, challenges int, best_streak int, dailies int)
language sql stable set search_path = public as $$
  select count(*)::int,
         coalesce(sum(score), 0)::bigint,
         (count(*) filter (where correct = rounds))::int,
         (count(*) filter (where correct = rounds and hard))::int,
         min(avg_ms) filter (where correct >= rounds * 0.8)::int,
         (count(*) filter (where rounds = 50))::int,
         (count(*) filter (where mode = 'challenge'))::int,
         coalesce(max(best_streak), 0)::int,
         (count(*) filter (where mode = 'daily'))::int
  from games where player_id = p_player and status = 'finished';
$$;

-- 6. Privacy-friendly product counts: one number per event name per day, no user ids.
create table if not exists public.events_daily (
  day date not null,
  name text not null check (name ~ '^[a-z_]{2,32}$'),
  n int not null default 0,
  primary key (day, name)
);
alter table public.events_daily enable row level security;
revoke all on public.events_daily from anon, authenticated;

create or replace function public.bump_events(p_names text[])
returns void language sql volatile set search_path = public as $$
  insert into events_daily (day, name, n)
  select (now() at time zone 'utc')::date, nm, count(*) from unnest(p_names) nm group by nm
  on conflict (day, name) do update set n = events_daily.n + excluded.n;
$$;

-- 7. Players can report a nickname on a leaderboard.
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.players(id) on delete set null,
  target_id uuid not null references public.players(id) on delete cascade,
  reason text not null check (reason in ('name', 'score', 'other')),
  note text check (note is null or char_length(note) <= 200),
  status text not null default 'open' check (status in ('open', 'done')),
  created_at timestamptz not null default now(),
  unique (reporter_id, target_id)
);
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;

revoke all on function public.run_placement(uuid), public.player_lifetime(uuid), public.bump_events(text[]) from public, anon, authenticated;
grant execute on function public.run_placement(uuid), public.player_lifetime(uuid), public.bump_events(text[]) to service_role;

-- Old event counts are not needed forever.
select cron.schedule('lor-cleanup-events', '17 3 * * *',
  $$delete from public.events_daily where day < (now() at time zone 'utc')::date - 400;
    delete from public.reports where status = 'done' and created_at < now() - interval '90 days';$$);

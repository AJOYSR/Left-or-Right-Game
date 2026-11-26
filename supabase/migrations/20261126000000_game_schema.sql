-- Applied to Supabase project `left-or-right` (tnpsckkmlmmozpzkwsly) on 2026-11-26.
-- Players have no account: a random secret token lives on their device; we keep only its hash.
create table public.players (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  nickname text not null check (char_length(nickname) between 2 and 20),
  created_at timestamptz not null default now()
);

create table public.challenges (
  code text primary key check (code ~ '^[a-z0-9]{6}-(15|20|30|50)(-h)?$'),
  seed text not null,
  rounds int not null check (rounds in (15, 20, 30, 50)),
  hard boolean not null default false,
  created_by uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Every game is started by the server (it picks or fixes the seed) and scored by the server on finish.
create table public.games (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  mode text not null check (mode in ('classic', 'daily', 'challenge')),
  seed text not null,
  rounds int not null check (rounds in (15, 20, 30, 50)),
  hard boolean not null default false,
  day date,
  code text references public.challenges(code) on delete cascade,
  status text not null default 'open' check (status in ('open', 'finished', 'rejected')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score int, correct int, avg_ms int, best_streak int, pauses int, sw_ms int, rep_ms int,
  par_right int, par_total int, size_right int, size_total int,
  reject_reason text,
  check ((mode = 'daily') = (day is not null)),
  check ((mode = 'challenge') = (code is not null))
);

create unique index games_one_daily on public.games (player_id, day) where mode = 'daily';
create unique index games_one_challenge on public.games (player_id, code) where mode = 'challenge';
create index games_board on public.games (rounds, hard, score desc) where mode = 'classic' and status = 'finished';
create index games_daily on public.games (day, score desc) where mode = 'daily' and status = 'finished';
create index games_player on public.games (player_id, finished_at desc);
create index challenges_created_by on public.challenges (created_by);
create index games_code on public.games (code) where code is not null;

-- Closed to the browser; the `api` function uses the service role and returns only public fields.
alter table public.players enable row level security;
alter table public.challenges enable row level security;
alter table public.games enable row level security;

create or replace function public.board_classic(p_rounds int, p_hard boolean, p_since timestamptz)
returns table (player_id uuid, nickname text, score int, correct int, avg_ms int)
language sql stable set search_path = public as $$
  select b.player_id, p.nickname, b.score, b.correct, b.avg_ms from (
    select distinct on (g.player_id) g.player_id, g.score, g.correct, g.avg_ms
    from games g
    where g.mode = 'classic' and g.status = 'finished' and g.rounds = p_rounds and g.hard = p_hard
      and (p_since is null or g.finished_at >= p_since)
    order by g.player_id, g.score desc, g.avg_ms asc nulls last
  ) b join players p on p.id = b.player_id
  order by b.score desc, b.avg_ms asc nulls last
  limit 100;
$$;

create or replace function public.board_daily(p_day date)
returns table (player_id uuid, nickname text, score int, correct int, avg_ms int)
language sql stable set search_path = public as $$
  select g.player_id, p.nickname, g.score, g.correct, g.avg_ms
  from games g join players p on p.id = g.player_id
  where g.mode = 'daily' and g.day = p_day and g.status = 'finished'
  order by g.score desc, g.avg_ms asc nulls last
  limit 100;
$$;

create or replace function public.board_challenge(p_code text)
returns table (player_id uuid, nickname text, score int, correct int, avg_ms int)
language sql stable set search_path = public as $$
  select g.player_id, p.nickname, g.score, g.correct, g.avg_ms
  from games g join players p on p.id = g.player_id
  where g.mode = 'challenge' and g.code = p_code and g.status = 'finished'
  order by g.score desc, g.avg_ms asc nulls last
  limit 100;
$$;

revoke all on function public.board_classic(int, boolean, timestamptz) from public, anon, authenticated;
revoke all on function public.board_daily(date) from public, anon, authenticated;
revoke all on function public.board_challenge(text) from public, anon, authenticated;
grant execute on function public.board_classic(int, boolean, timestamptz) to service_role;
grant execute on function public.board_daily(date) to service_role;
grant execute on function public.board_challenge(text) to service_role;

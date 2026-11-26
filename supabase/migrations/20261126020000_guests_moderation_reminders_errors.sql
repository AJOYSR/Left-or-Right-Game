-- Applied to Supabase project `left-or-right` (tnpsckkmlmmozpzkwsly) on 2026-11-26.
-- Guests (play first, pick a name later) and moderation.
alter table public.players add column is_guest boolean not null default false,
                           add column banned boolean not null default false;

-- Leaderboards skip banned players.
create or replace function public.board_classic(p_rounds int, p_hard boolean, p_since timestamptz)
returns table (player_id uuid, nickname text, score int, correct int, avg_ms int)
language sql stable set search_path = public as $$
  select b.player_id, p.nickname, b.score, b.correct, b.avg_ms from (
    select distinct on (g.player_id) g.player_id, g.score, g.correct, g.avg_ms
    from games g
    where g.mode = 'classic' and g.status = 'finished' and g.rounds = p_rounds and g.hard = p_hard
      and (p_since is null or g.finished_at >= p_since)
    order by g.player_id, g.score desc, g.avg_ms asc nulls last
  ) b join players p on p.id = b.player_id and not p.banned
  order by b.score desc, b.avg_ms asc nulls last
  limit 100;
$$;
create or replace function public.board_daily(p_day date)
returns table (player_id uuid, nickname text, score int, correct int, avg_ms int)
language sql stable set search_path = public as $$
  select g.player_id, p.nickname, g.score, g.correct, g.avg_ms
  from games g join players p on p.id = g.player_id and not p.banned
  where g.mode = 'daily' and g.day = p_day and g.status = 'finished'
  order by g.score desc, g.avg_ms asc nulls last
  limit 100;
$$;
create or replace function public.board_challenge(p_code text)
returns table (player_id uuid, nickname text, score int, correct int, avg_ms int)
language sql stable set search_path = public as $$
  select g.player_id, p.nickname, g.score, g.correct, g.avg_ms
  from games g join players p on p.id = g.player_id and not p.banned
  where g.mode = 'challenge' and g.code = p_code and g.status = 'finished'
  order by g.score desc, g.avg_ms asc nulls last
  limit 100;
$$;
revoke all on function public.board_classic(int, boolean, timestamptz), public.board_daily(date), public.board_challenge(text) from public, anon, authenticated;
grant execute on function public.board_classic(int, boolean, timestamptz), public.board_daily(date), public.board_challenge(text) to service_role;

-- Daily reminder notifications (web push).
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and char_length(endpoint) < 1000),
  p256dh text not null check (char_length(p256dh) < 200),
  auth text not null check (char_length(auth) < 100),
  tz_offset_min int not null default 0 check (tz_offset_min between -840 and 840),
  remind_hour int not null default 18 check (remind_hour between 0 and 23),
  last_sent_day date,
  created_at timestamptz not null default now()
);
create index push_subscriptions_player on public.push_subscriptions (player_id);

-- Errors reported by players' browsers, so problems are visible.
create table public.client_errors (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  player_id uuid references public.players(id) on delete set null,
  message text not null check (char_length(message) <= 500),
  stack text check (char_length(stack) <= 2000),
  url text check (char_length(url) <= 300),
  ua text check (char_length(ua) <= 300),
  ip_hash text
);
create index client_errors_recent on public.client_errors (at desc);
create index client_errors_ip on public.client_errors (ip_hash, at);
create index client_errors_player on public.client_errors (player_id);

alter table public.push_subscriptions enable row level security;
alter table public.client_errors enable row level security;
revoke all on public.push_subscriptions, public.client_errors from anon, authenticated, public;

-- Keys only the server knows: the admin page key and the key the scheduler uses.
insert into public.app_secrets (key, value) values
  ('admin_key', encode(extensions.gen_random_bytes(24), 'hex')),
  ('cron_key', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

-- Every hour, ask the server to send reminders to players whose local reminder hour it is.
create extension if not exists pg_net;
select cron.schedule('lor-reminders', '2 * * * *', $$
  select net.http_post(
    url := 'https://tnpsckkmlmmozpzkwsly.supabase.co/functions/v1/api',
    headers := jsonb_build_object('content-type', 'application/json',
                                  'x-cron-key', (select value from public.app_secrets where key = 'cron_key')),
    body := '{"action":"sendReminders"}'::jsonb
  );
$$);

select cron.schedule('lor-cleanup-errors', '23 3 * * *', $$
  delete from public.client_errors where at < now() - interval '30 days';
$$);

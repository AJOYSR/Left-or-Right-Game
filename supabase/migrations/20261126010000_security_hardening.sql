-- Applied to Supabase project `left-or-right` (tnpsckkmlmmozpzkwsly) on 2026-11-26.
-- 1. Defence in depth: browsers' roles get no table access at all (RLS already blocks them).
revoke all on public.players, public.challenges, public.games from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;

-- 2. Nicknames are unique ignoring case, so nobody can pose as another player.
alter table public.players add column nickname_key text generated always as (lower(nickname)) stored;
create unique index players_nickname_key on public.players (nickname_key);

-- 3. For rate limits: a salted hash of the sign-up IP (never the IP itself) and rename throttling.
alter table public.players add column ip_hash text, add column renamed_at timestamptz;
create index players_ip_recent on public.players (ip_hash, created_at);
create index games_player_recent on public.games (player_id, started_at);

-- 4. Server-only secrets (Daily seeds, IP salt). Closed to every browser role.
create table public.app_secrets (key text primary key, value text not null);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated, public;
insert into public.app_secrets (key, value) values
  ('daily_secret', encode(extensions.gen_random_bytes(32), 'hex')),
  ('ip_salt', encode(extensions.gen_random_bytes(32), 'hex'));

-- 5. Score sanity enforced by the database itself, whatever code writes the row.
alter table public.games
  add constraint games_score_range check (score is null or (score >= 0 and score <= rounds * 250)),
  add constraint games_correct_range check (correct is null or (correct >= 0 and correct <= rounds)),
  add constraint games_pauses_range check (pauses is null or (pauses between 0 and 3)),
  add constraint games_finished_has_score check (status <> 'finished' or (score is not null and finished_at is not null));

-- 6. Housekeeping: abandoned games and old rejected attempts are removed nightly.
create extension if not exists pg_cron;
select cron.schedule('lor-cleanup', '17 3 * * *', $$
  delete from public.games where status = 'open' and mode = 'classic' and started_at < now() - interval '2 days';
  delete from public.games where status = 'rejected' and finished_at < now() - interval '30 days';
$$);

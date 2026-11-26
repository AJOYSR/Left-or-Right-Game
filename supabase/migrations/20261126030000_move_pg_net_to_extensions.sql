-- Applied 2026-11-26: keep the pg_net extension out of the public schema (Supabase advisor).
drop extension if exists pg_net;
create extension pg_net with schema extensions;

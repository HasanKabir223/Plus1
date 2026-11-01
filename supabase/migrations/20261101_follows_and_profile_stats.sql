-- ==============================================================================
-- Migration: 20261101_follows_and_profile_stats
-- Purpose: Add public.follows table with RLS and public.profile_stats view
-- ==============================================================================

-- 1. Create public.follows table
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  following_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self_follow check (follower_id <> following_id)
);

-- 2. Index on following_id for fast reverse lookups and follower counting
create index if not exists follows_following_idx on public.follows (following_id);

-- 3. Enable Row Level Security on public.follows
alter table public.follows enable row level security;

-- 4. RLS Policies on public.follows
drop policy if exists "follows readable by logged in users" on public.follows;
create policy "follows readable by logged in users"
  on public.follows for select
  to authenticated, anon
  using (true);

drop policy if exists "follow as yourself" on public.follows;
create policy "follow as yourself"
  on public.follows for insert
  to authenticated
  with check ((select auth.uid()) = follower_id);

drop policy if exists "unfollow as yourself" on public.follows;
create policy "unfollow as yourself"
  on public.follows for delete
  to authenticated
  using ((select auth.uid()) = follower_id);

-- 5. Create public.profile_stats view with security_invoker = true
drop view if exists public.profile_stats;
create view public.profile_stats
with (security_invoker = true) as
select
  p.id as profile_id,
  (select count(*) from public.agents a where a.owner_id = p.id)::int as agent_count,
  (select count(*) from public.follows f where f.following_id = p.id)::int as follower_count,
  (select count(*) from public.follows f where f.follower_id  = p.id)::int as following_count
from public.profiles p;

-- 6. Grant permissions on follows and profile_stats
grant select on public.follows to authenticated, anon;
grant select on public.profile_stats to authenticated, anon;

-- 7. Force PostgREST to immediately refresh its schema cache
notify pgrst, 'reload schema';


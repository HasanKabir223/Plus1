-- Migration: 20261029_003_profiles_rls
-- Ensure RLS is enabled
alter table public.profiles enable row level security;

-- Drop all old policies
drop policy if exists "Profiles are viewable by authenticated users" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "profiles_select_authenticated" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;

-- Rule 1 (SELECT): any authenticated user can read public profiles
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- Rule 2 (INSERT): user can only insert their own row
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

-- Rule 3 (UPDATE): user can only update their own row
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

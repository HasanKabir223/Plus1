-- Migration: 20261031_account_deletion
-- Enables self-service account and profile deletion with proper RLS and cascade

-- Step 1: Ensure RLS is enabled on public.profiles
alter table public.profiles enable row level security;

-- Step 2: Add RLS policy allowing authenticated users to delete their own profile
drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own"
  on public.profiles for delete
  to authenticated
  using ((select auth.uid()) = id);

-- Step 3: Ensure delete cascades from auth.users to public.profiles
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles
  add constraint profiles_id_fkey
  foreign key (id)
  references auth.users(id)
  on delete cascade;

-- Step 4: Optional RPC function for secure deletion of auth.users from authenticated context
create or replace function public.delete_current_user()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_current_user() from public;
grant execute on function public.delete_current_user() to authenticated;


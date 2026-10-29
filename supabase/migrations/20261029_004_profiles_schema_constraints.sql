-- Migration: 20261029_004_profiles_schema_constraints
-- Ensures public.profiles table matches the required constraints:
-- 1. id references auth.users(id) on delete cascade
-- 2. username is nullable initially, unique, lowercase check, and matches ^[a-z0-9_]{3,20}$ when present
-- 3. profilename and handle are nullable initially

-- Step 1: Ensure columns are nullable so auto-insert trigger with just (id) succeeds
alter table public.profiles alter column username drop not null;
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'handle') then
    alter table public.profiles alter column handle drop not null;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'profilename') then
    alter table public.profiles alter column profilename drop not null;
  end if;
end $$;

-- Step 2: Clean up any orphaned profiles that no longer exist in auth.users
-- (PostgreSQL blocks adding a foreign key if orphaned IDs exist in public.profiles)
delete from public.profiles
where id not in (select id from auth.users);

-- Step 3: Add foreign key constraint to auth.users(id) on delete cascade
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.profiles
  add constraint profiles_id_fkey
  foreign key (id)
  references auth.users(id)
  on delete cascade;

-- Step 4: Lowercase & format check constraint for username
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'profiles'
      and constraint_name = 'profiles_username_format_check'
  ) then
    alter table public.profiles
      add constraint profiles_username_format_check
      check (username is null or (username = lower(username) and username ~ '^[a-z0-9_]{3,20}$'));
  end if;
end $$;

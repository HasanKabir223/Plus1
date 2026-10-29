-- Migration: 20261029_001_backfill_profiles
-- Backfill: create a profile row for every auth.users entry missing one.
-- username and handle are left NULL so the app's onboarding guard
-- will redirect these users to /onboarding.
insert into public.profiles (id)
select u.id from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);

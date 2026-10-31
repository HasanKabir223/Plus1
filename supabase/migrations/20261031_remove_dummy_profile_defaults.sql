-- ==============================================================================
-- Migration: 20261031_remove_dummy_profile_defaults
-- Purpose: Remove hardcoded 'New Member' and 'user_xxxx' defaults.
-- Ensures un-onboarded profiles remain with NULL username/profilename
-- until explicitly submitted via /onboarding.
-- ==============================================================================

-- 1. Ensure username and profilename columns are nullable in public.profiles
ALTER TABLE public.profiles ALTER COLUMN username DROP NOT NULL;
ALTER TABLE public.profiles ALTER COLUMN profilename DROP NOT NULL;

-- 2. Nullify dummy usernames and 'New Member' display names for un-onboarded profiles
UPDATE public.profiles
SET username = NULL
WHERE username ~* '^user_[a-f0-9]{8}$' OR LOWER(TRIM(username)) LIKE 'user_%';

UPDATE public.profiles
SET profilename = NULL
WHERE LOWER(TRIM(profilename)) = 'new member';

-- 3. Replace handle_new_user trigger function to never insert dummy fallbacks
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, profilename)
  VALUES (
    NEW.id,
    NULLIF(TRIM(NEW.raw_user_meta_data->>'username'), ''),
    NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'profilename', NEW.raw_user_meta_data->>'name')), '')
  )
  ON CONFLICT (id) DO UPDATE SET
    username = COALESCE(public.profiles.username, EXCLUDED.username),
    profilename = COALESCE(public.profiles.profilename, EXCLUDED.profilename);
  RETURN NEW;
END;
$$;

-- 4. Re-attach trigger idempotently
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

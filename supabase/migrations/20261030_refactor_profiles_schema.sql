
-- ==============================================================================
-- Migration: Refactor public.profiles to use username (unique) and profilename
-- ==============================================================================

-- 1. Ensure profilename column exists
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS profilename text;

-- 2. Backfill profilename from existing username if profilename is null
UPDATE public.profiles 
SET profilename = COALESCE(profilename, username, 'Member') 
WHERE profilename IS NULL;

-- 3. If handle exists, copy handle to username (preserving unique slugs), then drop handle
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'profiles' 
      AND column_name = 'handle'
  ) THEN
    UPDATE public.profiles 
    SET username = handle 
    WHERE handle IS NOT NULL AND handle != '';
    
    ALTER TABLE public.profiles DROP COLUMN handle CASCADE;
  END IF;
END $$;

-- 4. Enforce username constraints (not null, unique)
ALTER TABLE public.profiles ALTER COLUMN username SET NOT NULL;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_username_key;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_username_key UNIQUE (username);

-- 5. Update handle_new_user trigger function to use username and profilename
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, profilename)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'username',
      'user_' || SUBSTR(REPLACE(NEW.id::text, '-', ''), 1, 8)
    ),
    COALESCE(
      NEW.raw_user_meta_data->>'profilename',
      NEW.raw_user_meta_data->>'name',
      'New Member'
    )
  )
  ON CONFLICT (id) DO UPDATE SET
    username = EXCLUDED.username,
    profilename = EXCLUDED.profilename;
  RETURN NEW;
END;
$$;

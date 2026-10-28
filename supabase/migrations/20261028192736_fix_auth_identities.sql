-- Fix auth.identities for seed users and ensure handle_new_user trigger is bound
DO $$
BEGIN
  -- Insert missing identities for any users in auth.users
  INSERT INTO auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, provider_id)
  SELECT
    gen_random_uuid(),
    id,
    json_build_object('sub', id::text, 'email', email)::jsonb,
    'email',
    NOW(),
    NOW(),
    NOW(),
    id::text
  FROM auth.users
  WHERE id NOT IN (SELECT user_id FROM auth.identities)
  ON CONFLICT DO NOTHING;
EXCEPTION
  WHEN undefined_column THEN
    -- Fallback if provider_id column does not exist
    INSERT INTO auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    SELECT
      gen_random_uuid(),
      id,
      json_build_object('sub', id::text, 'email', email)::jsonb,
      'email',
      NOW(),
      NOW(),
      NOW()
    FROM auth.users
    WHERE id NOT IN (SELECT user_id FROM auth.identities)
    ON CONFLICT DO NOTHING;
END $$;

-- Ensure handle_new_user function has search_path set and trigger is active
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, auth, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, username, handle)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', NEW.raw_user_meta_data->>'name', 'New Member'),
    COALESCE(NEW.raw_user_meta_data->>'handle', NEW.raw_user_meta_data->>'username', 'user_' || SUBSTR(REPLACE(NEW.id::text, '-', ''), 1, 8))
  )
  ON CONFLICT (id) DO UPDATE SET
    username = EXCLUDED.username,
    handle = EXCLUDED.handle;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Ensure all existing auth.users have a corresponding public.profiles entry
INSERT INTO public.profiles (id, username, handle)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'username', u.raw_user_meta_data->>'name', 'New Member'),
  COALESCE(u.raw_user_meta_data->>'handle', u.raw_user_meta_data->>'username', 'user_' || SUBSTR(REPLACE(u.id::text, '-', ''), 1, 8))
FROM auth.users u
WHERE u.id NOT IN (SELECT id FROM public.profiles)
ON CONFLICT (id) DO NOTHING;

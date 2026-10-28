-- 1. Drop foreign key constraint on profiles.id referencing auth.users(id) so mock/seed profiles can exist safely
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;

-- 2. Remove corrupted manual seed records from auth.identities and auth.users
DELETE FROM auth.identities WHERE user_id IN (
  SELECT id FROM auth.users WHERE email LIKE '%@plus1.network' OR id::text LIKE '00000000-%'
);

DELETE FROM auth.users WHERE email LIKE '%@plus1.network' OR id::text LIKE '00000000-%';

-- Rename 'name' to 'username' on public.profiles for professionalism
ALTER TABLE public.profiles RENAME COLUMN name TO username;

-- Update trigger function to populate username on user creation
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, handle)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', new.raw_user_meta_data->>'name', 'New Member'),
    coalesce(new.raw_user_meta_data->>'handle', new.raw_user_meta_data->>'username', 'user_' || substr(replace(new.id::text, '-', ''), 1, 8))
  )
  on conflict (id) do update set
    username = excluded.username,
    handle = excluded.handle;
  return new;
end;
$$ language plpgsql security definer;

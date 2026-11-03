-- ==============================================================================
-- Migration: 20261104_likes_and_comments
-- Purpose: Like/comment counters on posts, one-level comment depth rule,
--          post_likes table with RLS, count-keeping triggers, backfill.
--          Apply manually (Supabase SQL editor or `supabase db push`).
--          Depends on: 20261102_posts_schema_and_rls.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Denormalized counters on posts (maintained by triggers below)
-- ------------------------------------------------------------------------------
alter table public.posts
  add column if not exists like_count int not null default 0,
  add column if not exists reply_count int not null default 0;

-- ------------------------------------------------------------------------------
-- 2. Deleting a post must delete its comments (not orphan them into the feed)
-- ------------------------------------------------------------------------------
alter table public.posts
  drop constraint if exists posts_parent_id_fkey;
alter table public.posts
  add constraint posts_parent_id_fkey
  foreign key (parent_id) references public.posts(id) on delete cascade;

-- ------------------------------------------------------------------------------
-- 3. One level deep only: a comment's parent must be a top-level post
-- ------------------------------------------------------------------------------
create or replace function public.posts_enforce_depth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_parent uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  select parent_id into v_parent_parent
  from public.posts
  where id = new.parent_id;

  if not found then
    raise exception 'comment parent post % does not exist', new.parent_id
      using errcode = '23503';
  end if;

  if v_parent_parent is not null then
    raise exception 'comments can only be added to top-level posts'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.posts_enforce_depth() from public;

drop trigger if exists posts_enforce_depth_trg on public.posts;
create trigger posts_enforce_depth_trg
  before insert on public.posts
  for each row
  execute function public.posts_enforce_depth();

-- ------------------------------------------------------------------------------
-- 4. One comment per agent per post (humans are not limited here)
-- ------------------------------------------------------------------------------
create unique index if not exists posts_one_agent_comment_idx
  on public.posts (parent_id, author_agent_id)
  where parent_id is not null and author_agent_id is not null;

-- ------------------------------------------------------------------------------
-- 5. post_likes: exactly one liker (human profile XOR agent)
-- ------------------------------------------------------------------------------
create table if not exists public.post_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  liker_profile_id uuid references public.profiles(id) on delete cascade,
  liker_agent_id uuid references public.agents(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint post_likes_exactly_one_liker_check
    check (num_nonnulls(liker_profile_id, liker_agent_id) = 1)
);

create unique index if not exists post_likes_one_human_idx
  on public.post_likes (post_id, liker_profile_id)
  where liker_profile_id is not null;
create unique index if not exists post_likes_one_agent_idx
  on public.post_likes (post_id, liker_agent_id)
  where liker_agent_id is not null;
create index if not exists post_likes_post_id_idx
  on public.post_likes (post_id);
create index if not exists post_likes_liker_profile_idx
  on public.post_likes (liker_profile_id, post_id);

-- ------------------------------------------------------------------------------
-- 6. Count triggers (security definer, fixed search_path, never below 0)
-- ------------------------------------------------------------------------------
create or replace function public.post_likes_bump_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.posts
    set like_count = like_count + 1
    where id = new.post_id;
    return new;
  end if;

  -- DELETE
  update public.posts
  set like_count = greatest(like_count - 1, 0)
  where id = old.post_id;
  return old;
end;
$$;

revoke all on function public.post_likes_bump_count() from public;

drop trigger if exists post_likes_count_trg on public.post_likes;
create trigger post_likes_count_trg
  after insert or delete on public.post_likes
  for each row
  execute function public.post_likes_bump_count();

create or replace function public.posts_bump_reply_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.parent_id is not null then
      update public.posts
      set reply_count = reply_count + 1
      where id = new.parent_id;
    end if;
    return new;
  end if;

  -- DELETE
  if old.parent_id is not null then
    update public.posts
    set reply_count = greatest(reply_count - 1, 0)
    where id = old.parent_id;
  end if;
  return old;
end;
$$;

revoke all on function public.posts_bump_reply_count() from public;

drop trigger if exists posts_reply_count_trg on public.posts;
create trigger posts_reply_count_trg
  after insert or delete on public.posts
  for each row
  execute function public.posts_bump_reply_count();

-- ------------------------------------------------------------------------------
-- 7. One-time backfill: recompute both counters from the real rows
-- ------------------------------------------------------------------------------
update public.posts p
set
  like_count = (
    select count(*) from public.post_likes l where l.post_id = p.id
  ),
  reply_count = (
    select count(*) from public.posts c where c.parent_id = p.id
  );

-- ------------------------------------------------------------------------------
-- 8. RLS on post_likes: humans act only as themselves, agents come via the
--    Python backend (service role, which bypasses RLS). No UPDATE at all.
-- ------------------------------------------------------------------------------
alter table public.post_likes enable row level security;

drop policy if exists "post_likes_select_authenticated" on public.post_likes;
create policy "post_likes_select_authenticated"
  on public.post_likes for select
  to authenticated
  using (true);

drop policy if exists "post_likes_insert_own_human" on public.post_likes;
create policy "post_likes_insert_own_human"
  on public.post_likes for insert
  to authenticated
  with check (
    liker_profile_id = (select auth.uid())
    and liker_agent_id is null
  );

drop policy if exists "post_likes_delete_own_human" on public.post_likes;
create policy "post_likes_delete_own_human"
  on public.post_likes for delete
  to authenticated
  using (liker_profile_id = (select auth.uid()));

grant select, insert, delete on public.post_likes to authenticated;

-- ------------------------------------------------------------------------------
-- 9. Feed-path index: comments of one post, oldest first
-- ------------------------------------------------------------------------------
create index if not exists posts_parent_created_idx
  on public.posts (parent_id, created_at);

-- ------------------------------------------------------------------------------
-- 10. Reload PostgREST schema cache
-- ------------------------------------------------------------------------------
notify pgrst, 'reload schema';

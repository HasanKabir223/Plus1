-- ==============================================================================
-- Migration: 20261102_posts_schema_and_rls
-- Purpose: Add public.posts table with strict mutual-exclusivity constraint,
--          body length check, PostgREST-optimized foreign keys, indexes,
--          and Row Level Security (RLS) policies.
-- ==============================================================================

-- 1. Create public.posts table
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_profile_id uuid,
  author_agent_id uuid,
  parent_id uuid,
  body text not null,
  created_at timestamptz not null default now(),

  -- Foreign key constraints with explicit names for PostgREST embedding
  constraint posts_author_profile_id_fkey 
    foreign key (author_profile_id) references public.profiles(id) on delete cascade,
  constraint posts_author_agent_id_fkey 
    foreign key (author_agent_id) references public.agents(id) on delete cascade,
  -- Replies survive their parent: deleting a post orphans its replies
  -- (parent_id becomes null) instead of deleting the whole thread.
  constraint posts_parent_id_fkey 
    foreign key (parent_id) references public.posts(id) on delete set null,

  -- Author constraint: exactly one author (human profile OR agent) must be set
  constraint posts_author_check 
    check (num_nonnulls(author_profile_id, author_agent_id) = 1),

  -- Body constraint: text length between 1 and 500 characters, non-empty
  constraint posts_body_length 
    check (char_length(body) between 1 and 500 and length(trim(body)) > 0)
);

-- 2. Performance indexes
-- Top-level feed index (newest first where parent_id is null)
create index if not exists posts_feed_idx 
  on public.posts (created_at desc) 
  where parent_id is null;

-- General created_at index for sorting
create index if not exists posts_created_at_desc_idx 
  on public.posts (created_at desc);

-- Parent ID index for reply lookups
create index if not exists posts_parent_id_idx 
  on public.posts (parent_id);

-- Foreign key indexes for cascade performance and author profile filtering
create index if not exists posts_author_profile_id_idx 
  on public.posts (author_profile_id);
create index if not exists posts_author_agent_id_idx 
  on public.posts (author_agent_id);

-- 3. Enable Row Level Security (RLS)
alter table public.posts enable row level security;

-- 4. RLS Policies on public.posts
-- SELECT: Authenticated users can view all posts
drop policy if exists "posts_select_authenticated" on public.posts;
create policy "posts_select_authenticated"
  on public.posts for select
  to authenticated
  using (true);

-- INSERT: Authenticated users can only insert their own human posts
drop policy if exists "posts_insert_own_human" on public.posts;
create policy "posts_insert_own_human"
  on public.posts for insert
  to authenticated
  with check (
    author_profile_id = (select auth.uid())
    and author_agent_id is null
  );

-- DELETE: Authenticated users can only delete their own human posts
drop policy if exists "posts_delete_own_human" on public.posts;
create policy "posts_delete_own_human"
  on public.posts for delete
  to authenticated
  using (author_profile_id = (select auth.uid()));

-- 5. Grant table permissions
grant select, insert, delete on public.posts to authenticated;

-- 6. Agents Table RLS: public agents are viewable, owners see their own.
-- Private agents stay private even after posting; their posts still
-- render in the feed with the owner attribution from the embed when
-- the agent is public, and a generic agent label otherwise.
drop policy if exists "Public agents viewable by authenticated users" on public.agents;
drop policy if exists "agents_select_policy" on public.agents;
create policy "agents_select_policy"
  on public.agents for select
  to authenticated
  using (
    is_public = true 
    or owner_id = (select auth.uid())
  );

-- 7. Notify PostgREST to reload schema cache
notify pgrst, 'reload schema';

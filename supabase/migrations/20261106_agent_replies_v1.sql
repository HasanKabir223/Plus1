-- ==============================================================================
-- Migration: 20261106_agent_replies_v1
-- Purpose: Threaded replies on posts (reply_to_id), one opening comment plus
--          one answer per comment per agent, agent reply/answer support.
--          Apply manually (Supabase SQL editor or `supabase db push`).
--          Depends on: 20261102_posts_schema_and_rls, 20261104_likes_and_comments.
-- ==============================================================================
--
-- Model:
--   - Comments are rows in posts with parent_id set (unchanged, still flat,
--     still exactly one level deep).
--   - reply_to_id is METADATA ONLY on a comment: which earlier comment of the
--     SAME post it answers. It never changes depth or threading.
--   - Humans set reply_to_id through the existing insert policy
--     (author_profile_id = auth.uid()); the trigger below rejects anything
--     invalid. Agents insert via the Python backend (service role).

-- ------------------------------------------------------------------------------
-- 1. reply_to_id column: which same-post comment this comment answers
-- ------------------------------------------------------------------------------
alter table public.posts
  add column if not exists reply_to_id uuid
  references public.posts(id) on delete set null;

-- ------------------------------------------------------------------------------
-- 2. Validation trigger: keep the depth rule, add the reply_to_id rule
-- ------------------------------------------------------------------------------
-- Replaces posts_enforce_depth() with the same depth check plus:
--   - reply_to_id requires parent_id (only comments can answer comments);
--   - the referenced row must exist and must be a COMMENT (parent_id not null),
--     never a top-level post;
--   - the referenced comment must belong to the SAME post;
--   - a comment cannot answer itself.
create or replace function public.posts_enforce_depth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parent_parent uuid;
  v_reply_parent uuid;
begin
  -- (a) reply_to_id validity. Runs first so a bad reply target fails even
  -- when the parent itself would be fine.
  if new.reply_to_id is not null then
    if new.parent_id is null then
      raise exception 'reply_to_id requires parent_id: only a comment can answer another comment'
        using errcode = '23514';
    end if;

    if new.reply_to_id = new.id then
      raise exception 'a comment cannot answer itself'
        using errcode = '23514';
    end if;

    select parent_id into v_reply_parent
    from public.posts
    where id = new.reply_to_id;

    if not found then
      raise exception 'answered comment % does not exist', new.reply_to_id
        using errcode = '23503';
    end if;

    if v_reply_parent is null then
      raise exception 'reply_to_id must point to a comment, not a top-level post'
        using errcode = '23514';
    end if;

    if v_reply_parent is distinct from new.parent_id then
      raise exception 'reply_to_id must point to a comment of the same post'
        using errcode = '23514';
    end if;
  end if;

  -- (b) Depth rule, unchanged: a comment's parent must be a top-level post.
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
-- 3. One opening comment + one answer per comment per agent (humans unlimited)
-- ------------------------------------------------------------------------------
-- Drop the old one-comment-per-agent-per-post rule: an agent may now post one
-- opening comment AND answer comments on the same post (bounded by
-- AGENT_MAX_COMMENTS_PER_POST in the Python backend).
drop index if exists public.posts_one_agent_comment_idx;

-- One opening comment (reply_to_id null) per agent per post.
create unique index if not exists posts_one_agent_opener_idx
  on public.posts (parent_id, author_agent_id)
  where parent_id is not null
    and author_agent_id is not null
    and reply_to_id is null;

-- An agent answers any given comment at most once.
create unique index if not exists posts_one_agent_answer_idx
  on public.posts (reply_to_id, author_agent_id)
  where reply_to_id is not null
    and author_agent_id is not null;

-- ------------------------------------------------------------------------------
-- 4. Lookup index for reply targets (keeps (parent_id, created_at) as is)
-- ------------------------------------------------------------------------------
create index if not exists posts_reply_to_id_idx
  on public.posts (reply_to_id);

-- ------------------------------------------------------------------------------
-- 5. RLS: unchanged. The existing posts_insert_own_human policy constrains
--    only author ids, so humans may set reply_to_id and the trigger above
--    rejects cross-post or top-level targets. Agents write via service role.
--    Count triggers unchanged: reply_count counts every comment.
-- ------------------------------------------------------------------------------

-- ------------------------------------------------------------------------------
-- 6. Reload PostgREST schema cache
-- ------------------------------------------------------------------------------
notify pgrst, 'reload schema';

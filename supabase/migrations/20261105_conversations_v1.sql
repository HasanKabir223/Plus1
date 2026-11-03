-- ==============================================================================
-- Migration: 20261105_conversations_v1
-- Purpose: Replace the old agent-only conversation demo tables with the real
--          conversation model: human<->human DMs, human<->agent chats and
--          agent<->agent threads in one shape, with membership-based RLS,
--          start/mark-read RPCs, and claim_agent_call extended with p_kind
--          ('turn' skips the per-agent cooldown).
--          Apply manually (Supabase SQL editor or `supabase db push`).
--          Depends on: 20261102_posts_schema_and_rls,
--                      20261102_agent_brain_v1, 20261103_agent_brain_token_cap.
--          NOTE: existing rows in the old conversations/messages tables are
--          seed/demo data and are discarded.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Drop the old demo model (policies, triggers and FKs go with the tables)
-- ------------------------------------------------------------------------------
drop table if exists public.messages cascade;
drop table if exists public.conversations cascade;

-- ------------------------------------------------------------------------------
-- 2. conversations
-- ------------------------------------------------------------------------------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dm', 'human_agent', 'agent_agent')),
  status text not null default 'open' check (status in ('open', 'paused', 'closed')),
  mode text not null default 'auto' check (mode in ('auto', 'human')),
  origin_post_id uuid references public.posts(id) on delete set null,
  initiated_by_agent_id uuid references public.agents(id) on delete set null,
  message_count int not null default 0,
  max_messages int not null default 6,
  outcome text check (outcome in ('interested', 'not_a_fit', 'undecided')),
  processing_since timestamptz,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  closed_at timestamptz
);

create index conversations_last_message_idx
  on public.conversations (last_message_at desc);

-- ------------------------------------------------------------------------------
-- 3. conversation_participants (exactly one identity per row)
-- ------------------------------------------------------------------------------
create table public.conversation_participants (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  profile_id uuid references public.profiles(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete cascade,
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  constraint conversation_participants_exactly_one_check
    check (num_nonnulls(profile_id, agent_id) = 1)
);

create unique index conversation_participants_profile_uidx
  on public.conversation_participants (conversation_id, profile_id)
  where profile_id is not null;
create unique index conversation_participants_agent_uidx
  on public.conversation_participants (conversation_id, agent_id)
  where agent_id is not null;
create index conversation_participants_conversation_idx
  on public.conversation_participants (conversation_id);
create index conversation_participants_profile_idx
  on public.conversation_participants (profile_id);
create index conversation_participants_agent_idx
  on public.conversation_participants (agent_id);

-- ------------------------------------------------------------------------------
-- 4. messages (system rows have no sender; message rows have exactly one)
-- ------------------------------------------------------------------------------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_profile_id uuid references public.profiles(id) on delete cascade,
  sender_agent_id uuid references public.agents(id) on delete cascade,
  kind text not null default 'message' check (kind in ('message', 'system')),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  constraint messages_sender_check check (
    (kind = 'system' and sender_profile_id is null and sender_agent_id is null)
    or (kind = 'message' and num_nonnulls(sender_profile_id, sender_agent_id) = 1)
  )
);

create index messages_conversation_created_idx
  on public.messages (conversation_id, created_at);

-- ------------------------------------------------------------------------------
-- 5. inbox_items: align with the new shape (agent nullable, read_at, type)
-- ------------------------------------------------------------------------------
alter table public.inbox_items
  add column if not exists type text not null default 'agent_report',
  add column if not exists read_at timestamptz;

alter table public.inbox_items
  alter column agent_id drop not null;

update public.inbox_items
set read_at = created_at
where status in ('read', 'dismissed') and read_at is null;

alter table public.inbox_items
  drop column if exists status;

-- ------------------------------------------------------------------------------
-- 6. Membership helper (security definer: policies using it cannot recurse)
-- ------------------------------------------------------------------------------
create or replace function public.is_conversation_member(p_conversation_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.conversation_participants cp
    where cp.conversation_id = p_conversation_id
      and (
        cp.profile_id = auth.uid()
        or exists (
          select 1 from public.agents a
          where a.id = cp.agent_id and a.owner_id = auth.uid()
        )
      )
  );
$$;

revoke all on function public.is_conversation_member(uuid) from public;
grant execute on function public.is_conversation_member(uuid) to authenticated;

-- ------------------------------------------------------------------------------
-- 7. start_dm / start_agent_chat / mark_read (the only client write paths)
-- ------------------------------------------------------------------------------
create or replace function public.start_dm(p_target_profile_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_conv uuid;
begin
  if v_me is null or p_target_profile_id is null or p_target_profile_id = v_me then
    raise exception 'invalid dm target' using errcode = '22023';
  end if;

  select c.id into v_conv
  from public.conversations c
  where c.kind = 'dm'
    and exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = c.id and cp.profile_id = v_me
    )
    and exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = c.id and cp.profile_id = p_target_profile_id
    )
  order by c.created_at
  limit 1;

  if v_conv is not null then
    return v_conv;
  end if;

  insert into public.conversations (kind)
  values ('dm')
  returning id into v_conv;

  insert into public.conversation_participants (conversation_id, profile_id)
  values (v_conv, v_me), (v_conv, p_target_profile_id);

  return v_conv;
end;
$$;

revoke all on function public.start_dm(uuid) from public;
grant execute on function public.start_dm(uuid) to authenticated;

create or replace function public.start_agent_chat(p_agent_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_status text;
  v_conv uuid;
begin
  if v_me is null or p_agent_id is null then
    raise exception 'invalid agent chat target' using errcode = '22023';
  end if;

  select status into v_status from public.agents where id = p_agent_id;
  if not found or v_status is distinct from 'active' then
    raise exception 'agent is not available for chat' using errcode = '22023';
  end if;

  select c.id into v_conv
  from public.conversations c
  where c.kind = 'human_agent'
    and exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = c.id and cp.profile_id = v_me
    )
    and exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = c.id and cp.agent_id = p_agent_id
    )
  order by c.created_at
  limit 1;

  if v_conv is not null then
    return v_conv;
  end if;

  insert into public.conversations (kind)
  values ('human_agent')
  returning id into v_conv;

  insert into public.conversation_participants (conversation_id, profile_id, agent_id)
  values (v_conv, v_me, null), (v_conv, null, p_agent_id);

  return v_conv;
end;
$$;

revoke all on function public.start_agent_chat(uuid) from public;
grant execute on function public.start_agent_chat(uuid) to authenticated;

create or replace function public.mark_read(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.conversation_participants
  set last_read_at = now()
  where conversation_id = p_conversation_id
    and profile_id = auth.uid();
end;
$$;

revoke all on function public.mark_read(uuid) from public;
grant execute on function public.mark_read(uuid) to authenticated;

-- ------------------------------------------------------------------------------
-- 8. claim_agent_call: normalize to the canonical shape, add p_kind.
--    kind 'run' (default) keeps the cooldown; kind 'turn' skips it. All
--    other caps (per-agent daily, global calls, global tokens) always hold.
-- ------------------------------------------------------------------------------
drop function if exists public.claim_agent_call(uuid, int, int, int);
drop function if exists public.claim_agent_call(uuid, int, int, int, int);
drop function if exists public.claim_agent_call(uuid, int, int, int, int, text);

create or replace function public.claim_agent_call(
  p_agent_id uuid,
  p_cooldown_seconds int,
  p_agent_daily_cap int,
  p_global_daily_cap int,
  p_global_daily_token_cap int,
  p_kind text default 'run'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_last_call timestamptz;
  v_agent_calls int;
  v_global_calls int;
  v_global_tokens int;
  v_today date := (now() at time zone 'utc')::date;
  v_retry int;
begin
  select status into v_status
  from public.agents
  where id = p_agent_id
  for update;

  if not found or v_status is distinct from 'active' then
    return jsonb_build_object('ok', false, 'reason', 'paused', 'retry_after_seconds', 0);
  end if;

  insert into public.agent_usage_daily (agent_id, day, calls)
  values (p_agent_id, v_today, 0)
  on conflict (agent_id, day) do nothing;

  select calls, last_call_at into v_agent_calls, v_last_call
  from public.agent_usage_daily
  where agent_id = p_agent_id and day = v_today
  for update;

  -- Per-agent cooldown applies to manual Runs only; conversation turns are
  -- gated by the conversation lock and the caps below instead.
  if p_kind is distinct from 'turn'
     and v_last_call is not null
     and extract(epoch from (now() - v_last_call)) < p_cooldown_seconds then
    v_retry := p_cooldown_seconds
      - floor(extract(epoch from (now() - v_last_call)))::int;
    return jsonb_build_object('ok', false, 'reason', 'cooldown', 'retry_after_seconds', greatest(v_retry, 1));
  end if;

  if v_agent_calls >= p_agent_daily_cap then
    v_retry := greatest(1, floor(extract(epoch from (
      (date_trunc('day', now() at time zone 'utc') + interval '1 day')
      - (now() at time zone 'utc')
    )))::int);
    return jsonb_build_object('ok', false, 'reason', 'agent_daily_cap', 'retry_after_seconds', v_retry);
  end if;

  insert into public.llm_usage_daily (day, calls, tokens)
  values (v_today, 0, 0)
  on conflict (day) do nothing;

  select calls, tokens into v_global_calls, v_global_tokens
  from public.llm_usage_daily
  where day = v_today
  for update;

  if v_global_calls >= p_global_daily_cap then
    v_retry := greatest(1, floor(extract(epoch from (
      (date_trunc('day', now() at time zone 'utc') + interval '1 day')
      - (now() at time zone 'utc')
    )))::int);
    return jsonb_build_object('ok', false, 'reason', 'global_budget', 'retry_after_seconds', v_retry);
  end if;

  if v_global_tokens >= p_global_daily_token_cap then
    v_retry := greatest(1, floor(extract(epoch from (
      (date_trunc('day', now() at time zone 'utc') + interval '1 day')
      - (now() at time zone 'utc')
    )))::int);
    return jsonb_build_object('ok', false, 'reason', 'global_token_budget', 'retry_after_seconds', v_retry);
  end if;

  update public.agent_usage_daily
  set calls = calls + 1,
      last_call_at = now()
  where agent_id = p_agent_id and day = v_today;

  update public.llm_usage_daily
  set calls = calls + 1
  where day = v_today;

  return jsonb_build_object('ok', true, 'reason', 'ok', 'retry_after_seconds', 0);
end;
$$;

revoke all on function public.claim_agent_call(uuid, int, int, int, int, text)
  from public, anon, authenticated;
grant execute on function public.claim_agent_call(uuid, int, int, int, int, text)
  to service_role;

-- ------------------------------------------------------------------------------
-- 9. RLS: members read; humans send only as themselves; backend does the rest
-- ------------------------------------------------------------------------------
alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;

drop policy if exists "conversations_select_members" on public.conversations;
create policy "conversations_select_members"
  on public.conversations for select
  to authenticated
  using (public.is_conversation_member(id));

drop policy if exists "participants_select_members" on public.conversation_participants;
create policy "participants_select_members"
  on public.conversation_participants for select
  to authenticated
  using (public.is_conversation_member(conversation_id));

drop policy if exists "messages_select_members" on public.messages;
create policy "messages_select_members"
  on public.messages for select
  to authenticated
  using (public.is_conversation_member(conversation_id));

drop policy if exists "messages_insert_own_human" on public.messages;
create policy "messages_insert_own_human"
  on public.messages for insert
  to authenticated
  with check (
    sender_profile_id = (select auth.uid())
    and sender_agent_id is null
    and kind = 'message'
    and exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = messages.conversation_id
        and cp.profile_id = auth.uid()
    )
    and exists (
      select 1 from public.conversations c
      where c.id = messages.conversation_id and c.status = 'open'
    )
  );

drop policy if exists "Owners have full access to their inbox items" on public.inbox_items;
drop policy if exists "inbox_select_own" on public.inbox_items;
create policy "inbox_select_own"
  on public.inbox_items for select
  to authenticated
  using (owner_id = auth.uid());

drop policy if exists "inbox_update_own_read" on public.inbox_items;
create policy "inbox_update_own_read"
  on public.inbox_items for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

grant select on public.conversations to authenticated;
grant select on public.conversation_participants to authenticated;
grant select, insert on public.messages to authenticated;
grant select on public.inbox_items to authenticated;
revoke update on public.inbox_items from authenticated;
grant update (read_at) on public.inbox_items to authenticated;

-- ------------------------------------------------------------------------------
-- 10. Realtime: stream message inserts (idempotent)
-- ------------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- ------------------------------------------------------------------------------
-- 11. Reload PostgREST schema cache
-- ------------------------------------------------------------------------------
notify pgrst, 'reload schema';

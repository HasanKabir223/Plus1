-- ============================================================================
-- Conversation RLS + grants checklist (20261105_conversations_v1)
-- Run top to bottom in the Supabase SQL editor. Every block prints PASS
-- notices or raises an error naming the failed expectation.
--
--   Part A: structure (RLS flags, policy inventory, grants, realtime).
--           Run as-is; needs no setup.
--   Part B: behavior as real users (member read/send, non-member blocked,
--           impersonation blocked, RPC dedupe, inbox rules). Edit the three
--           UUIDs in B.0 once, then run. All B writes sit inside
--           transactions that ROLLBACK, so nothing persists.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A.1 RLS is enabled on all four tables
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
  enabled boolean;
begin
  foreach t in array array['conversations', 'conversation_participants', 'messages', 'inbox_items'] loop
    select c.relrowsecurity into enabled
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = t;
    if not coalesce(enabled, false) then
      raise exception 'RLS NOT enabled on public.%', t;
    end if;
  end loop;
  raise notice 'PASS A.1: RLS enabled on all conversation tables';
end $$;

-- ----------------------------------------------------------------------------
-- A.2 Exact policy inventory (no leftover permissive policies)
-- ----------------------------------------------------------------------------
do $$
declare
  got text[];
begin
  select coalesce(array_agg(policyname order by policyname), '{}') into got
  from pg_policies where schemaname = 'public' and tablename = 'conversations';
  if got <> array['conversations_select_members'] then
    raise exception 'conversations policies unexpected: %', got;
  end if;

  select coalesce(array_agg(policyname order by policyname), '{}') into got
  from pg_policies where schemaname = 'public' and tablename = 'conversation_participants';
  if got <> array['participants_select_members'] then
    raise exception 'conversation_participants policies unexpected: %', got;
  end if;

  select coalesce(array_agg(policyname order by policyname), '{}') into got
  from pg_policies where schemaname = 'public' and tablename = 'messages';
  if got <> array['messages_insert_own_human', 'messages_select_members'] then
    raise exception 'messages policies unexpected: %', got;
  end if;

  select coalesce(array_agg(policyname order by policyname), '{}') into got
  from pg_policies where schemaname = 'public' and tablename = 'inbox_items';
  if got <> array['inbox_select_own', 'inbox_update_own_read'] then
    raise exception 'inbox_items policies unexpected: %', got;
  end if;

  raise notice 'PASS A.2: policy inventory matches the migration exactly';
end $$;

-- ----------------------------------------------------------------------------
-- A.3 Table grants for anon/authenticated (least privilege)
-- ----------------------------------------------------------------------------
create or replace function pg_temp.check_grants(p_table text, p_role text, p_want text[])
returns void language plpgsql as $$
declare
  got text[];
begin
  select coalesce(array_agg(privilege_type order by privilege_type), '{}') into got
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = p_table and grantee = p_role;
  if got <> p_want then
    raise exception '% on % unexpected: % (want %)', p_role, p_table, got, p_want;
  end if;
end $$;

do $$
begin
  perform pg_temp.check_grants('conversations', 'anon', '{}');
  perform pg_temp.check_grants('conversations', 'authenticated', array['SELECT']);
  perform pg_temp.check_grants('conversation_participants', 'anon', '{}');
  perform pg_temp.check_grants('conversation_participants', 'authenticated', array['SELECT']);
  perform pg_temp.check_grants('messages', 'anon', '{}');
  perform pg_temp.check_grants('messages', 'authenticated', array['INSERT', 'SELECT']);
  perform pg_temp.check_grants('inbox_items', 'anon', '{}');
  perform pg_temp.check_grants('inbox_items', 'authenticated', array['SELECT']);
  raise notice 'PASS A.3: table grants are least-privilege';
end $$;

-- A.3b Column grant: authenticated may UPDATE only inbox_items.read_at.
do $$
declare
  got text[];
begin
  select coalesce(array_agg(distinct column_name order by column_name), '{}') into got
  from information_schema.role_column_grants
  where table_schema = 'public' and table_name = 'inbox_items'
    and grantee = 'authenticated' and privilege_type = 'UPDATE';
  if got <> array['read_at'] then
    raise exception 'authenticated UPDATE columns on inbox_items unexpected: %', got;
  end if;
  raise notice 'PASS A.3b: authenticated can UPDATE only inbox_items.read_at';
end $$;

-- ----------------------------------------------------------------------------
-- A.4 messages is streamed by Realtime
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'messages'
  ) then
    raise exception 'public.messages is NOT in the supabase_realtime publication';
  end if;
  raise notice 'PASS A.4: messages is in the supabase_realtime publication';
end $$;

-- ----------------------------------------------------------------------------
-- A.5 claim_agent_call is executable by service_role only
-- ----------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.claim_agent_call(uuid,int,int,int,int,text)', 'execute') then
    raise exception 'anon can execute claim_agent_call';
  end if;
  if has_function_privilege('authenticated', 'public.claim_agent_call(uuid,int,int,int,int,text)', 'execute') then
    raise exception 'authenticated can execute claim_agent_call';
  end if;
  if not has_function_privilege('service_role', 'public.claim_agent_call(uuid,int,int,int,int,text)', 'execute') then
    raise exception 'service_role CANNOT execute claim_agent_call';
  end if;
  raise notice 'PASS A.5: claim_agent_call is service_role-only';
end $$;

-- ============================================================================
-- PART B: behavior as real users. Run this whole file in ONE editor click
-- (the temp params table below lives only for the session). Every B block
-- runs in a transaction that ROLLBACKs, so no probe rows persist.
-- The `set_config('request.jwt.claim.sub', ...)` + `SET LOCAL ROLE
-- authenticated` pair is exactly how PostgREST presents a signed-in user,
-- so these checks exercise the same path as the app.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- B.0 Stage parameters. Run the finder queries, paste the UUIDs, then run all.
-- ----------------------------------------------------------------------------

-- B.0.1 An OPEN conversation where you are a PROFILE participant:
--   select c.id as conv, cp.profile_id as user_a
--   from public.conversations c
--   join public.conversation_participants cp on cp.conversation_id = c.id
--   where c.status = 'open' and cp.profile_id is not null
--   limit 1;
-- (No rows? In the app, press Message on someone and send one message, rerun.)

-- B.0.2 A profile NOT in that conversation (paste conv from B.0.1 first):
--   select id as user_b from public.profiles
--   where id <> '<USER_A>' and id not in (
--     select profile_id from public.conversation_participants
--     where conversation_id = '<CONV>' and profile_id is not null)
--   limit 1;

-- B.0.3 One active agent, one paused agent, one other profile:
--   select id, name, status from public.agents order by status limit 5;
--   select id, username from public.profiles where id <> '<USER_A>' limit 3;
-- (No paused agent? Pause one in the app, or skip the paused-agent check.)

create temp table if not exists rls_params (k text primary key, v uuid);
delete from rls_params;
insert into rls_params (k, v) values
  ('conv', '<CONV>'),
  ('user_a', '<USER_A>'),
  ('user_b', '<USER_B>'),
  ('other_profile', '<OTHER_PROFILE>'),
  ('agent_active', '<ACTIVE_AGENT>'),
  ('agent_paused', '<PAUSED_AGENT>'),
  ('agent_any', '<ACTIVE_AGENT>');

do $$
declare
  n int;
begin
  select count(*) into n from rls_params;
  if n <> 7 then
    raise exception 'B.0: fill every <PLACEHOLDER> above before running (found %/7 rows)', n;
  end if;
  raise notice 'PASS B.0: params staged';
end $$;

-- ----------------------------------------------------------------------------
-- B.1 Member reads + sends in their own open conversation
-- ----------------------------------------------------------------------------
begin;
select set_config('request.jwt.claim.sub', (select v::text from rls_params where k = 'user_a'), true);
set local role authenticated;
do $$
declare
  c uuid := (select v from rls_params where k = 'conv');
  n int;
begin
  select count(*) into n from public.conversations where id = c;
  if n <> 1 then raise exception 'B.1 member cannot read own conversation'; end if;
  perform 1 from public.messages where conversation_id = c limit 1;
  perform 1 from public.conversation_participants where conversation_id = c limit 1;
  insert into public.messages (conversation_id, sender_profile_id, sender_agent_id, kind, body)
  values (c, auth.uid(), null, 'message', 'rls checklist probe (rolled back)');
  raise notice 'PASS B.1: member reads + sends in own open conversation';
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- B.2 Non-member sees nothing and sends nothing
-- ----------------------------------------------------------------------------
begin;
select set_config('request.jwt.claim.sub', (select v::text from rls_params where k = 'user_b'), true);
set local role authenticated;
do $$
declare
  c uuid := (select v from rls_params where k = 'conv');
  n int;
begin
  select count(*) into n from public.conversations where id = c;
  if n <> 0 then raise exception 'B.2 LEAK: non-member can read the conversation'; end if;
  select count(*) into n from public.messages where conversation_id = c;
  if n <> 0 then raise exception 'B.2 LEAK: non-member can read messages'; end if;
  select count(*) into n from public.conversation_participants where conversation_id = c;
  if n <> 0 then raise exception 'B.2 LEAK: non-member can read participants'; end if;
  begin
    insert into public.messages (conversation_id, sender_profile_id, sender_agent_id, kind, body)
    values (c, auth.uid(), null, 'message', 'intruder');
    raise exception 'B.2 LEAK: non-member insert was allowed';
  exception when others then
    if sqlstate <> '42501' then
      raise exception 'B.2 non-member insert failed with % instead of 42501', sqlstate;
    end if;
  end;
  raise notice 'PASS B.2: non-member sees nothing and sends nothing';
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- B.3 Impersonation + privilege escalation are blocked (as the member)
-- ----------------------------------------------------------------------------
begin;
select set_config('request.jwt.claim.sub', (select v::text from rls_params where k = 'user_a'), true);
set local role authenticated;
do $$
declare
  c uuid := (select v from rls_params where k = 'conv');
  b uuid := (select v from rls_params where k = 'user_b');
  aid uuid := (select v from rls_params where k = 'agent_any');
begin
  -- Send as someone else.
  begin
    insert into public.messages (conversation_id, sender_profile_id, sender_agent_id, kind, body)
    values (c, b, null, 'message', 'forged');
    raise exception 'B.3 LEAK: sending as another profile was allowed';
  exception when others then
    if sqlstate <> '42501' then raise exception 'B.3 send-as-other failed with %', sqlstate; end if;
  end;
  -- Send as an agent (blocked by RLS; the table's sender check may fire first).
  begin
    insert into public.messages (conversation_id, sender_profile_id, sender_agent_id, kind, body)
    values (c, auth.uid(), aid, 'message', 'forged agent message');
    raise exception 'B.3 LEAK: sending as an agent was allowed';
  exception when others then
    if sqlstate not in ('42501', '23514') then
      raise exception 'B.3 send-as-agent failed with %', sqlstate;
    end if;
  end;
  -- Send a system message.
  begin
    insert into public.messages (conversation_id, sender_profile_id, sender_agent_id, kind, body)
    values (c, null, null, 'system', 'forged system note');
    raise exception 'B.3 LEAK: client system message was allowed';
  exception when others then
    if sqlstate <> '42501' then raise exception 'B.3 system insert failed with %', sqlstate; end if;
  end;
  -- Edit or delete any message.
  begin
    update public.messages set body = 'edited' where conversation_id = c;
    raise exception 'B.3 LEAK: client message update was allowed';
  exception when others then
    if sqlstate <> '42501' then raise exception 'B.3 update failed with %', sqlstate; end if;
  end;
  begin
    delete from public.messages where conversation_id = c;
    raise exception 'B.3 LEAK: client message delete was allowed';
  exception when others then
    if sqlstate <> '42501' then raise exception 'B.3 delete failed with %', sqlstate; end if;
  end;
  -- Touch the conversation row or membership directly.
  begin
    insert into public.conversation_participants (conversation_id, profile_id)
    values (c, b);
    raise exception 'B.3 LEAK: client participant insert was allowed';
  exception when others then
    if sqlstate <> '42501' then raise exception 'B.3 participant insert failed with %', sqlstate; end if;
  end;
  raise notice 'PASS B.3: impersonation and escalation blocked';
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- B.4 Nobody sends into a closed/paused conversation (skips if you have none)
-- ----------------------------------------------------------------------------
begin;
select set_config('request.jwt.claim.sub', (select v::text from rls_params where k = 'user_a'), true);
set local role authenticated;
do $$
declare
  c uuid;
begin
  -- Visible pre-check as the member: find one of MY non-open conversations.
  select cp.conversation_id into c
  from public.conversation_participants cp
  join public.conversations conv on conv.id = cp.conversation_id
  where cp.profile_id = auth.uid() and conv.status <> 'open'
  limit 1;
  if c is null then
    raise notice 'SKIP B.4: no closed/paused conversation found (pause one in the app and rerun)';
    return;
  end if;
  begin
    insert into public.messages (conversation_id, sender_profile_id, sender_agent_id, kind, body)
    values (c, auth.uid(), null, 'message', 'late message');
    raise exception 'B.4 LEAK: send into % conversation was allowed', (select status from public.conversations where id = c);
  exception when others then
    if sqlstate <> '42501' then raise exception 'B.4 closed-conv insert failed with %', sqlstate; end if;
  end;
  raise notice 'PASS B.4: sends into closed/paused conversations blocked';
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- B.5 start_dm / start_agent_chat dedupe; bad targets rejected
-- ----------------------------------------------------------------------------
begin;
select set_config('request.jwt.claim.sub', (select v::text from rls_params where k = 'user_a'), true);
set local role authenticated;
do $$
declare
  me uuid := (select v from rls_params where k = 'user_a');
  other uuid := (select v from rls_params where k = 'other_profile');
  active uuid := (select v from rls_params where k = 'agent_active');
  paused uuid := (select v from rls_params where k = 'agent_paused');
  first uuid;
  second uuid;
begin
  first := public.start_dm(other);
  second := public.start_dm(other);
  if first is null or first <> second then
    raise exception 'B.5 start_dm did not dedupe: % vs %', first, second;
  end if;
  begin
    perform public.start_dm(me);
    raise exception 'B.5 LEAK: start_dm(self) was allowed';
  exception when others then
    if sqlstate <> '22023' then raise exception 'B.5 start_dm(self) failed with %', sqlstate; end if;
  end;

  first := public.start_agent_chat(active);
  second := public.start_agent_chat(active);
  if first is null or first <> second then
    raise exception 'B.5 start_agent_chat did not dedupe: % vs %', first, second;
  end if;
  begin
    perform public.start_agent_chat(paused);
    raise exception 'B.5 LEAK: chat with a paused agent was allowed';
  exception when others then
    if sqlstate <> '22023' then raise exception 'B.5 paused-agent chat failed with %', sqlstate; end if;
  end;
  raise notice 'PASS B.5: start RPCs dedupe and reject bad targets';
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- B.6 mark_read touches only the caller's own participant row
-- ----------------------------------------------------------------------------
begin;
select set_config('request.jwt.claim.sub', (select v::text from rls_params where k = 'user_a'), true);
set local role authenticated;
do $$
declare
  c uuid := (select v from rls_params where k = 'conv');
  n int;
begin
  perform public.mark_read(c);
  select count(*) into n
  from public.conversation_participants
  where conversation_id = c and profile_id = auth.uid() and last_read_at is not null;
  if n <> 1 then raise exception 'B.6 mark_read did not stamp the caller row'; end if;
  raise notice 'PASS B.6: mark_read stamps the caller row';
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- B.7 Inbox: owners read/ack only their own rows
-- ----------------------------------------------------------------------------
begin;
select set_config('request.jwt.claim.sub', (select v::text from rls_params where k = 'user_a'), true);
set local role authenticated;
do $$
declare
  n int;
  mine uuid;
begin
  select count(*) into n from public.inbox_items where owner_id <> auth.uid();
  if n <> 0 then raise exception 'B.7 LEAK: inbox shows other owners rows'; end if;
  select id into mine from public.inbox_items where owner_id = auth.uid() limit 1;
  if mine is null then
    raise notice 'SKIP B.7 writes: owner has no inbox rows (finish an agent chat first)';
    return;
  end if;
  update public.inbox_items set read_at = now() where id = mine;
  begin
    update public.inbox_items set summary = 'rewritten' where id = mine;
    raise exception 'B.7 LEAK: inbox summary rewrite was allowed';
  exception when others then
    if sqlstate <> '42501' then raise exception 'B.7 summary update failed with %', sqlstate; end if;
  end;
  begin
    insert into public.inbox_items (owner_id, type, summary)
    values (auth.uid(), 'agent_report', 'fake');
    raise exception 'B.7 LEAK: client inbox insert was allowed';
  exception when others then
    if sqlstate <> '42501' then raise exception 'B.7 inbox insert failed with %', sqlstate; end if;
  end;
  raise notice 'PASS B.7: inbox read/ack rules hold';
end $$;
rollback;

-- ----------------------------------------------------------------------------
-- B.8 Function executability as a signed-in user
-- ----------------------------------------------------------------------------
begin;
select set_config('request.jwt.claim.sub', (select v::text from rls_params where k = 'user_a'), true);
set local role authenticated;
do $$
declare
  c uuid := (select v from rls_params where k = 'conv');
begin
  if not public.is_conversation_member(c) then
    raise exception 'B.8 is_conversation_member is false for a real member';
  end if;
  begin
    perform public.claim_agent_call(c, 300, 12, 700, 150000, 'turn');
    raise exception 'B.8 LEAK: authenticated executed claim_agent_call';
  exception when others then
    if sqlstate <> '42501' then raise exception 'B.8 claim call failed with %', sqlstate; end if;
  end;
  raise notice 'PASS B.8: member check true, claim blocked for clients';
end $$;
rollback;

begin;
select set_config('request.jwt.claim.sub', (select v::text from rls_params where k = 'user_b'), true);
set local role authenticated;
do $$
declare
  c uuid := (select v from rls_params where k = 'conv');
begin
  if public.is_conversation_member(c) then
    raise exception 'B.8 LEAK: is_conversation_member is true for a non-member';
  end if;
  raise notice 'PASS B.8b: member check false for non-member';
end $$;
rollback;

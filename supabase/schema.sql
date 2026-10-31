-- ==============================================================================
-- PLUS1 DATABASE SCHEMA
-- ==============================================================================
-- This SQL file defines the entire database structure for Plus1.
-- It is designed to be "idempotent" (meaning you can run it multiple times 
-- safely without causing errors or duplicate tables).
--
-- The database consists of 4 main sections:
-- 1. TABLES: The core data models (Profiles, Agents, Conversations, Messages, Inbox)
-- 2. ROW LEVEL SECURITY (RLS): Access control rules protecting user privacy
-- 3. TRIGGERS: Automatic actions (like auto-creating a profile when a user signs up)
-- 4. REALTIME: Enabling live WebSocket updates so the frontend updates instantly
-- ==============================================================================


-- ==============================================================================
-- 1. CORE TABLES
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1.1 PROFILES (Human User Profiles)
-- ------------------------------------------------------------------------------
-- Each row represents a human member of Plus1.
-- 'id': Matches the Supabase Auth user ID (UUID).
-- 'username': Unique handle for @mentions and profile URLs (e.g., 'hasankabir23').
-- 'profilename': Display name shown at the top of the profile (e.g., 'Hasan Kabir').
-- 'bio': Short introduction about the member.
-- 'looking_for': Array of interest tags (e.g., ['teammates', 'hackathon']).
-- ------------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique check (username is null or (username = lower(username) and username ~ '^[a-z0-9_]{3,20}$')),
  profilename text,
  bio text default '',
  looking_for text[] default '{}',
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------------------
-- 1.2 AGENTS (Autonomous AI Representatives)
-- ------------------------------------------------------------------------------
-- Each human can build and deploy autonomous agents into the network.
-- 'owner_id': Links the agent to the human profile who owns it.
-- 'name': Agent's name (e.g., 'Scout').
-- 'personality': Tone and behavior style of the agent.
-- 'skill_md': Prompt instructions written in Markdown defining what the agent does.
-- 'status': 'active' (can explore and chat) or 'paused' (frozen by owner).
-- 'is_public': If true, other network agents can discover and talk to this agent.
-- 'last_run_at': Timestamp of the last time this agent took an action.
-- ------------------------------------------------------------------------------
create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  personality text not null default '',
  skill_md text not null default '',
  status text not null default 'active' check (status in ('active', 'paused')),
  is_public boolean not null default true,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------------------
-- 1.3 CONVERSATIONS (Agent-to-Agent Dialogues)
-- ------------------------------------------------------------------------------
-- When two agents interact autonomously, they start a conversation thread.
-- 'initiator_agent_id': The agent that kicked off the discussion.
-- 'target_agent_id': The agent that received the inquiry.
-- 'status': 
--    'live'   = Conversation is actively taking place.
--    'done'   = Conversation completed its goal successfully.
--    'capped' = Reached max allowed turns (prevents infinite conversational loops).
-- 'turn_count': Current number of message exchanges.
-- 'max_turns': Safety limit (default 6 turns max).
-- ------------------------------------------------------------------------------
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  initiator_agent_id uuid not null references public.agents(id) on delete cascade,
  target_agent_id uuid not null references public.agents(id) on delete cascade,
  status text not null default 'live' check (status in ('live', 'done', 'capped')),
  turn_count int not null default 0,
  max_turns int not null default 6,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------------------
-- 1.4 MESSAGES (Individual Chat Turns)
-- ------------------------------------------------------------------------------
-- Stores the individual messages exchanged inside an agent conversation.
-- 'conversation_id': Identifies which conversation this message belongs to.
-- 'sender_agent_id': Which of the two agents sent this specific message.
-- 'content': The actual dialogue text generated by the agent.
-- ------------------------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_agent_id uuid not null references public.agents(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------------------
-- 1.5 INBOX ITEMS (Synthesized Findings for the Human Owner)
-- ------------------------------------------------------------------------------
-- Once agents finish talking, they summarize key findings for their human owner.
-- This keeps humans from having to read long raw logs.
-- 'owner_id': The human recipient who receives this briefing.
-- 'agent_id': Which of their agents brought back this finding.
-- 'conversation_id': Optional link to view the underlying full agent conversation.
-- 'summary': Quick 1-2 sentence briefing (e.g. "Found a match with Elena's agent!").
-- 'status': 'unread', 'read', or 'dismissed'.
-- ------------------------------------------------------------------------------
create table if not exists public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  summary text not null,
  status text not null default 'unread' check (status in ('unread', 'read', 'dismissed')),
  created_at timestamptz not null default now()
);




-- ==============================================================================
-- 2. ROW LEVEL SECURITY (RLS)
-- ==============================================================================
-- In PostgreSQL/Supabase, RLS acts as a security guard on every single table.
-- Without RLS policies, clients cannot read or write data.
-- 'auth.uid()' is a Supabase function that returns the logged-in user's UUID.
-- ==============================================================================

-- Step A: Enable RLS on all tables so nothing is accessible by default
alter table public.profiles enable row level security;
alter table public.agents enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.inbox_items enable row level security;

-- ------------------------------------------------------------------------------
-- 2.1 PROFILES POLICIES
-- ------------------------------------------------------------------------------
-- Rule 1: Any logged-in member can read other members' profiles (for network exploration).
drop policy if exists "Profiles are viewable by authenticated users" on public.profiles;
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- Rule 2: A member can insert their profile row matching their auth ID.
drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
  on public.profiles for insert
  to authenticated
  with check ((select auth.uid()) = id);

-- Rule 3: A member can ONLY edit their own profile.
drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Rule 4: A member can delete their own profile.
drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own"
  on public.profiles for delete
  to authenticated
  using ((select auth.uid()) = id);

-- ------------------------------------------------------------------------------
-- 2.2 AGENTS POLICIES
-- ------------------------------------------------------------------------------
-- Rule 1: Anyone logged in can see public agents; owners can always see their own.
drop policy if exists "Public agents viewable by authenticated users" on public.agents;
create policy "Public agents viewable by authenticated users"
  on public.agents for select
  to authenticated
  using (is_public = true or owner_id = auth.uid());

-- Rule 2: Only the owner has full permissions (create, edit, delete, pause) on their agent.
drop policy if exists "Owners have full control over their agents" on public.agents;
create policy "Owners have full control over their agents"
  on public.agents for all
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ------------------------------------------------------------------------------
-- 2.3 CONVERSATIONS POLICIES
-- ------------------------------------------------------------------------------
-- Conversations are private! Only the humans who own either the initiator agent
-- or target agent are permitted to see or start a conversation thread.
drop policy if exists "Owners can view conversations involving their agents" on public.conversations;
create policy "Owners can view conversations involving their agents"
  on public.conversations for select
  to authenticated
  using (
    exists (
      select 1 from public.agents
      where agents.id in (conversations.initiator_agent_id, conversations.target_agent_id)
        and agents.owner_id = auth.uid()
    )
  );

drop policy if exists "Agent owners can insert conversations" on public.conversations;
create policy "Agent owners can insert conversations"
  on public.conversations for insert
  to authenticated
  with check (
    exists (
      select 1 from public.agents
      where agents.id = conversations.initiator_agent_id
        and agents.owner_id = auth.uid()
    )
  );

-- ------------------------------------------------------------------------------
-- 2.4 MESSAGES POLICIES
-- ------------------------------------------------------------------------------
-- Messages inside a conversation can only be seen or inserted by the owners
-- of the agents taking part in that dialogue.
drop policy if exists "Owners can view messages in their conversations" on public.messages;
create policy "Owners can view messages in their conversations"
  on public.messages for select
  to authenticated
  using (
    exists (
      select 1 from public.conversations c
      join public.agents a on a.id in (c.initiator_agent_id, c.target_agent_id)
      where c.id = messages.conversation_id
        and a.owner_id = auth.uid()
    )
  );

drop policy if exists "Owners can insert messages" on public.messages;
create policy "Owners can insert messages"
  on public.messages for insert
  to authenticated
  with check (
    exists (
      select 1 from public.agents a
      where a.id = messages.sender_agent_id
        and a.owner_id = auth.uid()
    )
  );

-- ------------------------------------------------------------------------------
-- 2.5 INBOX ITEMS POLICIES
-- ------------------------------------------------------------------------------
-- Your inbox is strictly private. Only you (the recipient owner) can view,
-- mark as read, or dismiss your findings.
drop policy if exists "Owners have full access to their inbox items" on public.inbox_items;
create policy "Owners have full access to their inbox items"
  on public.inbox_items for all
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());


-- ==============================================================================
-- 3. AUTOMATIC PROFILE TRIGGER ON SIGNUP
-- ==============================================================================
-- When a user registers through Supabase Auth (e.g. email/password), a row is
-- created in the internal 'auth.users' table.
-- This function and trigger automatically creates their public profile in 'public.profiles'
-- copying over the chosen username and handle from signup metadata.
-- ==============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer -- will give access of the admin to the user
set search_path = public, auth, pg_temp
as $$
begin
  insert into public.profiles (id, username, profilename)
  values (
    new.id,
    nullif(trim(new.raw_user_meta_data->>'username'), ''),
    nullif(trim(coalesce(new.raw_user_meta_data->>'profilename', new.raw_user_meta_data->>'name')), '')
  )
  on conflict (id) do update set
    username = coalesce(public.profiles.username, excluded.username),
    profilename = coalesce(public.profiles.profilename, excluded.profilename);
  return new;
end;
$$;

-- Connect the function to the auth.users table on every new signup
-- we are telling server to drop the old automation if any exists
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();


-- ==============================================================================
-- 4. REALTIME PUBLICATION SETUP
-- ==============================================================================
-- In Supabase, the 'supabase_realtime' publication streams database changes
-- over WebSockets directly to the Next.js frontend.
-- This ensures new inbox notifications, conversations, and chat messages
-- appear on screen instantly in real-time without the user having to refresh.
-- ==============================================================================

do $$
begin
  -- Stream live inbox items
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inbox_items') then
    alter publication supabase_realtime add table public.inbox_items;
  end if;
  
  -- Stream live conversation thread status changes
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations') then
    alter publication supabase_realtime add table public.conversations;
  end if;
  
  -- Stream live chat messages between agents
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;


-- ==============================================================================
-- 5. SECURE ACCOUNT DELETION
-- ==============================================================================
-- Allows an authenticated member to invoke permanent deletion of their auth user
-- and public profile record from database context.
-- ==============================================================================
create or replace function public.delete_current_user()
returns void
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_current_user() from public;
grant execute on function public.delete_current_user() to authenticated;


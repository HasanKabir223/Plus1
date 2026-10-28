-- Plus1 Database Schema
-- Idempotent & Re-runnable: Matches screens.md §2, PRD.md §10, and theme.md

-- ============================================================
-- 1. TABLES
-- ============================================================

-- 1.1 Profiles (one per user, auto-linked to auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  handle text unique not null,
  bio text default '',
  looking_for text[] default '{}',
  created_at timestamptz not null default now()
);

-- 1.2 Agents (autonomous network agents)
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

-- 1.3 Conversations (agent-to-agent peer threads)
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  initiator_agent_id uuid not null references public.agents(id) on delete cascade,
  target_agent_id uuid not null references public.agents(id) on delete cascade,
  status text not null default 'live' check (status in ('live', 'done', 'capped')),
  turn_count int not null default 0,
  max_turns int not null default 6,
  created_at timestamptz not null default now()
);

-- 1.4 Messages (chat turns between agents)
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_agent_id uuid not null references public.agents(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

-- 1.5 Inbox Items (agent findings reported to owner)
create table if not exists public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  summary text not null,
  status text not null default 'unread' check (status in ('unread', 'read', 'dismissed')),
  created_at timestamptz not null default now()
);

-- ============================================================
-- 2. ROW LEVEL SECURITY (RLS)
-- ============================================================

alter table public.profiles enable row level security;
alter table public.agents enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.inbox_items enable row level security;

-- Profiles: Authenticated users can read any profile; users only insert/update their own
drop policy if exists "Profiles are viewable by authenticated users" on public.profiles;
create policy "Profiles are viewable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

drop policy if exists "Users can insert their own profile" on public.profiles;
create policy "Users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- Agents: Public agents viewable by all logged-in members; owners have full control
drop policy if exists "Public agents viewable by authenticated users" on public.agents;
create policy "Public agents viewable by authenticated users"
  on public.agents for select
  to authenticated
  using (is_public = true or owner_id = auth.uid());

drop policy if exists "Owners have full control over their agents" on public.agents;
create policy "Owners have full control over their agents"
  on public.agents for all
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Conversations: Viewable and insertable only by owners of the participating agents
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

-- Messages: Viewable and insertable only by owners of participating agents
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

-- Inbox Items: Strictly restricted to the recipient owner
drop policy if exists "Owners have full access to their inbox items" on public.inbox_items;
create policy "Owners have full access to their inbox items"
  on public.inbox_items for all
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- ============================================================
-- 3. AUTOMATIC PROFILE TRIGGER ON AUTH SIGNUP
-- ============================================================

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, handle)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', 'New Member'),
    coalesce(new.raw_user_meta_data->>'handle', 'user_' || substr(new.id::text, 1, 8))
  )
  on conflict (id) do update set
    name = excluded.name,
    handle = excluded.handle;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 4. REALTIME PUBLICATION SETUP
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'inbox_items') then
    alter publication supabase_realtime add table public.inbox_items;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations') then
    alter publication supabase_realtime add table public.conversations;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

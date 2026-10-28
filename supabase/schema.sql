-- Plus1 Database Schema
-- Matches screens.md §2 and theme.md

-- 1. Profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  handle text unique not null,
  bio text default '',
  looking_for text[] default '{}',
  created_at timestamptz not null default now()
);

-- 2. Agents
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

-- 3. Conversations
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  initiator_agent_id uuid not null references public.agents(id) on delete cascade,
  target_agent_id uuid not null references public.agents(id) on delete cascade,
  status text not null default 'live' check (status in ('live', 'done', 'capped')),
  turn_count int not null default 0,
  max_turns int not null default 6,
  created_at timestamptz not null default now()
);

-- 4. Messages
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_agent_id uuid not null references public.agents(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

-- 5. Inbox Items
create table if not exists public.inbox_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  agent_id uuid not null references public.agents(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  summary text not null,
  status text not null default 'unread' check (status in ('unread', 'read', 'dismissed')),
  created_at timestamptz not null default now()
);

-- Row Level Security (RLS)
alter table public.profiles enable row level security;
alter table public.agents enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.inbox_items enable row level security;

-- Profiles: Any logged in user reads; only owner edits
create policy "Profiles are viewable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "Users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

create policy "Users can insert their own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = id);

-- Agents: Owner full access; others read public fields only
create policy "Public agents viewable by authenticated users"
  on public.agents for select
  to authenticated
  using (is_public = true or owner_id = auth.uid());

create policy "Owners have full control over their agents"
  on public.agents for all
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Conversations: Readable by owners of the participating agents only
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

create policy "Agents owners can insert conversations"
  on public.conversations for insert
  to authenticated
  with check (
    exists (
      select 1 from public.agents
      where agents.id = conversations.initiator_agent_id
        and agents.owner_id = auth.uid()
    )
  );

-- Messages: Readable by owners of the participating agents
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

-- Inbox Items: Owner only
create policy "Owners have full access to their inbox items"
  on public.inbox_items for all
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Trigger to create profile upon auth signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, name, handle)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', 'New Member'),
    coalesce(new.raw_user_meta_data->>'handle', 'user_' || substr(new.id::text, 1, 8))
  );
  return new;
end;
$$ language plpgsql security definer;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Enable Realtime
alter publication supabase_realtime add table public.inbox_items;
alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.messages;

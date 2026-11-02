-- ==============================================================================
-- Migration: 20261102_agent_brain_v1
-- Purpose: Cost/abuse-limit counters, agent action log, and the atomic
--          claim_agent_call() gate for the Python agent brain (v1).
--          Apply manually (Supabase SQL editor or `supabase db push`).
--          Depends on: public.agents (id, status). No other dependencies.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Global daily LLM budget counter (one row per UTC day)
-- ------------------------------------------------------------------------------
create table if not exists public.llm_usage_daily (
  day date primary key,
  calls int not null default 0,
  tokens int not null default 0
);

alter table public.llm_usage_daily enable row level security;
-- No policies: only the service role (which bypasses RLS) may touch this table.

-- ------------------------------------------------------------------------------
-- 2. Per-agent daily usage counter (one row per agent per UTC day)
-- ------------------------------------------------------------------------------
create table if not exists public.agent_usage_daily (
  agent_id uuid not null references public.agents(id) on delete cascade,
  day date not null,
  calls int not null default 0,
  last_call_at timestamptz,
  primary key (agent_id, day)
);

alter table public.agent_usage_daily enable row level security;
-- No policies: service role only.

-- ------------------------------------------------------------------------------
-- 3. Action log: one row per agent run (posts, skips, failures, "none")
-- ------------------------------------------------------------------------------
create table if not exists public.action_log (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.agents(id) on delete cascade,
  trigger text,
  action text,
  input_summary jsonb,
  output jsonb,
  status text,
  error text,
  model text,
  tokens_in int,
  tokens_out int,
  latency_ms int,
  created_at timestamptz not null default now()
);

create index if not exists action_log_agent_created_idx
  on public.action_log (agent_id, created_at desc);

alter table public.action_log enable row level security;

-- Owners may read the log rows of their own agents. No client inserts:
-- only the Python backend (service role) writes here.
drop policy if exists "Owners can read their agents' action log" on public.action_log;
create policy "Owners can read their agents' action log"
  on public.action_log for select
  to authenticated
  using (
    exists (
      select 1 from public.agents
      where agents.id = action_log.agent_id
        and agents.owner_id = (select auth.uid())
    )
  );

grant select on public.action_log to authenticated;

-- ------------------------------------------------------------------------------
-- 4. Atomic claim gate: cooldown + per-agent cap + global cap in one transaction
-- ------------------------------------------------------------------------------
-- Every agent run must call this FIRST. It returns jsonb:
--   {ok: boolean, reason: text, retry_after_seconds: int}
-- Reasons: 'ok' | 'paused' | 'cooldown' | 'agent_daily_cap' | 'global_budget'.
--
-- Why it is atomic: the function locks rows in a fixed order
--   (agents row -> agent_usage_daily row -> llm_usage_daily row)
-- with SELECT ... FOR UPDATE, so two simultaneous "Run" clicks serialize:
-- the second one sees the first one's incremented counters and last_call_at.
-- Locks are held until the calling transaction commits, and the increments
-- happen inside this same function, so a pass always consumes budget exactly
-- once. The caller must NOT call the LLM unless ok = true.
create or replace function public.claim_agent_call(
  p_agent_id uuid,
  p_cooldown_seconds int,
  p_agent_daily_cap int,
  p_global_daily_cap int
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
  v_today date := (now() at time zone 'utc')::date;
  v_retry int;
begin
  -- (a) Agent must exist and be active. Lock the agent row first so that
  -- concurrent claims for the same agent queue here.
  select status into v_status
  from public.agents
  where id = p_agent_id
  for update;

  if not found or v_status is distinct from 'active' then
    return jsonb_build_object('ok', false, 'reason', 'paused', 'retry_after_seconds', 0);
  end if;

  -- Lock (creating if needed) today's per-agent counter row.
  insert into public.agent_usage_daily (agent_id, day, calls)
  values (p_agent_id, v_today, 0)
  on conflict (agent_id, day) do nothing;

  select calls, last_call_at into v_agent_calls, v_last_call
  from public.agent_usage_daily
  where agent_id = p_agent_id and day = v_today
  for update;

  -- (b) Per-agent cooldown.
  if v_last_call is not null
     and extract(epoch from (now() - v_last_call)) < p_cooldown_seconds then
    v_retry := p_cooldown_seconds
      - floor(extract(epoch from (now() - v_last_call)))::int;
    return jsonb_build_object('ok', false, 'reason', 'cooldown', 'retry_after_seconds', greatest(v_retry, 1));
  end if;

  -- (c) Per-agent daily cap.
  if v_agent_calls >= p_agent_daily_cap then
    v_retry := greatest(1, floor(extract(epoch from (
      (date_trunc('day', now() at time zone 'utc') + interval '1 day')
      - (now() at time zone 'utc')
    )))::int);
    return jsonb_build_object('ok', false, 'reason', 'agent_daily_cap', 'retry_after_seconds', v_retry);
  end if;

  -- Lock (creating if needed) today's global counter row. This is the last
  -- lock every claim takes, so claims for different agents also serialize
  -- here -- global budget can never be overspent by a race.
  insert into public.llm_usage_daily (day, calls, tokens)
  values (v_today, 0, 0)
  on conflict (day) do nothing;

  select calls into v_global_calls
  from public.llm_usage_daily
  where day = v_today
  for update;

  -- (d) Global daily budget.
  if v_global_calls >= p_global_daily_cap then
    v_retry := greatest(1, floor(extract(epoch from (
      (date_trunc('day', now() at time zone 'utc') + interval '1 day')
      - (now() at time zone 'utc')
    )))::int);
    return jsonb_build_object('ok', false, 'reason', 'global_budget', 'retry_after_seconds', v_retry);
  end if;

  -- (e) Claim: increment both counters and stamp last_call_at.
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

-- Only the service role may execute the claim gate (it bypasses RLS and
-- owns the counters). Authenticated clients get nothing.
revoke all on function public.claim_agent_call(uuid, int, int, int)
  from public, anon, authenticated;
grant execute on function public.claim_agent_call(uuid, int, int, int)
  to service_role;

-- ------------------------------------------------------------------------------
-- 5. Token accounting: add tokens to today's global row (called after each LLM call)
-- ------------------------------------------------------------------------------
-- Single-statement upsert, so concurrent adds cannot lose updates.
create or replace function public.add_llm_tokens(p_tokens int)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.llm_usage_daily (day, calls, tokens)
  values ((now() at time zone 'utc')::date, 0, greatest(coalesce(p_tokens, 0), 0))
  on conflict (day) do update
  set tokens = public.llm_usage_daily.tokens + excluded.tokens;
$$;

revoke all on function public.add_llm_tokens(int)
  from public, anon, authenticated;
grant execute on function public.add_llm_tokens(int)
  to service_role;

-- ------------------------------------------------------------------------------
-- 6. Reload PostgREST schema cache so the new tables/functions are visible
-- ------------------------------------------------------------------------------
notify pgrst, 'reload schema';

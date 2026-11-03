-- ==============================================================================
-- Migration: 20261103_agent_brain_token_cap
-- Purpose: Enforce GLOBAL_DAILY_TOKEN_CAP inside claim_agent_call(), alongside
--          the existing global daily call cap. The llm_usage_daily.tokens
--          counter (fed by add_llm_tokens after each LLM call) is now read
--          under the same locked global row, so a claim fails with
--          'global_token_budget' once today's token spend reaches the cap.
--          Apply manually (Supabase SQL editor or `supabase db push`).
--          Depends on: 20261102_agent_brain_v1.
-- ==============================================================================
--
-- Every agent run must call claim_agent_call() FIRST. It returns jsonb:
--   {ok: boolean, reason: text, retry_after_seconds: int}
-- Reasons: 'ok' | 'paused' | 'cooldown' | 'agent_daily_cap' | 'global_budget'
--          | 'global_token_budget'.
--
-- Lock order is unchanged (agents row -> agent_usage_daily row ->
-- llm_usage_daily row), so concurrent claims still serialize and global
-- budget can never be overspent by a race. The caller must NOT call the LLM
-- unless ok = true.

-- create or replace cannot change the argument list, so drop the 4-arg
-- signature first; the grants below are re-applied to the new signature.
drop function if exists public.claim_agent_call(uuid, int, int, int);

create or replace function public.claim_agent_call(
  p_agent_id uuid,
  p_cooldown_seconds int,
  p_agent_daily_cap int,
  p_global_daily_cap int,
  p_global_daily_token_cap int
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

  select calls, tokens into v_global_calls, v_global_tokens
  from public.llm_usage_daily
  where day = v_today
  for update;

  -- (d) Global daily call budget.
  if v_global_calls >= p_global_daily_cap then
    v_retry := greatest(1, floor(extract(epoch from (
      (date_trunc('day', now() at time zone 'utc') + interval '1 day')
      - (now() at time zone 'utc')
    )))::int);
    return jsonb_build_object('ok', false, 'reason', 'global_budget', 'retry_after_seconds', v_retry);
  end if;

  -- (e) Global daily token budget. Token spend for the day is known from
  -- prior add_llm_tokens calls; a claim at or over the cap waits for UTC
  -- midnight rather than spending more.
  if v_global_tokens >= p_global_daily_token_cap then
    v_retry := greatest(1, floor(extract(epoch from (
      (date_trunc('day', now() at time zone 'utc') + interval '1 day')
      - (now() at time zone 'utc')
    )))::int);
    return jsonb_build_object('ok', false, 'reason', 'global_token_budget', 'retry_after_seconds', v_retry);
  end if;

  -- (f) Claim: increment both counters and stamp last_call_at.
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
revoke all on function public.claim_agent_call(uuid, int, int, int, int)
  from public, anon, authenticated;
grant execute on function public.claim_agent_call(uuid, int, int, int, int)
  to service_role;

-- ------------------------------------------------------------------------------
-- Reload PostgREST schema cache so the new function signature is visible
-- ------------------------------------------------------------------------------
notify pgrst, 'reload schema';

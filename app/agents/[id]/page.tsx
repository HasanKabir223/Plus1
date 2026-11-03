'use client';

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { db, formatRelativeTime } from '@/lib/db';
import { DEFAULT_PERSONALITY, DEFAULT_SKILL_MD } from '@/lib/agent-defaults';
import { supabase } from '@/lib/supabase/client';
import type { Agent, Profile, Conversation, InboxItem, ActionLogEntry } from '@/types/database';
import {
  Play,
  Clock,
  AlertCircle,
  CheckCircle,
  ExternalLink,
  Save,
} from 'lucide-react';

// Python agent-brain API (URL only, not a secret). Local default: uvicorn on :8000.
const AGENT_API_URL = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://127.0.0.1:8000';

// Every outcome of one Run click, rendered inline below the button.
type RunOutcome =
  | {
      kind: 'posted' | 'replied';
      text: string;
      postId: string | null;
      reason: string;
      likesApplied: number;
      parentPostId: string | null;
    }
  | { kind: 'none'; reason: string; likesApplied: number }
  | { kind: 'cooldown'; reason: string; retryAfter: number }
  | { kind: 'paused' }
  | { kind: 'busy' }
  | { kind: 'error'; message: string };

function formatCountdown(totalSeconds: number): string {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const m = Math.floor(s / 60);
  if (m <= 0) return `${s}s`;
  return `${m}m ${s % 60}s`;
}

export default function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const agentId = resolvedParams.id;
  const { user } = useAuth();

  const [agent, setAgent] = useState<Agent | null>(null);
  const [owner, setOwner] = useState<Profile | null>(null);
  const [activity, setActivity] = useState<InboxItem[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit fields for owner
  const [name, setName] = useState('');
  const [personality, setPersonality] = useState('');
  const [skillMd, setSkillMd] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Run state (Python agent brain: POST /agents/{id}/run)
  const [isRunning, setIsRunning] = useState(false);
  const [runOutcome, setRunOutcome] = useState<RunOutcome | null>(null);
  const [cooldownLeft, setCooldownLeft] = useState(0);

  // Recent runs from action_log (owner only, via RLS)
  const [runHistory, setRunHistory] = useState<ActionLogEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const isOwner = Boolean(user && agent && user.id === agent.owner_id);

  const fetchAgentData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const a = await db.getAgent(agentId);
      if (!a) {
        setError('Agent not found');
        return;
      }
      setAgent(a);
      setName(a.name);
      setPersonality(a.personality);
      setSkillMd(a.skill_md);

      const o = await db.getProfile(a.owner_id);
      setOwner(o);

      if (user && user.id === a.owner_id) {
        const inbox = await db.getInboxItems(user.id);
        setActivity(inbox.filter((i) => i.agent_id === a.id));

        const userConvs = await db.getLiveConversationsForUser(user.id);
        setConversations(userConvs.filter((c) => c.initiator_agent_id === a.id || c.target_agent_id === a.id));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load agent');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Mount fetch: state updates land in the .then callback, like home/page.tsx.
    void Promise.resolve().then(() => {
      fetchAgentData();
    });
  }, [agentId, user]);

  const handleToggleStatus = async () => {
    if (!agent || !isOwner) return;
    try {
      const nextStatus = agent.status === 'active' ? 'paused' : 'active';
      const updated = await db.updateAgent(agent.id, { status: nextStatus });
      setAgent(updated);
    } catch (e) {
      console.error(e);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent || !isOwner) return;
    try {
      setIsSaving(true);
      setSaveSuccess(false);
      // Blank fields fall back to the shared defaults.
      const updated = await db.updateAgent(agent.id, {
        name,
        personality: personality.trim() || DEFAULT_PERSONALITY,
        skill_md: skillMd.trim() ? skillMd : DEFAULT_SKILL_MD,
      });
      setAgent(updated);
      setPersonality(updated.personality);
      setSkillMd(updated.skill_md);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const fetchRunHistory = async () => {
    if (!supabase || !agent || !isOwner) return;
    try {
      setHistoryLoading(true);
      setHistoryError(null);
      const { data, error: queryError } = await supabase
        .from('action_log')
        .select('id,agent_id,trigger,action,status,created_at,output,error')
        .eq('agent_id', agent.id)
        .order('created_at', { ascending: false })
        .limit(10);
      if (queryError) {
        // Migration not applied yet (action_log missing): runs show as
        // empty instead of an error wall. Setup is a one-time SQL file.
        const code = (queryError as { code?: string })?.code || '';
        const message = (queryError as { message?: string })?.message || '';
        if (code === 'PGRST205' || code === '42P01' || /does not exist/i.test(message)) {
          setRunHistory([]);
          return;
        }
        throw queryError;
      }
      setRunHistory((data || []) as ActionLogEntry[]);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : 'Could not load recent runs.';
      console.error('[agent-page] load run history failed', agentId, detail);
      setHistoryError(detail);
    } finally {
      setHistoryLoading(false);
    }
  };

  useEffect(() => {
    if (!isOwner || !agent) return;
    // Mount fetch: state updates land in the .then callback, like home/page.tsx.
    void Promise.resolve().then(() => {
      fetchRunHistory();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOwner, agent?.id]);

  // Cooldown countdown: ticks down once a second, re-enables Run at zero.
  useEffect(() => {
    if (cooldownLeft <= 0) return;
    const timer = setTimeout(() => setCooldownLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldownLeft]);

  const handleRunAgent = async () => {
    if (!agent || !user) return;
    if (agent.status === 'paused') {
      setRunOutcome({ kind: 'paused' });
      return;
    }
    try {
      setIsRunning(true);
      setRunOutcome(null);
      if (!supabase) {
        setRunOutcome({ kind: 'error', message: 'Supabase is not configured.' });
        return;
      }
      // Fresh access token on every click; the backend verifies it.
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const token = sessionData.session?.access_token;
      if (!token) {
        setRunOutcome({ kind: 'error', message: 'Your session expired. Sign in again.' });
        return;
      }
      const resp = await fetch(`${AGENT_API_URL}/agents/${agent.id}/run`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      const body = await resp.json().catch(() => ({}));

      if (resp.status === 401) {
        setRunOutcome({ kind: 'error', message: 'Your session expired. Sign in again.' });
        return;
      }
      if (resp.status === 403) {
        setRunOutcome({ kind: 'error', message: 'Only the agent owner can run it.' });
        return;
      }
      if (resp.status === 404) {
        setRunOutcome({ kind: 'error', message: 'Agent not found.' });
        return;
      }
      if (resp.status === 429) {
        const secs = Number(body.retry_after_seconds) || 60;
        setRunOutcome({ kind: 'cooldown', reason: String(body.reason || 'cooldown'), retryAfter: secs });
        setCooldownLeft(secs);
        return;
      }
      if (resp.status === 503) {
        // Provider busy or backend not set up yet: prefer the backend's words.
        const detail = typeof body.message === 'string' && body.message
          ? body.message
          : 'The model is busy. Try again in a bit.';
        setRunOutcome({ kind: 'error', message: detail });
        return;
      }
      if (!resp.ok) {
        throw new Error(`agent brain returned HTTP ${resp.status}`);
      }
      if (body.status === 'posted' || body.status === 'replied') {
        setRunOutcome({
          kind: body.status,
          text: String(body.text || ''),
          postId: body.post_id ? String(body.post_id) : null,
          reason: String(body.reason || ''),
          likesApplied: Number(body.likes_applied) || 0,
          parentPostId: body.parent_post_id ? String(body.parent_post_id) : null,
        });
        await fetchAgentData();
        await fetchRunHistory();
      } else if (body.status === 'none') {
        setRunOutcome({
          kind: 'none',
          reason: String(body.reason || ''),
          likesApplied: Number(body.likes_applied) || 0,
        });
        await fetchRunHistory();
      } else if (body.status === 'skipped') {
        setRunOutcome({ kind: 'paused' });
      } else {
        setRunOutcome({ kind: 'error', message: 'Something went wrong.' });
      }
    } catch (err: unknown) {
      console.error('[agent-page] run agent failed', agentId, err);
      // fetch() itself failing means the backend is unreachable.
      const offline = err instanceof TypeError;
      setRunOutcome({
        kind: 'error',
        message: offline
          ? 'Could not reach the agent server. Is the backend running?'
          : 'Something went wrong.',
      });
    } finally {
      setIsRunning(false);
    }
  };

  const lines = skillMd.split('\n');

  if (isLoading) {
    return (
      <AppShell headerTitle="Agent detail">
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-soft)' }}>
          Loading agent...
        </div>
      </AppShell>
    );
  }

  if (error || !agent) {
    return (
      <AppShell headerTitle="Agent detail">
        <div style={{ padding: '60px 20px', textAlign: 'center' }}>
          <AlertCircle size={36} color="var(--err)" style={{ margin: '0 auto 12px' }} />
          <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>Agent not found</h2>
          <p style={{ fontSize: '14px', color: 'var(--ink-soft)', marginBottom: '16px' }}>
            The requested agent could not be found or has been deleted.
          </p>
          <Link href="/explore" className="btn-secondary" style={{ fontSize: '13px', padding: '6px 14px' }}>
            Back to Explore
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell headerTitle={agent.name}>
      <div>
        {/* Top Header Card */}
        <div className="screen-section" style={{ borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '14px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0, flex: '1 1 200px' }}>
              {/* Agent Avatar: rounded square (8px radius) in --agent */}
              <div
                style={{
                  width: '52px',
                  height: '52px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--agent)',
                  border: '1.5px solid var(--ink)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '22px',
                  color: 'var(--ink)',
                  flexShrink: 0,
                }}
              >
                {agent.name.charAt(0)}
              </div>

              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--ink)', wordBreak: 'break-word' }}>{agent.name}</h1>
                  <span
                    className="chip chip-agent"
                    style={{ fontSize: '11px', padding: '2px 8px' }}
                  >
                    {agent.status}
                  </span>
                </div>
                {owner && (
                  <div style={{ fontSize: '13px', color: 'var(--ink-soft)', marginTop: '2px', wordBreak: 'break-word' }}>
                    Owned by{' '}
                    <Link href={`/u/${owner.username}`} style={{ color: 'var(--human)', fontWeight: 600 }}>
                      @{owner.username}
                    </Link>
                  </div>
                )}
              </div>
            </div>

            {/* Run button & Pause toggle for Owner */}
            {isOwner && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  onClick={handleToggleStatus}
                  className="btn-secondary"
                  style={{ padding: '8px 14px', fontSize: '13px' }}
                >
                  {agent.status === 'active' ? 'Pause agent' : 'Resume agent'}
                </button>
                <button
                  onClick={handleRunAgent}
                  disabled={isRunning || cooldownLeft > 0 || agent.status === 'paused'}
                  className="btn-primary"
                  style={{
                    padding: '8px 16px',
                    fontSize: '13px',
                    opacity: agent.status === 'paused' || cooldownLeft > 0 ? 0.4 : 1,
                  }}
                >
                  {isRunning ? (
                    'Running...'
                  ) : cooldownLeft > 0 ? (
                    `Run now (${formatCountdown(cooldownLeft)})`
                  ) : (
                    <>
                      <Play size={13} /> Run now
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {/* Last run status & run notices */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '13px',
              color: 'var(--ink-soft)',
              marginBottom: '12px',
            }}
          >
            <Clock size={14} />
            <span>Last run: {formatRelativeTime(agent.last_run_at)}</span>
            {agent.status === 'paused' && (
              <span style={{ color: 'var(--warn)', fontWeight: 600, marginLeft: '8px' }}>
                (Agent is paused — automated runs and peer outreach are suspended)
              </span>
            )}
          </div>

          {/* Run outcome notice (one Run click, plain language) */}
          {runOutcome && (
            <div
              role="status"
              aria-live="polite"
              style={{
                marginTop: '14px',
                padding: '14px',
                backgroundColor:
                  runOutcome.kind === 'error' ? 'var(--surface)' : 'var(--agent-tint)',
                border: `1px solid ${
                  runOutcome.kind === 'error' ? 'var(--err)' : 'var(--agent)'
                }`,
                borderRadius: 'var(--radius-sm)',
                fontSize: '14px',
              }}
            >
              {(runOutcome.kind === 'posted' || runOutcome.kind === 'replied') && (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, marginBottom: '4px' }}>
                    <CheckCircle size={16} color="var(--ink)" />
                    <span>
                      {runOutcome.kind === 'posted'
                        ? runOutcome.likesApplied > 0
                          ? `Posted and liked ${runOutcome.likesApplied} post${runOutcome.likesApplied === 1 ? '' : 's'}.`
                          : 'Posted.'
                        : runOutcome.likesApplied > 0
                          ? `Commented and liked ${runOutcome.likesApplied} post${runOutcome.likesApplied === 1 ? '' : 's'}.`
                          : 'Commented.'}
                    </span>
                  </div>
                  <p style={{ color: 'var(--ink)', lineHeight: 1.45 }}>{runOutcome.text}</p>
                  <div style={{ marginTop: '8px', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <Link
                      href="/home?tab=feed"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        color: 'var(--human)',
                        fontWeight: 600,
                        fontSize: '13px',
                      }}
                    >
                      <span>See it in the Feed</span>
                      <ExternalLink size={12} />
                    </Link>
                    {runOutcome.kind === 'replied' && runOutcome.parentPostId && (
                      <Link
                        href={`/posts/${runOutcome.parentPostId}`}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          color: 'var(--human)',
                          fontWeight: 600,
                          fontSize: '13px',
                        }}
                      >
                        <span>View the comment</span>
                        <ExternalLink size={12} />
                      </Link>
                    )}
                  </div>
                </>
              )}
              {runOutcome.kind === 'none' && (
                <>
                  <div style={{ fontWeight: 700, marginBottom: '4px' }}>
                    {runOutcome.likesApplied > 0
                      ? `Liked ${runOutcome.likesApplied} post${runOutcome.likesApplied === 1 ? '' : 's'}.`
                      : 'Chose not to post.'}
                  </div>
                  <p style={{ color: 'var(--ink-soft)', fontSize: '13px', lineHeight: 1.45 }}>
                    {runOutcome.reason}
                  </p>
                </>
              )}
              {runOutcome.kind === 'cooldown' && (
                <>
                  <div style={{ fontWeight: 700, marginBottom: '4px' }}>
                    {runOutcome.reason === 'cooldown'
                      ? `Try again in ${formatCountdown(cooldownLeft)}.`
                      : runOutcome.reason === 'agent_daily_cap'
                        ? 'Daily limit reached for this agent. Try again tomorrow.'
                        : 'Network budget used up for today. Try again tomorrow.'}
                  </div>
                  <p style={{ color: 'var(--ink-soft)', fontSize: '13px' }}>
                    {runOutcome.reason === 'cooldown'
                      ? 'The agent needs a breather between runs.'
                      : `The run was skipped (${runOutcome.reason}). Nothing was posted.`}
                  </p>
                </>
              )}
              {runOutcome.kind === 'paused' && (
                <div style={{ fontWeight: 700 }}>This agent is paused.</div>
              )}
              {runOutcome.kind === 'busy' && (
                <div style={{ fontWeight: 700 }}>The model is busy. Try again in a bit.</div>
              )}
              {runOutcome.kind === 'error' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--err)' }}>
                  <AlertCircle size={16} />
                  <span>{runOutcome.message}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Owner View vs Public View */}
        {isOwner ? (
          /* Owner Config Form */
          <div className="screen-section" style={{ borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                Agent Configuration
              </h2>
              {saveSuccess && (
                <span style={{ fontSize: '13px', color: 'var(--ok)', fontWeight: 600 }}>
                  ✓ Changes saved
                </span>
              )}
            </div>

            <form onSubmit={handleSaveConfig} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  Agent name
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--line)',
                    backgroundColor: 'var(--surface)',
                    fontSize: '14px',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px' }}>
                  Personality & focus (public summary)
                </label>
                <textarea
                  value={personality}
                  onChange={(e) => setPersonality(e.target.value)}
                  rows={3}
                  required
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--line)',
                    backgroundColor: 'var(--surface)',
                    fontSize: '14px',
                    resize: 'none',
                  }}
                />
              </div>

              {/* Skill.md editor */}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', flexWrap: 'wrap', gap: '6px' }}>
                  <label style={{ fontSize: '13px', fontWeight: 600 }}>
                    Behavior instructions (<code>skill.md</code>)
                  </label>
                  <span style={{ fontSize: '12px', color: 'var(--ink-soft)', fontFamily: 'var(--font-mono)' }}>
                    {skillMd.length} / 8000
                  </span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: '#FFFFFF',
                    overflow: 'hidden',
                    minHeight: '200px',
                    maxWidth: '100%',
                  }}
                >
                  <div
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderRight: '1px solid var(--line)',
                      padding: '10px 8px',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '12px',
                      lineHeight: '1.5',
                      color: 'var(--ink-soft)',
                      userSelect: 'none',
                      textAlign: 'right',
                      width: '38px',
                      flexShrink: 0,
                    }}
                  >
                    {lines.map((_, i) => (
                      <div key={i}>{i + 1}</div>
                    ))}
                  </div>

                  <textarea
                    value={skillMd}
                    onChange={(e) => setSkillMd(e.target.value)}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: '10px 12px',
                      border: 'none',
                      outline: 'none',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '13px',
                      lineHeight: '1.5',
                      color: 'var(--ink)',
                      backgroundColor: '#FFFFFF',
                      resize: 'vertical',
                      minHeight: '180px',
                    }}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSaving}
                className="btn-primary"
                style={{ alignSelf: 'flex-start', padding: '8px 16px', fontSize: '13px' }}
              >
                <Save size={13} /> {isSaving ? 'Saving...' : 'Save configuration'}
              </button>
            </form>
          </div>
        ) : (
          /* Public Read-only view */
          <div className="screen-section" style={{ borderBottom: '1px solid var(--line)' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '8px' }}>About this agent</h2>
            <p style={{ fontSize: '14px', lineHeight: 1.5, color: 'var(--ink)', wordBreak: 'break-word' }}>{agent.personality}</p>
          </div>
        )}

        {/* Recent runs from action_log (Owner only, via RLS) */}
        {isOwner && (
          <div className="screen-section" style={{ borderBottom: '1px solid var(--line)' }}>
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 700, marginBottom: '14px' }}>
              Recent runs
            </h2>

            {historyLoading ? (
              <div style={{ padding: '16px 0', color: 'var(--ink-soft)', fontSize: '14px' }}>
                Loading recent runs...
              </div>
            ) : historyError ? (
              <div
                role="alert"
                style={{
                  padding: '12px 14px',
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--err)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--err)',
                  fontSize: '13px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <AlertCircle size={16} />
                <span>Could not load recent runs: {historyError}</span>
              </div>
            ) : runHistory.length === 0 ? (
              <p style={{ fontSize: '13px', color: 'var(--ink-soft)' }}>
                No runs recorded yet. Click &ldquo;Run now&rdquo; above to wake {agent.name} up.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {runHistory.map((entry) => (
                  <div
                    key={entry.id}
                    style={{
                      padding: '10px 0',
                      borderBottom: '1px solid var(--line)',
                      display: 'flex',
                      alignItems: 'baseline',
                      gap: '10px',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ fontSize: '12px', color: 'var(--ink-soft)', minWidth: '70px' }}>
                      {formatRelativeTime(entry.created_at)}
                    </span>
                    <span className="chip chip-agent" style={{ fontSize: '10px', padding: '1px 6px' }}>
                      {entry.action || 'run'}
                    </span>
                    <span style={{ fontSize: '13px', color: 'var(--ink)' }}>
                      {entry.status || 'unknown'}
                      {entry.output?.reason ? ` — ${entry.output.reason}` : ''}
                      {entry.error ? ` (${entry.error})` : ''}
                      {(() => {
                        const likeCount =
                          entry.output?.likes_applied ??
                          entry.output?.like_post_ids?.length ??
                          0;
                        return likeCount > 0
                          ? ` · Liked ${likeCount} post${likeCount === 1 ? '' : 's'}`
                          : '';
                      })()}
                      {entry.status === 'replied' && entry.output?.parent_post_id
                        ? ' · Commented'
                        : ''}
                    </span>
                    {entry.status === 'replied' && entry.output?.parent_post_id && (
                      <Link
                        href={`/posts/${entry.output.parent_post_id}`}
                        style={{ fontSize: '12px', fontWeight: 600, color: 'var(--human)' }}
                      >
                        View comment
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Recent Activity List (Owner only) */}
        {isOwner && (
          <div className="screen-section">
            <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 700, marginBottom: '14px' }}>
              Recent agent reports & activity
            </h2>

            {activity.length === 0 && conversations.length === 0 ? (
              <div
                style={{
                  padding: '24px',
                  backgroundColor: 'var(--surface)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius-sm)',
                  textAlign: 'center',
                }}
              >
                <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink)', marginBottom: '4px' }}>
                  No activity recorded yet for {agent.name}.
                </p>
                <p style={{ fontSize: '13px', color: 'var(--ink-soft)' }}>
                  Click &ldquo;Run agent&rdquo; above to dispatch {agent.name} onto the network.
                </p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {activity.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      padding: '14px 0',
                      borderBottom: '1px solid var(--line)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '4px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="chip chip-agent" style={{ fontSize: '10px', padding: '1px 6px' }}>
                        Report
                      </span>
                      <span style={{ fontSize: '12px', color: 'var(--ink-soft)' }}>
                        {formatRelativeTime(item.created_at)}
                      </span>
                    </div>
                    <p style={{ fontSize: '13px', color: 'var(--ink)', lineHeight: 1.45 }}>{item.summary}</p>
                    {item.conversation_id && (
                      <Link
                        href={`/threads/${item.conversation_id}`}
                        style={{
                          fontSize: '12px',
                          fontWeight: 600,
                          color: 'var(--human)',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          marginTop: '2px',
                        }}
                      >
                        <span>Open thread</span>
                        <ExternalLink size={11} />
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}

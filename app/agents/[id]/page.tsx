'use client';

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { db, formatRelativeTime } from '@/lib/db';
import type { Agent, Profile, Conversation, InboxItem } from '@/types/database';
import {
  Play,
  Clock,
  AlertCircle,
  CheckCircle,
  ExternalLink,
  Save,
  Radio,
} from 'lucide-react';

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

  // Run state
  const [isRunning, setIsRunning] = useState(false);
  const [runResult, setRunResult] = useState<InboxItem | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

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
    fetchAgentData();
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
      const updated = await db.updateAgent(agent.id, {
        name,
        personality,
        skill_md: skillMd,
      });
      setAgent(updated);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSaving(false);
    }
  };

  const handleRunAgent = async () => {
    if (!agent || !user) return;
    if (agent.status === 'paused') {
      setRunError('Agent is paused. Resume the agent before running.');
      return;
    }
    try {
      setIsRunning(true);
      setRunError(null);
      setRunResult(null);
      const result = await db.runAgent(agent.id, user.id);
      setRunResult(result);
      await fetchAgentData();
    } catch (err: unknown) {
      setRunError(err instanceof Error ? err.message : 'Run failed');
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
        <div style={{ borderBottom: '1px solid var(--line)', padding: '24px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', marginBottom: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              {/* Agent Avatar: rounded square (8px radius) in --agent */}
              <div
                style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: '8px',
                  backgroundColor: 'var(--agent)',
                  border: '1.5px solid var(--ink)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontWeight: 700,
                  fontSize: '22px',
                  color: 'var(--ink)',
                }}
              >
                {agent.name.charAt(0)}
              </div>

              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--ink)' }}>{agent.name}</h1>
                  <span
                    className="chip chip-agent"
                    style={{ fontSize: '11px', padding: '2px 8px' }}
                  >
                    {agent.status}
                  </span>
                </div>
                {owner && (
                  <div style={{ fontSize: '13px', color: 'var(--ink-soft)', marginTop: '2px' }}>
                    Owned by{' '}
                    <Link href={`/u/${owner.handle}`} style={{ color: 'var(--human)', fontWeight: 600 }}>
                      @{owner.handle}
                    </Link>
                  </div>
                )}
              </div>
            </div>

            {/* Run button & Pause toggle for Owner */}
            {isOwner && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <button
                  onClick={handleToggleStatus}
                  className="btn-secondary"
                  style={{ padding: '8px 14px', fontSize: '13px' }}
                >
                  {agent.status === 'active' ? 'Pause agent' : 'Resume agent'}
                </button>
                <button
                  onClick={handleRunAgent}
                  disabled={isRunning || agent.status === 'paused'}
                  className="btn-primary"
                  style={{
                    padding: '8px 16px',
                    fontSize: '13px',
                    opacity: agent.status === 'paused' ? 0.4 : 1,
                  }}
                >
                  {isRunning ? (
                    'Executing run...'
                  ) : (
                    <>
                      <Play size={13} /> Run agent
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

          {/* Run result notice */}
          {runResult && (
            <div
              style={{
                marginTop: '14px',
                padding: '14px',
                backgroundColor: 'var(--agent-tint)',
                border: '1px solid var(--agent)',
                borderRadius: 'var(--radius-sm)',
                fontSize: '14px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 700, marginBottom: '4px' }}>
                <CheckCircle size={16} color="var(--ink)" />
                <span>Run completed successfully</span>
              </div>
              <p style={{ color: 'var(--ink)', lineHeight: 1.45 }}>{runResult.summary}</p>
              {runResult.conversation_id && (
                <div style={{ marginTop: '8px' }}>
                  <Link
                    href={`/threads/${runResult.conversation_id}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                      color: 'var(--human)',
                      fontWeight: 600,
                      fontSize: '13px',
                    }}
                  >
                    <span>View full conversation thread</span>
                    <ExternalLink size={12} />
                  </Link>
                </div>
              )}
            </div>
          )}

          {runError && (
            <div
              style={{
                marginTop: '14px',
                padding: '12px 14px',
                backgroundColor: '#FFF5F5',
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
              <span>{runError}</span>
            </div>
          )}
        </div>

        {/* Owner View vs Public View */}
        {isOwner ? (
          /* Owner Config Form */
          <div style={{ padding: '24px 20px', borderBottom: '1px solid var(--line)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
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
          <div style={{ padding: '24px 20px', borderBottom: '1px solid var(--line)' }}>
            <h2 style={{ fontSize: '15px', fontWeight: 700, marginBottom: '8px' }}>About this agent</h2>
            <p style={{ fontSize: '14px', lineHeight: 1.5, color: 'var(--ink)' }}>{agent.personality}</p>
          </div>
        )}

        {/* Recent Activity List (Owner only) */}
        {isOwner && (
          <div style={{ padding: '20px' }}>
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

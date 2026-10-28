'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { db, formatRelativeTime } from '@/lib/db';
import type { Agent, InboxItem, Conversation } from '@/types/database';
import {
  Play,
  RotateCw,
  ExternalLink,
  X,
  Plus,
  AlertCircle,
  Clock,
  Radio,
} from 'lucide-react';

export default function HomePage() {
  const router = useRouter();
  const { user } = useAuth();

  // Section 1: Agents
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(true);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [runningAgentId, setRunningAgentId] = useState<string | null>(null);

  // Section 2: Inbox
  const [inboxItems, setInboxItems] = useState<InboxItem[]>([]);
  const [loadingInbox, setLoadingInbox] = useState(true);
  const [inboxError, setInboxError] = useState<string | null>(null);

  // Section 3: Live Threads
  const [liveThreads, setLiveThreads] = useState<
    (Conversation & { initiator: Agent | null; target: Agent | null })[]
  >([]);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [threadsError, setThreadsError] = useState<string | null>(null);

  // Load section 1
  const fetchAgents = async () => {
    if (!user) return;
    try {
      setAgentsError(null);
      const data = await db.getAgentsByOwner(user.id);
      setAgents(data);
    } catch (e: unknown) {
      setAgentsError(e instanceof Error ? e.message : 'Failed to load agents');
    } finally {
      setLoadingAgents(false);
    }
  };

  // Load section 2
  const fetchInbox = async () => {
    if (!user) return;
    try {
      setInboxError(null);
      const data = await db.getInboxItems(user.id);
      setInboxItems(data);
    } catch (e: unknown) {
      setInboxError(e instanceof Error ? e.message : 'Failed to load inbox');
    } finally {
      setLoadingInbox(false);
    }
  };

  // Load section 3
  const fetchThreads = async () => {
    if (!user) return;
    try {
      setThreadsError(null);
      const data = await db.getLiveConversationsForUser(user.id);
      setLiveThreads(data);
    } catch (e: unknown) {
      setThreadsError(e instanceof Error ? e.message : 'Failed to load live threads');
    } finally {
      setLoadingThreads(false);
    }
  };

  useEffect(() => {
    fetchAgents();
    fetchInbox();
    fetchThreads();

    const unsubAgents = db.subscribe('agents', fetchAgents);
    const unsubInbox = db.subscribe('inbox', fetchInbox);
    const unsubConvs = db.subscribe('conversations', fetchThreads);

    return () => {
      unsubAgents();
      unsubInbox();
      unsubConvs();
    };
  }, [user]);

  // Actions
  const handleToggleStatus = async (agent: Agent) => {
    try {
      const nextStatus = agent.status === 'active' ? 'paused' : 'active';
      await db.updateAgent(agent.id, { status: nextStatus });
      await fetchAgents();
    } catch (e) {
      console.error(e);
    }
  };

  const handleRunAgent = async (agentId: string) => {
    if (!user) return;
    try {
      setRunningAgentId(agentId);
      await db.runAgent(agentId, user.id);
      await Promise.all([fetchAgents(), fetchInbox(), fetchThreads()]);
    } catch (e) {
      console.error(e);
    } finally {
      setRunningAgentId(null);
    }
  };

  const handleDismissInbox = async (itemId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await db.dismissInboxItem(itemId);
      await fetchInbox();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <AppShell headerTitle="Home">
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {/* ============================================================ */}
        {/* SECTION 1: AGENT STATUS STRIP                                */}
        {/* ============================================================ */}
        <section className="screen-section" style={{ borderBottom: '1px solid var(--line)' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '14px',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '16px',
                  fontWeight: 700,
                  color: 'var(--ink)',
                }}
              >
                Agent status strip
              </span>
              <span
                style={{
                  fontSize: '12px',
                  color: 'var(--ink-soft)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                ({agents.length})
              </span>
            </div>
            <Link
              href="/agents/new"
              className="btn-secondary"
              style={{ padding: '6px 12px', fontSize: '13px' }}
            >
              <Plus size={14} /> New agent
            </Link>
          </div>

          {loadingAgents ? (
            <div style={{ padding: '20px 0', color: 'var(--ink-soft)', fontSize: '14px' }}>
              Loading agents...
            </div>
          ) : agentsError ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px',
                backgroundColor: '#FFF5F5',
                border: '1px solid var(--err)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--err)',
                fontSize: '13px',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <AlertCircle size={16} />
                <span>{agentsError}</span>
              </div>
              <button
                onClick={fetchAgents}
                style={{
                  fontWeight: 600,
                  color: 'var(--ink)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <RotateCw size={12} /> Retry
              </button>
            </div>
          ) : agents.length === 0 ? (
            /* Empty state 1: No agents */
            <div
              style={{
                padding: '24px 16px',
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                textAlign: 'center',
              }}
            >
              <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink)', marginBottom: '4px' }}>
                You have no agents deployed.
              </p>
              <p style={{ fontSize: '13px', color: 'var(--ink-soft)', marginBottom: '14px' }}>
                Create your first agent to browse the network, talk to other agents, and report leads back.
              </p>
              <Link href="/agents/new" className="btn-primary" style={{ fontSize: '13px', padding: '8px 16px' }}>
                <Plus size={14} /> Create your first agent
              </Link>
            </div>
          ) : (
            /* Populated state */
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 14px',
                    backgroundColor: 'var(--surface)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-sm)',
                    flexWrap: 'wrap',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: '1 1 180px' }}>
                    {/* Agent avatar: rounded square in --agent */}
                    <div
                      style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        backgroundColor: 'var(--agent)',
                        border: '1px solid var(--ink)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '13px',
                        fontWeight: 700,
                        color: 'var(--ink)',
                        flexShrink: 0,
                      }}
                    >
                      {agent.name.charAt(0)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <Link
                        href={`/agents/${agent.id}`}
                        style={{
                          fontSize: '14px',
                          fontWeight: 700,
                          color: 'var(--ink)',
                          textDecoration: 'none',
                          wordBreak: 'break-word',
                          display: 'block',
                        }}
                      >
                        {agent.name}
                      </Link>
                      <div
                        style={{
                          fontSize: '12px',
                          color: 'var(--ink-soft)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                          marginTop: '2px',
                        }}
                      >
                        <Clock size={12} />
                        <span>Last run: {formatRelativeTime(agent.last_run_at)}</span>
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
                    {/* Active / Paused switch */}
                    <button
                      onClick={() => handleToggleStatus(agent)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '4px 10px',
                        borderRadius: 'var(--radius-pill)',
                        fontSize: '12px',
                        fontWeight: 600,
                        border: '1px solid var(--line)',
                        backgroundColor: agent.status === 'active' ? 'var(--agent-tint)' : 'var(--paper)',
                        color: agent.status === 'active' ? 'var(--ink)' : 'var(--ink-soft)',
                        cursor: 'pointer',
                      }}
                      title="Toggle active/paused status"
                    >
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          backgroundColor: agent.status === 'active' ? 'var(--ok)' : 'var(--warn)',
                        }}
                      />
                      {agent.status}
                    </button>

                    {/* Run now button */}
                    <button
                      onClick={() => handleRunAgent(agent.id)}
                      disabled={runningAgentId === agent.id || agent.status === 'paused'}
                      className="btn-primary"
                      style={{
                        padding: '6px 14px',
                        fontSize: '13px',
                        opacity: agent.status === 'paused' ? 0.4 : 1,
                      }}
                    >
                      {runningAgentId === agent.id ? (
                        'Running...'
                      ) : (
                        <>
                          <Play size={12} /> Run now
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ============================================================ */}
        {/* SECTION 2: INBOX (AGENT REPORTS TO OWNER)                    */}
        {/* ============================================================ */}
        <section id="inbox" className="screen-section" style={{ borderBottom: '1px solid var(--line)' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '14px',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '16px',
                  fontWeight: 700,
                  color: 'var(--ink)',
                }}
              >
                Owner inbox
              </span>
              <span
                style={{
                  fontSize: '12px',
                  color: 'var(--ink-soft)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                ({inboxItems.length})
              </span>
            </div>
            <button
              onClick={fetchInbox}
              style={{
                color: 'var(--ink-soft)',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
              }}
            >
              <RotateCw size={12} /> Refresh
            </button>
          </div>

          {loadingInbox ? (
            <div style={{ padding: '24px 0', color: 'var(--ink-soft)', fontSize: '14px' }}>
              Loading inbox items...
            </div>
          ) : inboxError ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px',
                backgroundColor: '#FFF5F5',
                border: '1px solid var(--err)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--err)',
                fontSize: '13px',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <span>{inboxError}</span>
              <button onClick={fetchInbox} style={{ fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }}>
                Retry
              </button>
            </div>
          ) : inboxItems.length === 0 ? (
            /* Empty state 2: No inbox results */
            <div
              style={{
                padding: '32px 16px',
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                textAlign: 'center',
              }}
            >
              <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink)', marginBottom: '4px' }}>
                Your agent hasn&apos;t reported yet.
              </p>
              <p style={{ fontSize: '13px', color: 'var(--ink-soft)', marginBottom: '16px' }}>
                Click &ldquo;Run now&rdquo; on an agent above to send it out onto the network to talk with peer agents.
              </p>
              {agents.length > 0 && (
                <button
                  onClick={() => handleRunAgent(agents[0].id)}
                  disabled={runningAgentId === agents[0].id}
                  className="btn-primary"
                  style={{ fontSize: '13px', padding: '8px 16px' }}
                >
                  <Play size={12} /> Run {agents[0].name} now
                </button>
              )}
            </div>
          ) : (
            /* Populated dense rows */
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {inboxItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => item.conversation_id && router.push(`/threads/${item.conversation_id}`)}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: '12px',
                    padding: '14px 2px',
                    borderBottom: '1px solid var(--line)',
                    cursor: item.conversation_id ? 'pointer' : 'default',
                    transition: 'background-color 100ms ease',
                  }}
                >
                  <div style={{ display: 'flex', gap: '10px', flex: 1, minWidth: 0 }}>
                    {/* Unread marker */}
                    <div style={{ paddingTop: '5px', flexShrink: 0 }}>
                      <span
                        style={{
                          display: 'block',
                          width: '8px',
                          height: '8px',
                          borderRadius: '50%',
                          backgroundColor: item.status === 'unread' ? 'var(--human)' : 'transparent',
                          border: item.status === 'unread' ? 'none' : '1px solid var(--line)',
                        }}
                      />
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          marginBottom: '4px',
                          flexWrap: 'wrap',
                        }}
                      >
                        <span
                          className="chip chip-agent"
                          style={{ fontSize: '11px', padding: '2px 8px' }}
                        >
                          Report
                        </span>
                        <span style={{ fontSize: '12px', color: 'var(--ink-soft)' }}>
                          {formatRelativeTime(item.created_at)}
                        </span>
                      </div>

                      <p
                        style={{
                          fontSize: '14px',
                          lineHeight: 1.45,
                          color: 'var(--ink)',
                          fontWeight: item.status === 'unread' ? 600 : 400,
                          marginBottom: '8px',
                          wordBreak: 'break-word',
                        }}
                      >
                        {item.summary}
                      </p>

                      {item.conversation_id && (
                        <div
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '12px',
                            fontWeight: 600,
                            color: 'var(--human)',
                            wordBreak: 'break-word',
                          }}
                        >
                          <span>Open conversation thread</span>
                          <ExternalLink size={12} />
                        </div>
                      )}
                    </div>
                  </div>

                  <button
                    onClick={(e) => handleDismissInbox(item.id, e)}
                    style={{
                      padding: '4px',
                      color: 'var(--ink-soft)',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      flexShrink: 0,
                    }}
                    title="Dismiss"
                  >
                    <X size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ============================================================ */}
        {/* SECTION 3: LIVE THREADS                                      */}
        {/* ============================================================ */}
        <section className="screen-section">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '14px',
              flexWrap: 'wrap',
              gap: '8px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '16px',
                  fontWeight: 700,
                  color: 'var(--ink)',
                }}
              >
                Live threads
              </span>
              <span
                style={{
                  fontSize: '12px',
                  color: 'var(--ink-soft)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                ({liveThreads.length})
              </span>
            </div>
            <button
              onClick={fetchThreads}
              style={{
                color: 'var(--ink-soft)',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
              }}
            >
              <RotateCw size={12} /> Refresh
            </button>
          </div>

          {loadingThreads ? (
            <div style={{ padding: '20px 0', color: 'var(--ink-soft)', fontSize: '14px' }}>
              Loading live threads...
            </div>
          ) : threadsError ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px',
                backgroundColor: '#FFF5F5',
                border: '1px solid var(--err)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--err)',
                fontSize: '13px',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <span>{threadsError}</span>
              <button onClick={fetchThreads} style={{ fontWeight: 600, color: 'var(--ink)', cursor: 'pointer' }}>
                Retry
              </button>
            </div>
          ) : liveThreads.length === 0 ? (
            /* Empty state 3: No live threads */
            <div
              style={{
                padding: '24px 16px',
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                textAlign: 'center',
              }}
            >
              <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink)', marginBottom: '4px' }}>
                No active agent-to-agent threads.
              </p>
              <p style={{ fontSize: '13px', color: 'var(--ink-soft)' }}>
                When your agent engages with other agents on the network, the live conversation turns will stream here.
              </p>
            </div>
          ) : (
            /* Populated dense rows */
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {liveThreads.map((thread) => (
                <div
                  key={thread.id}
                  onClick={() => router.push(`/threads/${thread.id}`)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 4px',
                    borderBottom: '1px solid var(--line)',
                    cursor: 'pointer',
                    transition: 'background-color 100ms ease',
                    flexWrap: 'wrap',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: '1 1 200px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                      {/* Initiator agent badge */}
                      <div
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '6px',
                          backgroundColor: 'var(--agent)',
                          border: '1px solid var(--ink)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '11px',
                          color: 'var(--ink)',
                        }}
                      >
                        {thread.initiator?.name.charAt(0) || 'A'}
                      </div>
                      <span style={{ margin: '0 4px', color: 'var(--ink-soft)', fontSize: '12px' }}>↔</span>
                      {/* Target agent badge */}
                      <div
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '6px',
                          backgroundColor: 'var(--surface)',
                          border: '1px solid var(--line)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '11px',
                          color: 'var(--ink)',
                        }}
                      >
                        {thread.target?.name.charAt(0) || 'P'}
                      </div>
                    </div>

                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--ink)', wordBreak: 'break-word' }}>
                        {thread.initiator?.name || 'Agent'} and {thread.target?.name || 'Peer'}
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--ink-soft)' }}>
                        Started {formatRelativeTime(thread.created_at)}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap' }}>
                    {thread.status === 'live' && (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          backgroundColor: 'var(--agent-tint)',
                          color: 'var(--ink)',
                          fontSize: '11px',
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 'var(--radius-pill)',
                        }}
                      >
                        <Radio size={12} color="var(--ok)" /> LIVE
                      </span>
                    )}

                    {/* Turn counter */}
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12px',
                        backgroundColor: 'var(--surface)',
                        padding: '4px 8px',
                        borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--line)',
                        color: 'var(--ink)',
                      }}
                    >
                      {thread.turn_count} / {thread.max_turns} turns
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </AppShell>
  );
}

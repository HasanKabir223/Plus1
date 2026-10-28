'use client';

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { db, formatRelativeTime } from '@/lib/db';
import type { Conversation, Agent, Profile, Message } from '@/types/database';
import {
  Radio,
  Clock,
  ArrowLeft,
  AlertCircle,
  Pin,
  RotateCw,
} from 'lucide-react';

interface ThreadData {
  conversation: Conversation;
  initiator: Agent | null;
  target: Agent | null;
  initiatorOwner: Profile | null;
  targetOwner: Profile | null;
  messages: (Message & { sender: Agent | null })[];
  pinnedReport: string | null;
}

export default function ThreadViewPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const threadId = resolvedParams.id;
  const { user } = useAuth();

  const [threadData, setThreadData] = useState<ThreadData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchThread = async () => {
    try {
      setError(null);
      const data = await db.getThread(threadId);
      if (!data) {
        setError('Conversation thread not found or access denied');
        return;
      }
      setThreadData(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load thread');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchThread();

    // Realtime subscription per screens.md §3.9
    const unsub = db.subscribe('messages', fetchThread);
    return () => unsub();
  }, [threadId]);

  if (isLoading) {
    return (
      <AppShell headerTitle="Conversation thread">
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-soft)' }}>
          Loading thread...
        </div>
      </AppShell>
    );
  }

  if (error || !threadData) {
    return (
      <AppShell headerTitle="Conversation thread">
        <div style={{ padding: '60px 20px', textAlign: 'center' }}>
          <AlertCircle size={36} color="var(--err)" style={{ margin: '0 auto 12px' }} />
          <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>Thread unavailable</h2>
          <p style={{ fontSize: '14px', color: 'var(--ink-soft)', marginBottom: '16px' }}>
            {error || 'This conversation is restricted to the owners of the participating agents.'}
          </p>
          <Link href="/home" className="btn-secondary" style={{ fontSize: '13px', padding: '6px 14px' }}>
            Back to Home
          </Link>
        </div>
      </AppShell>
    );
  }

  const { conversation, initiator, target, initiatorOwner, targetOwner, messages, pinnedReport } = threadData;

  return (
    <AppShell
      headerTitle="Thread"
      headerRight={
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {conversation.status === 'live' && (
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
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '12px',
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
              padding: '3px 8px',
            }}
          >
            {conversation.turn_count} / {conversation.max_turns} turns
          </span>
        </div>
      }
    >
      <div>
        {/* Thread Participants Subheader */}
        <div
          style={{
            borderBottom: '1px solid var(--line)',
            padding: '16px 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--paper)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Link href="/home" style={{ color: 'var(--ink-soft)', display: 'flex', alignItems: 'center' }}>
              <ArrowLeft size={18} />
            </Link>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 700, fontSize: '15px' }}>{initiator?.name || 'Agent A'}</span>
                <span style={{ fontSize: '12px', color: 'var(--ink-soft)' }}>
                  ({initiatorOwner ? `@${initiatorOwner.handle}` : 'owner'})
                </span>
                <span style={{ color: 'var(--ink-soft)' }}>↔</span>
                <span style={{ fontWeight: 700, fontSize: '15px' }}>{target?.name || 'Agent B'}</span>
                <span style={{ fontSize: '12px', color: 'var(--ink-soft)' }}>
                  ({targetOwner ? `@${targetOwner.handle}` : 'peer'})
                </span>
              </div>
              <div style={{ fontSize: '12px', color: 'var(--ink-soft)', marginTop: '2px' }}>
                Started {formatRelativeTime(conversation.created_at)}
              </div>
            </div>
          </div>

          <button
            onClick={fetchThread}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              fontSize: '12px',
              color: 'var(--ink-soft)',
              cursor: 'pointer',
            }}
          >
            <RotateCw size={12} /> Sync
          </button>
        </div>

        {/* Pinned Agent Report per screens.md §3.9 */}
        {pinnedReport && (
          <div
            style={{
              padding: '16px 20px',
              backgroundColor: 'var(--surface)',
              borderBottom: '1px solid var(--line)',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11px',
                fontWeight: 700,
                color: 'var(--ink-soft)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                marginBottom: '6px',
              }}
            >
              <Pin size={12} />
              <span>Pinned report to owner</span>
            </div>
            <p style={{ fontSize: '14px', lineHeight: 1.5, color: 'var(--ink)', fontWeight: 500 }}>
              {pinnedReport}
            </p>
          </div>
        )}

        {/* Chronological Message Stream */}
        <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {messages.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--ink-soft)', fontSize: '14px' }}>
              No messages exchanged yet in this conversation.
            </div>
          ) : (
            messages.map((msg) => {
              const isInitiatorSender = initiator && msg.sender_agent_id === initiator.id;
              const senderAgent = msg.sender || (isInitiatorSender ? initiator : target);
              const senderOwner = isInitiatorSender ? initiatorOwner : targetOwner;

              return (
                <div
                  key={msg.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '12px',
                  }}
                >
                  {/* Agent avatar: rounded square (8px radius) in --agent */}
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      backgroundColor: isInitiatorSender ? 'var(--agent)' : 'var(--surface)',
                      border: '1px solid var(--ink)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '13px',
                      color: 'var(--ink)',
                      flexShrink: 0,
                    }}
                  >
                    {senderAgent?.name ? senderAgent.name.charAt(0) : 'A'}
                  </div>

                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ink)' }}>
                        {senderAgent?.name || 'Agent'}
                      </span>
                      {senderOwner && (
                        <span
                          style={{
                            fontFamily: 'var(--font-mono)',
                            fontSize: '12px',
                            color: 'var(--ink-soft)',
                          }}
                        >
                          @{senderOwner.handle}
                        </span>
                      )}
                      <span style={{ fontSize: '11px', color: 'var(--ink-soft)', display: 'flex', alignItems: 'center', gap: '3px' }}>
                        <Clock size={11} />
                        {formatRelativeTime(msg.created_at)}
                      </span>
                    </div>

                    {/* Message Bubble per theme.md §107: agent = --agent-tint, no tails, 12px radius */}
                    <div
                      style={{
                        padding: '12px 16px',
                        backgroundColor: isInitiatorSender ? 'var(--agent-tint)' : 'var(--surface)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '14px',
                        lineHeight: 1.5,
                        color: 'var(--ink)',
                        border: '1px solid var(--line)',
                        maxWidth: '85%',
                        wordBreak: 'break-word',
                      }}
                    >
                      {msg.content}
                    </div>
                  </div>
                </div>
              );
            })
          )}

          {conversation.status === 'capped' && (
            <div
              style={{
                marginTop: '12px',
                padding: '12px',
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                textAlign: 'center',
                fontSize: '13px',
                color: 'var(--ink-soft)',
              }}
            >
              Turn limit reached ({conversation.max_turns} turns). Thread has concluded.
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

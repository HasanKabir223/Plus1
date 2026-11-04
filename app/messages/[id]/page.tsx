'use client';

import React, { use, useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { db, formatRelativeTime } from '@/lib/db';
import { supabase } from '@/lib/supabase/client';
import type { Agent, Conversation, ConversationParticipant, Message, Profile } from '@/types/database';
import { AlertCircle, Loader2, RotateCw } from 'lucide-react';
import styles from '@/components/messages/messages.module.css';

const API_BASE = process.env.NEXT_PUBLIC_AGENT_API_URL || 'http://127.0.0.1:8000';

type ThreadData = {
  conversation: Conversation;
  participants: ConversationParticipant[];
  profileMap: Map<string, Profile>;
  agentMap: Map<string, Agent>;
};

export default function MessageThreadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { user } = useAuth();

  const [thread, setThread] = useState<ThreadData | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [typingAgent, setTypingAgent] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const myAgentIds = React.useMemo(() => {
    if (!thread || !user) return new Set<string>();
    return new Set(
      [...thread.agentMap.values()].filter((a) => a.owner_id === user.id).map((a) => a.id)
    );
  }, [thread, user]);

  const isMine = useCallback(
    (m: Message): boolean => {
      if (!user) return false;
      if (m.sender_profile_id === user.id) return true;
      return m.sender_agent_id !== null && myAgentIds.has(m.sender_agent_id);
    },
    [user, myAgentIds]
  );

  const appendMessages = useCallback((incoming: Message[]) => {
    setMessages((prev) => {
      const seen = new Set(prev.map((m) => m.id));
      const fresh = incoming.filter((m) => !seen.has(m.id));
      if (fresh.length === 0) return prev;
      return [...prev, ...fresh].sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
    });
  }, []);

  const fetchThread = useCallback(async () => {
    try {
      const data = await db.getConversationThread(id);
      if (!data) {
        setNotFound(true);
        return;
      }
      setThread({
        conversation: data.conversation,
        participants: data.participants,
        profileMap: data.profileMap,
        agentMap: data.agentMap,
      });
      setMessages(data.messages);
      setHasOlder(data.messages.length >= 50);
      void db.markConversationRead(id);
    } catch (err: unknown) {
      console.error('[Thread] Failed to load conversation:', { conversationId: id, error: err });
      setError('Could not load this conversation. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    // Deferred so fetchThread's synchronous setState prefix does not run
    // inside the effect body (react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => {
      void fetchThread();
    });
  }, [fetchThread]);

  // Live updates: Realtime first, 5s polling fallback. Own inserts are
  // de-duplicated by id in appendMessages.
  useEffect(() => {
    if (!thread) return;
    let polling: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (polling) return;
      polling = setInterval(() => {
        db.getConversationThread(id)
          .then((data) => {
            if (data) appendMessages(data.messages);
          })
          .catch((err: unknown) =>
            console.error('[Thread] Polling refresh failed:', { conversationId: id, error: err })
          );
      }, 5000);
    };
    const unsub = db.subscribeToMessages(
      id,
      (msg) => {
        appendMessages([msg]);
        void db.markConversationRead(id);
        if (msg.sender_agent_id) setTypingAgent(null);
      },
      (ok) => {
        if (!ok) {
          console.warn('[Thread] Realtime unavailable; polling every 5s.', { conversationId: id });
          startPolling();
        }
      }
    );
    return () => {
      unsub();
      if (polling) clearInterval(polling);
    };
  }, [thread?.conversation.id, id, appendMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    return () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
  }, []);

  if (isLoading) {
    return (
      <AppShell headerTitle="Conversation">
        <div aria-label="Loading conversation" role="status">
          {[1, 2, 3].map((i) => (
            <div key={i} className={styles.skeletonRow}>
              <div className={styles.skeletonBlock} style={{ width: '60%', height: 44 }} />
            </div>
          ))}
        </div>
      </AppShell>
    );
  }

  if (notFound || error || !thread || !user) {
    return (
      <AppShell headerTitle="Conversation">
        <div className={styles.emptyState}>
          <p className={styles.emptyText}>
            {notFound ? 'Conversation not found.' : 'Could not load this conversation.'}
          </p>
          <p className={styles.emptySubtext}>
            {notFound ? 'It may have been deleted, or you are not a member.' : 'Please try again.'}
          </p>
          <Link href="/messages" className={styles.retryBtn} style={{ marginTop: 12 }}>
            Back to Messages
          </Link>
        </div>
      </AppShell>
    );
  }

  const conv = thread.conversation;
  const myProfilePart = thread.participants.find((p) => p.profile_id === user.id);
  const agentParts = thread.participants.filter((p) => p.agent_id);
  const iOwnAnAgent = agentParts.some((p) => p.agent_id && myAgentIds.has(p.agent_id));
  const canSend = Boolean(myProfilePart) && conv.status === 'open';
  const showOwnerBanner = iOwnAnAgent && !myProfilePart && conv.kind !== 'dm';

  const otherLabel = (() => {
    const others = thread.participants.filter(
      (p) => p.profile_id !== user.id && !(p.agent_id && myAgentIds.has(p.agent_id))
    );
    const names = others.map((p) => {
      if (p.agent_id) {
        const a = thread.agentMap.get(p.agent_id);
        const owner = a ? thread.profileMap.get(a.owner_id) : null;
        return `${a?.name || 'Agent'} · agent for @${owner?.username || 'owner'}`;
      }
      const prof = p.profile_id ? thread.profileMap.get(p.profile_id) : null;
      return prof?.profilename || prof?.username || 'Member';
    });
    return names.join(' and ') || 'Conversation';
  })();

  const callBackend = async (path: string): Promise<boolean> => {
    if (!API_BASE || !supabase) return false;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return false;
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.ok;
  };

  const handleSend = async () => {
    const body = draft.trim();
    if (!body || sending || !canSend) return;
    setSending(true);
    setSendError(null);
    try {
      const created = await db.sendMessage(id, user.id, body);
      appendMessages([created]);
      setDraft('');
      void db.markConversationRead(id);
      // If an agent takes part, ask the backend to reply (fire and forget).
      if (agentParts.length > 0 && API_BASE) {
        const agentName = agentParts[0].agent_id
          ? thread.agentMap.get(agentParts[0].agent_id)?.name || 'Agent'
          : 'Agent';
        setTypingAgent(agentName);
        if (typingTimer.current) clearTimeout(typingTimer.current);
        typingTimer.current = setTimeout(() => setTypingAgent(null), 45000);
        void callBackend(`/conversations/${id}/agent-respond`).catch((err: unknown) =>
          console.error('[Thread] agent-respond failed:', { conversationId: id, error: err })
        );
      }
    } catch (err: unknown) {
      console.error('[Thread] Failed to send message:', { conversationId: id, error: err });
      setSendError('Could not send your message. Your text is still here - try again.');
    } finally {
      setSending(false);
    }
  };

  const handleControl = async (action: 'pause' | 'resume' | 'takeover') => {
    if (controlBusy) return;
    setControlBusy(true);
    setControlError(null);
    try {
      const ok = await callBackend(`/conversations/${id}/${action}`);
      if (!ok) throw new Error(`${action} request failed`);
      await fetchThread();
    } catch (err: unknown) {
      console.error(`[Thread] Failed to ${action} conversation:`, { conversationId: id, error: err });
      setControlError(`Could not ${action} this conversation. Please try again.`);
    } finally {
      setControlBusy(false);
    }
  };

  const handleLoadOlder = async () => {
    if (loadingOlder || messages.length === 0) return;
    setLoadingOlder(true);
    try {
      const older = await db.loadOlderMessages(id, messages[0].created_at);
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...older.filter((m) => !seen.has(m.id)), ...prev];
      });
      setHasOlder(older.length >= 50);
    } catch (err: unknown) {
      console.error('[Thread] Failed to load older messages:', { conversationId: id, error: err });
    } finally {
      setLoadingOlder(false);
    }
  };

  const senderInfo = (m: Message) => {
    if (m.sender_agent_id) {
      const a = thread.agentMap.get(m.sender_agent_id);
      const owner = a ? thread.profileMap.get(a.owner_id) : null;
      return {
        name: a?.name || 'Agent',
        sub: `agent for @${owner?.username || 'owner'}`,
        isAgent: true,
        initial: (a?.name || 'A').charAt(0).toUpperCase(),
      };
    }
    const prof = m.sender_profile_id ? thread.profileMap.get(m.sender_profile_id) : null;
    const name = prof?.profilename || prof?.username || 'Member';
    return { name, sub: prof?.username ? `@${prof.username}` : '', isAgent: false, initial: name.charAt(0).toUpperCase() };
  };

  return (
    <AppShell headerTitle="Conversation">
      <div className={styles.threadWrap}>
        <div className={styles.threadHeader}>
          <h1 className={styles.threadTitle}>{otherLabel}</h1>
          <p className={styles.threadSub}>
            {conv.kind === 'dm' ? 'Direct conversation' : conv.kind === 'human_agent' ? 'Agent chat' : 'Agent to agent'}
            {conv.status === 'closed' && conv.outcome ? ` · Ended (${conv.outcome.replace('_', ' ')})` : ''}
            {conv.status === 'paused' ? ' · Paused' : ''}
          </p>
        </div>

        {showOwnerBanner && (
          <div className={styles.ownerBanner}>
            <span>
              Your agent is talking in this thread. You can read everything here.
            </span>
            <div className={styles.bannerActions}>
              {conv.status === 'paused' ? (
                <button type="button" className={styles.bannerBtn} disabled={controlBusy} onClick={() => void handleControl('resume')}>
                  Resume
                </button>
              ) : (
                <button type="button" className={styles.bannerBtn} disabled={controlBusy} onClick={() => void handleControl('pause')}>
                  Pause
                </button>
              )}
              {conv.mode === 'auto' && (
                <button type="button" className={styles.bannerBtn} disabled={controlBusy} onClick={() => void handleControl('takeover')}>
                  Take over
                </button>
              )}
            </div>
            {controlError && (
              <span role="alert" style={{ color: 'var(--err)', fontSize: 13 }}>
                {controlError}
              </span>
            )}
          </div>
        )}

        <div className={styles.messageList} aria-live="polite">
          {hasOlder && (
            <button type="button" className={styles.loadOlderBtn} disabled={loadingOlder} onClick={() => void handleLoadOlder()}>
              {loadingOlder ? (
                <>
                  <Loader2 size={13} className="animate-spin" aria-hidden="true" /> Loading...
                </>
              ) : (
                'Load older'
              )}
            </button>
          )}

          {messages.map((m) => {
            if (m.kind === 'system') {
              return (
                <p key={m.id} className={styles.systemNote}>
                  {m.body}
                </p>
              );
            }
            const mine = isMine(m);
            const info = senderInfo(m);
            return (
              <div key={m.id} className={`${styles.msgRow} ${mine ? styles.msgRowMine : styles.msgRowTheirs}`}>
                <div className={styles.msgSender}>
                  <span className={styles.avatarChip} aria-hidden="true">{info.initial}</span>
                  <span>{info.name}</span>
                  {info.isAgent && <span className={styles.agentTag}>Agent</span>}
                  {info.sub && <span className={styles.agentFor}>{info.sub}</span>}
                </div>
                <div className={`${styles.bubble} ${mine ? styles.bubbleMine : styles.bubbleTheirs}`}>
                  {m.body}
                </div>
                <span className={styles.msgTime}>{formatRelativeTime(m.created_at)}</span>
              </div>
            );
          })}

          {typingAgent && <p className={styles.typingLine}>{typingAgent} is replying...</p>}
          <div ref={bottomRef} />
        </div>

        {conv.kind === 'agent_agent' && iOwnAnAgent && (
          <p className={styles.threadFooterNote}>Both owners can read this thread</p>
        )}

        {canSend ? (
          <div className={styles.composer}>
            <label htmlFor="thread-composer" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
              Message
            </label>
            <textarea
              id="thread-composer"
              className={styles.composerInput}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="Write a message"
              maxLength={1000}
              disabled={sending}
              aria-label="Message text (up to 1000 characters)"
            />
            {sendError && (
              <p className={styles.composerError} role="alert">
                <AlertCircle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                {sendError}
              </p>
            )}
            <div className={styles.composerRow}>
              <span className={styles.charCount}>{draft.length}/1000</span>
              <button
                type="button"
                className={styles.sendBtn}
                disabled={sending || !draft.trim()}
                onClick={() => void handleSend()}
                aria-label="Send message"
              >
                {sending ? (
                  <>
                    <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle', marginRight: 6 }} />
                    Sending...
                  </>
                ) : (
                  'Send'
                )}
              </button>
            </div>
          </div>
        ) : (
          conv.status !== 'open' && (
            <p className={styles.threadFooterNote}>
              This conversation is {conv.status}. New messages are closed.
            </p>
          )
        )}

        {error && (
          <div className={styles.errorBanner} role="alert">
            <span className={styles.errorText}>{error}</span>
            <button type="button" className={styles.retryBtn} onClick={() => void fetchThread()}>
              <RotateCw size={13} />
              <span>Retry</span>
            </button>
          </div>
        )}
      </div>
    </AppShell>
  );
}

'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { db, formatRelativeTime } from '@/lib/db';
import type { ConversationListItem } from '@/types/database';
import { AlertCircle, RotateCw } from 'lucide-react';
import styles from '@/components/messages/messages.module.css';

export default function MessagesPage() {
  const { user } = useAuth();
  const [items, setItems] = useState<ConversationListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchList = async () => {
    if (!user) return;
    try {
      setError(null);
      const rows = await db.getConversations(user.id);
      setItems(rows);
    } catch (err: unknown) {
      console.error('[Messages] Failed to load conversations:', err);
      setError('Could not load your conversations. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Deferred: fetchList()/setIsLoading run after the effect body so this
    // hook never calls setState synchronously (react-hooks/set-state-in-effect).
    void Promise.resolve().then(() => {
      if (!user) {
        setIsLoading(false);
        return;
      }
      void fetchList();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!user) {
    return (
      <AppShell headerTitle="Messages">
        <div className={styles.emptyState}>
          <p className={styles.emptyText}>Log in to see your messages.</p>
          <Link href="/login" className={styles.retryBtn} style={{ marginTop: 12 }}>
            Log in
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell headerTitle="Messages">
      {isLoading ? (
        <div aria-label="Loading conversations" role="status">
          {[1, 2, 3].map((i) => (
            <div key={i} className={styles.skeletonRow}>
              <div className={styles.skeletonBlock} style={{ width: 36, height: 36, borderRadius: 8 }} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div className={styles.skeletonBlock} style={{ width: '45%' }} />
                <div className={styles.skeletonBlock} style={{ width: '75%' }} />
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className={styles.errorBanner} role="alert">
          <span className={styles.errorText}>
            <AlertCircle size={15} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
            {error}
          </span>
          <button type="button" onClick={fetchList} className={styles.retryBtn} aria-label="Retry loading conversations">
            <RotateCw size={13} />
            <span>Retry</span>
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className={styles.emptyState}>
          <p className={styles.emptyText}>No conversations yet.</p>
          <p className={styles.emptySubtext}>
            Message someone from their profile, or press Run on your agent and it may start one.
          </p>
        </div>
      ) : (
        <div className={styles.list}>
          {items.map((item) => (
            <Link
              key={item.conversation.id}
              href={`/messages/${item.conversation.id}`}
              className={styles.row}
            >
              <div className={styles.rowMain}>
                <div className={styles.rowTop}>
                  <span className={styles.rowName}>{item.otherLabel}</span>
                  <span className={styles.rowTime}>{formatRelativeTime(item.lastMessageAt)}</span>
                </div>
                {item.lastMessagePreview && (
                  <p className={styles.rowPreview}>{item.lastMessagePreview}</p>
                )}
              </div>
              <span className={styles.kindLabel}>{item.kindLabel}</span>
              {item.unread && <span className={styles.unreadDot} aria-label="Unread messages" />}
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}

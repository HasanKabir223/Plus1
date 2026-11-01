'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { db, formatFeedTimestamp } from '@/lib/db';
import type { PostWithAuthor } from '@/types/database';
import { Trash2, Loader2, AlertCircle } from 'lucide-react';
import styles from './feed.module.css';

interface PostCardProps {
  post: PostWithAuthor;
  onPostDeleted?: (postId: string) => void;
}

function getAvatarLetters(name: string): string {
  const clean = name.trim();
  if (!clean) return 'U';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

export default function PostCard({ post, onPostDeleted }: PostCardProps) {
  const { user, profile: ownProfile } = useAuth();
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isHuman = Boolean(post.author_profile_id);

  // Delete control visibility: strictly on own human posts
  const isOwnPost = Boolean(user?.id && isHuman && user.id === post.author_profile_id);

  const { relative, full, iso, clock } = formatFeedTimestamp(post.created_at);

  const handleDelete = async () => {
    if (!user || !isOwnPost || isDeleting) return;

    const confirmed = window.confirm('Are you sure you want to delete this post? This cannot be undone.');
    if (!confirmed) return;

    try {
      setIsDeleting(true);
      setDeleteError(null);
      await db.deletePost(post.id, user.id);
      onPostDeleted?.(post.id);
    } catch (err: unknown) {
      console.error('[PostCard] Failed to delete post:', { postId: post.id, error: err });
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete post.');
      setIsDeleting(false);
    }
  };

  // Author details resolution. When the embed missed the author row,
  // fall back to the signed-in profile for the viewer's own posts so
  // they never render as a generic "Member".
  const embedded = post.author_profile;
  const profile =
    embedded?.username || !isOwnPost
      ? embedded
      : ownProfile
        ? {
            id: ownProfile.id,
            username: ownProfile.username,
            profilename: ownProfile.profilename || ownProfile.name || null,
          }
        : embedded;
  const agent = post.author_agent;

  const humanName = profile?.profilename || profile?.username || 'Member';
  const humanUsername = profile?.username || '';
  const agentName = agent?.name || 'Agent';
  // Agents have no handle column; identity is the owner's @username.
  const ownerUsername = agent?.owner?.username || '';

  return (
    <article className={styles.postCard} aria-labelledby={`post-author-${post.id}`}>
      {/* Left Avatar Column */}
      <div className={styles.authorAvatarCol}>
        {isHuman ? (
          humanUsername ? (
            <Link
              href={`/u/${humanUsername}`}
              className={styles.humanAvatar}
              aria-label={`View ${humanName}'s profile`}
            >
              {getAvatarLetters(humanName)}
            </Link>
          ) : (
            <div className={styles.humanAvatar} aria-hidden="true">
              {getAvatarLetters(humanName)}
            </div>
          )
        ) : (
          <div className={styles.agentAvatar} aria-hidden="true" title={agentName}>
            {agentName[0]?.toUpperCase() || 'A'}
          </div>
        )}
      </div>

      {/* Main Content Column */}
      <div className={styles.postCardMain}>
        {/* Header Metadata */}
        <header className={styles.postHeader}>
          <div className={styles.authorMeta} id={`post-author-${post.id}`}>
            {isHuman ? (
              <>
                {humanUsername ? (
                  <Link href={`/u/${humanUsername}`} className={styles.authorNameLink}>
                    {humanName}
                  </Link>
                ) : (
                  <span className={styles.authorNameLink}>{humanName}</span>
                )}
                {humanUsername && (
                  <Link href={`/u/${humanUsername}`} className={styles.authorHandle}>
                    @{humanUsername}
                  </Link>
                )}
              </>
            ) : (
              <>
                <span className={styles.agentName}>{agentName}</span>
                <span className={styles.agentBadge}>Agent</span>
                {ownerUsername && (
                  <span className={styles.ownerAttribution}>
                    by{' '}
                    <Link href={`/u/${ownerUsername}`} className={styles.ownerLink}>
                      @{ownerUsername}
                    </Link>
                  </span>
                )}
              </>
            )}

            <span className={styles.headerDot}>·</span>

            {/* Semantic timestamp: relative age plus clock time */}
            <time dateTime={iso} title={full} className={styles.postTime}>
              {relative}
              {clock ? ` · ${clock}` : ''}
            </time>
          </div>

          {/* Delete Action (visible only for own human posts) */}
          {isOwnPost && (
            <div className={styles.postActions}>
              <button
                type="button"
                onClick={handleDelete}
                disabled={isDeleting}
                className={styles.deleteBtn}
                aria-label="Delete post"
                title="Delete post"
              >
                {isDeleting ? (
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                ) : (
                  <Trash2 size={14} />
                )}
              </button>
            </div>
          )}
        </header>

        {/* Delete Error Notification */}
        {deleteError && (
          <div className={styles.errorBanner} role="alert" style={{ margin: '4px 0' }}>
            <span className={styles.errorText}>
              <AlertCircle size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
              {deleteError}
            </span>
          </div>
        )}

        {/* Post Body: Strictly plain text with pre-wrap whitespace */}
        <p className={styles.postBody}>{post.body}</p>

        {/* Card Footer: Reserved container accommodating future reply action/counts */}
        <footer className={styles.postFooter} aria-label="Post actions">
          {/* Extension slot for upcoming reply feature */}
        </footer>
      </div>
    </article>
  );
}

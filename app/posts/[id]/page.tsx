'use client';

import React, { use, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import PostCard from '@/components/feed/post-card';
import PostComposer from '@/components/feed/post-composer';
import { useAuth } from '@/lib/auth-context';
import { db } from '@/lib/db';
import type { PostWithAuthor } from '@/types/database';
import { AlertCircle, Loader2, RotateCw } from 'lucide-react';
import styles from '@/components/feed/feed.module.css';

export default function PostDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useAuth();

  const [post, setPost] = useState<PostWithAuthor | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [comments, setComments] = useState<PostWithAuthor[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const commentsRef = useRef<HTMLDivElement>(null);

  // Load the post itself. Comment ids bounce to their parent's page.
  useEffect(() => {
    let ignore = false;
    db.fetchPostById(id, user?.id)
      .then((found) => {
        if (ignore) return;
        if (!found) {
          setNotFound(true);
          setIsLoading(false);
          setCommentsLoading(false);
          return;
        }
        if (found.parent_id) {
          router.replace(`/posts/${found.parent_id}`);
          return;
        }
        setPost(found);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (ignore) return;
        console.error('[PostDetail] Failed to load post:', { postId: id, error: err });
        setLoadError('Could not load this post. Please try again.');
        setIsLoading(false);
        setCommentsLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [id, user?.id, router]);

  const fetchCommentsPage = async (cursor?: string | null) => {
    const result = await db.fetchComments(id, {
      cursor: cursor ?? null,
      limit: 20,
      viewerId: user?.id,
    });
    return result;
  };

  useEffect(() => {
    if (!post) return;
    let ignore = false;
    fetchCommentsPage()
      .then((result) => {
        if (ignore) return;
        setComments(result.comments);
        setNextCursor(result.nextCursor);
        setHasMore(result.hasMore);
        setCommentsLoading(false);
      })
      .catch((err: unknown) => {
        if (ignore) return;
        console.error('[PostDetail] Failed to load comments:', { postId: id, error: err });
        setCommentsError('Could not load comments. Please try again.');
        setCommentsLoading(false);
      });
    return () => {
      ignore = true;
    };
    // fetchCommentsPage is stable enough for this mount fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [post?.id, user?.id]);

  const handleRetryComments = async () => {
    try {
      setCommentsLoading(true);
      setCommentsError(null);
      const result = await fetchCommentsPage();
      setComments(result.comments);
      setNextCursor(result.nextCursor);
      setHasMore(result.hasMore);
    } catch (err: unknown) {
      console.error('[PostDetail] Failed to reload comments:', { postId: id, error: err });
      setCommentsError('Could not load comments. Please try again.');
    } finally {
      setCommentsLoading(false);
    }
  };

  const handleLoadMore = async () => {
    if (loadingMore || !hasMore || !nextCursor) return;
    try {
      setLoadingMore(true);
      const result = await fetchCommentsPage(nextCursor);
      setComments((prev) => [...prev, ...result.comments]);
      setNextCursor(result.nextCursor);
      setHasMore(result.hasMore);
    } catch (err: unknown) {
      console.error('[PostDetail] Failed to load more comments:', { postId: id, error: err });
    } finally {
      setLoadingMore(false);
    }
  };

  const handleCommentCreated = (comment: PostWithAuthor) => {
    setComments((prev) => [...prev, comment]);
    setPost((prev) =>
      prev ? { ...prev, reply_count: (prev.reply_count ?? 0) + 1 } : prev
    );
  };

  const handleCommentDeleted = (commentId: string) => {
    setComments((prev) => prev.filter((c) => c.id !== commentId));
    setPost((prev) =>
      prev
        ? { ...prev, reply_count: Math.max(0, (prev.reply_count ?? 0) - 1) }
        : prev
    );
  };

  const scrollToComments = () => {
    commentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  if (isLoading) {
    return (
      <AppShell headerTitle="Post">
        <div className={styles.skeletonList} aria-label="Loading post" role="status">
          {[1, 2].map((i) => (
            <div key={i} className={styles.skeletonRow}>
              <div className={styles.skeletonAvatar} />
              <div className={styles.skeletonContent}>
                <div className={styles.skeletonHeader}>
                  <div className={styles.skeletonTextMedium} />
                  <div className={styles.skeletonTextSmall} />
                </div>
                <div className={styles.skeletonBodyLine1} />
                <div className={styles.skeletonBodyLine2} />
              </div>
            </div>
          ))}
        </div>
      </AppShell>
    );
  }

  if (notFound) {
    return (
      <AppShell headerTitle="Post">
        <div className={styles.emptyState}>
          <p className={styles.emptyText}>Post not found.</p>
          <p className={styles.emptySubtext}>It may have been deleted.</p>
          <Link href="/home?tab=feed" className={styles.retryBtn} style={{ marginTop: 12 }}>
            Back to Feed
          </Link>
        </div>
      </AppShell>
    );
  }

  if (loadError || !post) {
    return (
      <AppShell headerTitle="Post">
        <div className={styles.errorBanner} role="alert">
          <span className={styles.errorText}>
            <AlertCircle size={15} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
            {loadError || 'Could not load this post.'}
          </span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className={styles.retryBtn}
            aria-label="Retry loading post"
          >
            <RotateCw size={13} />
            <span>Retry</span>
          </button>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell headerTitle="Post">
      <div className={styles.detailWrap}>
        <PostCard
          post={post}
          onCommentClick={scrollToComments}
          onPostDeleted={() => router.push('/home?tab=feed')}
        />

        <div ref={commentsRef} className={styles.commentsSection}>
          <h2 className={styles.commentsHeading}>Comments</h2>

          {user ? (
            <PostComposer parentId={post.id} onPostCreated={handleCommentCreated} />
          ) : (
            <p className={styles.commentsLoginHint}>
              <Link href="/login">Log in</Link> to join the conversation.
            </p>
          )}

          {commentsLoading ? (
            <div className={styles.skeletonList} aria-label="Loading comments" role="status">
              {[1, 2].map((i) => (
                <div key={i} className={styles.skeletonRow}>
                  <div className={styles.skeletonAvatar} />
                  <div className={styles.skeletonContent}>
                    <div className={styles.skeletonHeader}>
                      <div className={styles.skeletonTextMedium} />
                      <div className={styles.skeletonTextSmall} />
                    </div>
                    <div className={styles.skeletonBodyLine1} />
                  </div>
                </div>
              ))}
            </div>
          ) : commentsError ? (
            <div className={styles.errorBanner} role="alert">
              <span className={styles.errorText}>
                <AlertCircle size={15} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                {commentsError}
              </span>
              <button
                type="button"
                onClick={handleRetryComments}
                className={styles.retryBtn}
                aria-label="Retry loading comments"
              >
                <RotateCw size={13} />
                <span>Retry</span>
              </button>
            </div>
          ) : comments.length === 0 ? (
            <div className={styles.emptyState}>
              <p className={styles.emptyText}>No comments yet.</p>
              <p className={styles.emptySubtext}>Be the first to reply.</p>
            </div>
          ) : (
            <>
              <div className={styles.commentsList}>
                {comments.map((comment) => (
                  <PostCard
                    key={comment.id}
                    post={comment}
                    isComment
                    onPostDeleted={handleCommentDeleted}
                  />
                ))}
              </div>

              {hasMore && (
                <div className={styles.loadMoreContainer}>
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className={styles.loadMoreBtn}
                    aria-label="Load more comments"
                  >
                    {loadingMore ? (
                      <>
                        <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
                        <span>Loading more...</span>
                      </>
                    ) : (
                      <span>Load more</span>
                    )}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}

'use client';

import React, { useState, useEffect } from 'react';
import PostComposer from './post-composer';
import PostCard from './post-card';
import { useAuth } from '@/lib/auth-context';
import { db } from '@/lib/db';
import type { PostWithAuthor } from '@/types/database';
import { RotateCw, Loader2, AlertCircle } from 'lucide-react';
import styles from './feed.module.css';

export default function FeedList() {
  const { user } = useAuth();
  const [posts, setPosts] = useState<PostWithAuthor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    let ignore = false;
    db.fetchFeedPosts({ limit: 20, viewerId: user?.id })
      .then((result) => {
        if (!ignore) {
          setPosts(result.posts);
          setNextCursor(result.nextCursor);
          setHasMore(result.hasMore);
          setIsLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!ignore) {
          console.error('[FeedList] Failed to fetch feed posts:', err);
          setError(err instanceof Error ? err.message : 'Failed to load feed posts. Please try again.');
          setIsLoading(false);
        }
      });

    return () => {
      ignore = true;
    };
  }, [user?.id]);

  const handleRetry = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = await db.fetchFeedPosts({ limit: 20, viewerId: user?.id });
      setPosts(result.posts);
      setNextCursor(result.nextCursor);
      setHasMore(result.hasMore);
    } catch (err: unknown) {
      console.error('[FeedList] Failed to reload feed posts:', err);
      setError(err instanceof Error ? err.message : 'Failed to load feed posts. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLoadMore = async () => {
    if (isLoadingMore || !hasMore || !nextCursor) return;
    try {
      setIsLoadingMore(true);
      const result = await db.fetchFeedPosts({ cursor: nextCursor, limit: 20, viewerId: user?.id });
      setPosts((prev) => [...prev, ...result.posts]);
      setNextCursor(result.nextCursor);
      setHasMore(result.hasMore);
    } catch (err: unknown) {
      console.error('[FeedList] Failed to load more posts:', err);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const handlePostCreated = (newPost: PostWithAuthor) => {
    setPosts((prev) => [newPost, ...prev]);
  };

  const handlePostDeleted = (deletedPostId: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== deletedPostId));
  };

  return (
    <div className={styles.feedContainer}>
      {/* Post Composer at the top of the feed */}
      <PostComposer onPostCreated={handlePostCreated} />

      {/* Main Timeline Section */}
      <div className={styles.feedList} role="feed" aria-busy={isLoading}>
        {isLoading ? (
          // Skeleton Loading State
          <div className={styles.skeletonList} aria-label="Loading timeline posts" role="status">
            {[1, 2, 3].map((i) => (
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
        ) : error ? (
          // Error State with Retry Button
          <div className={styles.errorBanner} role="alert">
            <span className={styles.errorText}>
              <AlertCircle size={15} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
              {error}
            </span>
            <button
              type="button"
              onClick={handleRetry}
              className={styles.retryBtn}
              aria-label="Retry loading posts"
            >
              <RotateCw size={13} />
              <span>Retry</span>
            </button>
          </div>
        ) : posts.length === 0 ? (
          // Honest Zero-Data Empty State (Zero-Metric Invariant)
          <div className={styles.emptyState}>
            <p className={styles.emptyText}>Nothing here yet.</p>
            <p className={styles.emptySubtext}>Be the first to post.</p>
          </div>
        ) : (
          // Feed Post Cards
          <>
            {posts.map((post) => (
              <PostCard key={post.id} post={post} onPostDeleted={handlePostDeleted} />
            ))}

            {/* Cursor Pagination: "Load more" button */}
            {hasMore && (
              <div className={styles.loadMoreContainer}>
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className={styles.loadMoreBtn}
                  aria-label="Load more posts"
                >
                  {isLoadingMore ? (
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
  );
}

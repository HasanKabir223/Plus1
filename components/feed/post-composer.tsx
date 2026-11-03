'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { useAuth, isProfileOnboarded } from '@/lib/auth-context';
import { db } from '@/lib/db';
import type { PostWithAuthor } from '@/types/database';
import { AlertCircle, Loader2, X } from 'lucide-react';
import styles from './feed.module.css';

interface PostComposerProps {
  onPostCreated?: (post: PostWithAuthor) => void;
  parentId?: string;
  replyTo?: { id: string; name: string } | null;
  onCancelReply?: () => void;
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

export default function PostComposer({ onPostCreated, parentId, replyTo, onCancelReply }: PostComposerProps) {
  const isComment = Boolean(parentId);
  const { user, profile, isLoading } = useAuth();
  const [text, setText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus the box whenever a reply target is picked.
  useEffect(() => {
    if (replyTo && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [replyTo]);

  if (isLoading) {
    return null;
  }

  // Gating 1: Visitor not logged in
  if (!user) {
    return (
      <div className={styles.authPromptCard} role="region" aria-label="Sign in prompt">
        <span className={styles.authPromptText}>
          Join the conversation on Plus1 to share thoughts and collaborate with humans &amp; agents.
        </span>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <Link href="/login" className={styles.authPromptCta}>
            Log in
          </Link>
          <span style={{ color: 'var(--line)' }}>•</span>
          <Link href="/signup" className={styles.authPromptCta}>
            Create account
          </Link>
        </div>
      </div>
    );
  }

  // Gating 2: User logged in but profile not onboarded
  if (!isProfileOnboarded(profile)) {
    return (
      <div className={styles.authPromptCard} role="region" aria-label="Onboarding prompt">
        <span className={styles.authPromptText}>
          Complete your profile setup to start posting updates to the timeline.
        </span>
        <Link href="/onboarding" className={styles.authPromptCta}>
          Complete profile &rarr;
        </Link>
      </div>
    );
  }

  const trimmedText = text.trim();
  const charLength = text.length;
  const remainingChars = 500 - charLength;
  const isOverLimit = remainingChars < 0;
  const isCloseToLimit = remainingChars <= 50;
  const canSubmit = trimmedText.length > 0 && !isOverLimit && !isSubmitting;

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    if (error) setError(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 240)}px`;
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    try {
      setIsSubmitting(true);
      setError(null);

      // Security invariant: author_profile_id is always derived from session user.id, never props or URL
      const newPost = isComment
        ? await db.createComment(parentId as string, trimmedText, user.id, replyTo?.id ?? null)
        : await db.createPost({
            body: trimmedText,
            author_profile_id: user.id,
          });

      // Clear textarea and reset height on success
      setText('');
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      onPostCreated?.(newPost);
    } catch (err: unknown) {
      console.error(
        isComment ? '[PostComposer] Failed to create comment:' : '[PostComposer] Failed to create post:',
        { userId: user.id, error: err }
      );
      setError(err instanceof Error ? err.message : 'Unable to share post. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const displayName = profile?.profilename || profile?.name || profile?.username || 'You';
  const avatarInitials = getAvatarLetters(displayName);

  return (
    <div className={styles.composerCard} role="region" aria-label={isComment ? 'Write a comment' : 'Create a post'}>
      <div className={styles.composerMain}>
        <div className={styles.composerAvatar} title={displayName} aria-hidden="true">
          {avatarInitials}
        </div>
        <div className={styles.composerInputWrapper}>
          {isComment && replyTo && (
            <div className={styles.replyChip}>
              <span>Replying to {replyTo.name}</span>
              <button
                type="button"
                onClick={onCancelReply}
                className={styles.replyChipCancel}
                aria-label="Cancel reply"
              >
                <X size={13} aria-hidden="true" />
              </button>
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={isComment ? 'Write a comment' : 'What are you or your agents working on?'}
            className={styles.composerTextarea}
            disabled={isSubmitting}
            aria-label={isComment ? 'Comment body (up to 500 characters)' : 'Post body (up to 500 characters)'}
            rows={2}
          />
        </div>
      </div>

      {error && (
        <div className={styles.composerError} role="alert" aria-live="polite">
          <AlertCircle size={15} style={{ flexShrink: 0 }} />
          <span>{error}</span>
        </div>
      )}

      <div className={styles.composerFooter}>
        {/* Character counter shown only when 50 or fewer characters remain */}
        {isCloseToLimit && (
          <span
            className={`${styles.charCounter} ${
              isOverLimit ? styles.charCounterError : styles.charCounterWarn
            }`}
            aria-live="polite"
          >
            {remainingChars}
          </span>
        )}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className={styles.submitBtn}
          aria-label={isComment ? 'Publish comment' : 'Publish post'}
        >
          {isSubmitting ? (
            <>
              <Loader2 size={14} className="spin" style={{ animation: 'spin 1s linear infinite' }} />
              <span>Posting...</span>
            </>
          ) : (
            <span>{isComment ? 'Comment' : 'Post'}</span>
          )}
        </button>
      </div>
    </div>
  );
}

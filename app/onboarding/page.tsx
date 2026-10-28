'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { db } from '@/lib/db';

const SUGGESTED_TAGS = [
  'teammates',
  'hackathon',
  'collaborators',
  'distributed-systems',
  'study-partner',
  'leads',
  'mentorship',
  'pilot-partners',
];

export default function OnboardingPage() {
  const router = useRouter();
  const { user, profile, updateProfile } = useAuth();
  const [name, setName] = useState(profile?.name || '');
  const [handle, setHandle] = useState(profile?.handle || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [selectedTags, setSelectedTags] = useState<string[]>(profile?.looking_for || []);
  const [handleError, setHandleError] = useState<string | null>(null);
  const [isCheckingHandle, setIsCheckingHandle] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      if (!name) setName(profile.name);
      if (!handle) setHandle(profile.handle);
      if (!bio) setBio(profile.bio);
      if (selectedTags.length === 0 && profile.looking_for) setSelectedTags(profile.looking_for);
    }
  }, [profile]);

  // Live handle availability check
  useEffect(() => {
    if (!handle) {
      setHandleError('Handle is required.');
      return;
    }
    const cleanHandle = handle.toLowerCase().replace(/[^a-z0-9_]/g, '');
    if (cleanHandle !== handle) {
      setHandleError('Only lowercase letters, numbers, and underscores allowed.');
      return;
    }

    if (cleanHandle === profile?.handle) {
      setHandleError(null);
      return;
    }

    setIsCheckingHandle(true);
    const timer = setTimeout(async () => {
      try {
        const existing = await db.getProfileByHandle(cleanHandle);
        if (existing && existing.id !== user?.id) {
          setHandleError('Handle is already taken.');
        } else {
          setHandleError(null);
        }
      } catch {
        // ignore
      } finally {
        setIsCheckingHandle(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [handle, profile, user]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (handleError || !name.trim() || !handle.trim()) return;

    try {
      setIsSaving(true);
      await updateProfile({
        name: name.trim(),
        handle: handle.trim().toLowerCase(),
        bio: bio.trim(),
        looking_for: selectedTags,
      });
      router.push('/home');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to save profile.';
      setHandleError(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card" style={{ maxWidth: '520px' }}>
        <div style={{ marginBottom: '24px' }}>
          <div
            style={{
              display: 'inline-block',
              backgroundColor: 'var(--agent)',
              color: 'var(--ink)',
              fontFamily: 'var(--font-mono)',
              fontSize: '11px',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 'var(--radius-sm)',
              marginBottom: '12px',
            }}
          >
            ONBOARDING
          </div>
          <h1 style={{ fontSize: '24px', fontWeight: 700, color: 'var(--ink)', marginBottom: '8px' }}>
            Set up your profile
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--ink-soft)' }}>
            Other members and their agents will use this information to discover and connect with you.
          </p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label
              htmlFor="name"
              style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--ink)', marginBottom: '6px' }}
            >
              Full name
            </label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Hasan Kabir"
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--line)',
                backgroundColor: 'var(--surface)',
                fontSize: '15px',
                color: 'var(--ink)',
                outline: 'none',
              }}
            />
          </div>

          <div>
            <label
              htmlFor="handle"
              style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--ink)', marginBottom: '6px' }}
            >
              Handle
            </label>
            <div style={{ position: 'relative' }}>
              <span
                style={{
                  position: 'absolute',
                  left: '12px',
                  top: '10px',
                  color: 'var(--ink-soft)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '14px',
                }}
              >
                @
              </span>
              <input
                id="handle"
                type="text"
                value={handle}
                onChange={(e) => setHandle(e.target.value.toLowerCase())}
                placeholder="hasan"
                required
                style={{
                  width: '100%',
                  padding: '10px 12px 10px 28px',
                  borderRadius: 'var(--radius-sm)',
                  border: handleError ? '1.5px solid var(--err)' : '1px solid var(--line)',
                  backgroundColor: 'var(--surface)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '14px',
                  color: 'var(--ink)',
                  outline: 'none',
                }}
              />
            </div>
            {isCheckingHandle ? (
              <span style={{ fontSize: '12px', color: 'var(--ink-soft)', marginTop: '4px', display: 'block' }}>
                Checking handle availability...
              </span>
            ) : handleError ? (
              <span style={{ fontSize: '12px', color: 'var(--err)', marginTop: '4px', display: 'block' }}>
                {handleError}
              </span>
            ) : (
              <span style={{ fontSize: '12px', color: 'var(--ok)', marginTop: '4px', display: 'block' }}>
                ✓ Handle is available
              </span>
            )}
          </div>

          <div>
            <label
              htmlFor="bio"
              style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--ink)', marginBottom: '6px' }}
            >
              Bio
            </label>
            <textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="What are you building? What topics or tech stacks do you care about?"
              rows={3}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--line)',
                backgroundColor: 'var(--surface)',
                fontSize: '14px',
                color: 'var(--ink)',
                outline: 'none',
                resize: 'none',
              }}
            />
          </div>

          <div>
            <label
              style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--ink)', marginBottom: '6px' }}
            >
              Looking for tags (select all that fit)
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {SUGGESTED_TAGS.map((tag) => {
                const isSelected = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => toggleTag(tag)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 'var(--radius-pill)',
                      fontSize: '12px',
                      fontWeight: 600,
                      border: isSelected ? '1.5px solid var(--ink)' : '1px solid var(--line)',
                      backgroundColor: isSelected ? 'var(--agent)' : 'var(--surface)',
                      color: 'var(--ink)',
                      cursor: 'pointer',
                      transition: 'background-color 100ms ease',
                    }}
                  >
                    #{tag}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="submit"
            disabled={isSaving || Boolean(handleError)}
            className="btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: '12px' }}
          >
            {isSaving ? 'Saving profile...' : 'Continue to Home →'}
          </button>
        </form>
      </div>
    </div>
  );
}

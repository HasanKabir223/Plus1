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

const USERNAME_REGEX = /^[a-z0-9_]{3,20}$/;

export default function OnboardingPage() {
  const router = useRouter();
  const { user, profile, updateProfile } = useAuth();

  const [displayName, setDisplayName] = useState(profile?.profilename || profile?.name || '');
  const [username, setUsername] = useState(profile?.username || profile?.handle || '');
  const [bio, setBio] = useState(profile?.bio || '');
  const [selectedTags, setSelectedTags] = useState<string[]>(profile?.looking_for || []);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (profile) {
      if (!displayName) setDisplayName(profile.profilename || profile.name || '');
      if (!username) setUsername(profile.username || profile.handle || '');
      if (!bio) setBio(profile.bio || '');
      if (selectedTags.length === 0 && profile.looking_for) setSelectedTags(profile.looking_for);
    }
  }, [profile]);

  // Live username format & availability check
  useEffect(() => {
    const clean = username.trim().toLowerCase();
    if (!clean) {
      setUsernameError('Username is required.');
      return;
    }

    if (!USERNAME_REGEX.test(clean)) {
      setUsernameError('Username must be 3-20 characters and contain only lowercase letters, numbers, and underscores.');
      return;
    }

    if (clean === profile?.username) {
      setUsernameError(null);
      return;
    }

    setIsCheckingUsername(true);
    const timer = setTimeout(async () => {
      try {
        const existing = await db.getProfileByHandle(clean);
        if (existing && existing.id !== user?.id) {
          setUsernameError('This username is already taken. Please choose another.');
        } else {
          setUsernameError(null);
        }
      } catch {
        // network or ignore
      } finally {
        setIsCheckingUsername(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [username, profile, user]);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setGeneralError(null);

    const cleanUsername = username.trim().toLowerCase();
    const cleanName = displayName.trim() || cleanUsername;

    if (!cleanUsername) {
      setUsernameError('Username is required.');
      return;
    }

    if (!USERNAME_REGEX.test(cleanUsername)) {
      setUsernameError('Username must be 3-20 characters and contain only lowercase letters, numbers, and underscores.');
      return;
    }

    if (usernameError) return;

    if (!user) {
      router.push('/login');
      return;
    }

    try {
      setIsSaving(true);
      await updateProfile({
        username: cleanUsername,
        handle: cleanUsername,
        profilename: cleanName,
        name: cleanName,
        bio: bio.trim(),
        looking_for: selectedTags,
      });

      router.push('/home');
      router.refresh();
    } catch (err: unknown) {
      const errObj = err as { code?: string; message?: string };
      const code = errObj?.code;
      const message = errObj?.message || (err instanceof Error ? err.message : String(err));

      // Handle Postgres unique violation error (code 23505) or duplicate key message
      if (
        code === '23505' ||
        message.toLowerCase().includes('unique') ||
        message.toLowerCase().includes('duplicate key') ||
        message.toLowerCase().includes('already taken')
      ) {
        setUsernameError('This username is already taken. Please choose another.');
      } else {
        setGeneralError(message || 'Failed to save profile.');
      }
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
            Complete your profile to deploy autonomous agents and explore the network.
          </p>
        </div>

        {generalError && (
          <div
            style={{
              padding: '12px 14px',
              backgroundColor: '#FFF0F0',
              border: '1px solid var(--err)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--err)',
              fontSize: '14px',
              marginBottom: '18px',
            }}
          >
            {generalError}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div>
            <label
              htmlFor="username"
              style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--ink)', marginBottom: '6px' }}
            >
              Username (required, unique)
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
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
                placeholder="hasankabir"
                required
                autoComplete="off"
                style={{
                  width: '100%',
                  padding: '10px 12px 10px 28px',
                  borderRadius: 'var(--radius-sm)',
                  border: usernameError ? '1.5px solid var(--err)' : '1px solid var(--line)',
                  backgroundColor: 'var(--surface)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '14px',
                  color: 'var(--ink)',
                  outline: 'none',
                }}
              />
            </div>
            {isCheckingUsername ? (
              <span style={{ fontSize: '12px', color: 'var(--ink-soft)', marginTop: '4px', display: 'block' }}>
                Checking username availability...
              </span>
            ) : usernameError ? (
              <span style={{ fontSize: '12px', color: 'var(--err)', marginTop: '4px', display: 'block' }}>
                {usernameError}
              </span>
            ) : username.trim() ? (
              <span style={{ fontSize: '12px', color: 'var(--ok)', marginTop: '4px', display: 'block' }}>
                ✓ Username is available
              </span>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="displayName"
              style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--ink)', marginBottom: '6px' }}
            >
              Display Name
            </label>
            <input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
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
            disabled={isSaving || Boolean(usernameError)}
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

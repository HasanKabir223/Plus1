'use client';

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { db, formatRelativeTime } from '@/lib/db';
import type { Profile, Agent } from '@/types/database';
import { Plus, Edit2, Check, X, Clock, AlertCircle } from 'lucide-react';

export default function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const resolvedParams = use(params);
  const handleParam = decodeURIComponent(resolvedParams.handle);
  const { user, profile: authProfile, updateProfile } = useAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Edit state (only for owner)
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const isOwner = Boolean(user && profile && user.id === profile.id);

  const fetchProfileData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const cleanHandle = handleParam.replace(/^@/, '');
      const p = await db.getProfileByHandle(cleanHandle);
      if (!p) {
        setError('Profile not found');
        return;
      }
      setProfile(p);
      setEditName(p.name);
      setEditBio(p.bio);
      setEditTags(p.looking_for || []);

      const userAgents = await db.getAgentsByOwner(p.id);
      // If not owner, filter to only public agents per screens.md §3.6
      const visibleAgents = user && user.id === p.id
        ? userAgents
        : userAgents.filter((a) => a.is_public);
      setAgents(visibleAgents);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading profile');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProfileData();
  }, [handleParam, user]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !isOwner) return;
    try {
      setIsSaving(true);
      await updateProfile({
        username: editName,
        name: editName,
        bio: editBio,
        looking_for: editTags,
      });
      setProfile((prev: Profile | null) =>
        prev
          ? {
              ...prev,
              username: editName,
              name: editName,
              bio: editBio,
              looking_for: editTags,
            }
          : null
      );
      setIsEditing(false);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  const addTag = () => {
    if (tagInput.trim() && !editTags.includes(tagInput.trim())) {
      setEditTags([...editTags, tagInput.trim().toLowerCase()]);
      setTagInput('');
    }
  };

  const removeTag = (tag: string) => {
    setEditTags(editTags.filter((t) => t !== tag));
  };

  if (isLoading) {
    return (
      <AppShell headerTitle="Profile">
        <div style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-soft)' }}>
          Loading profile...
        </div>
      </AppShell>
    );
  }

  if (error || !profile) {
    return (
      <AppShell headerTitle="Profile">
        <div style={{ padding: '60px 20px', textAlign: 'center' }}>
          <AlertCircle size={36} color="var(--err)" style={{ margin: '0 auto 12px' }} />
          <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>Profile not found</h2>
          <p style={{ fontSize: '14px', color: 'var(--ink-soft)', marginBottom: '16px' }}>
            No member with the handle &ldquo;@{handleParam}&rdquo; was found on the network.
          </p>
          <Link href="/explore" className="btn-secondary" style={{ fontSize: '13px', padding: '6px 14px' }}>
            Back to Explore
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell headerTitle={`@${profile.handle}`}>
      <div>
        {/* Profile Header Block */}
        <div className="screen-section" style={{ borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
            {/* Human Avatar: circle per theme.md */}
            <div
              style={{
                width: '60px',
                height: '60px',
                borderRadius: '50%',
                backgroundColor: 'var(--human-tint)',
                color: 'var(--human)',
                border: '1.5px solid var(--ink)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24px',
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {profile.name.charAt(0).toUpperCase()}
            </div>

            {isOwner && !isEditing && (
              <button
                onClick={() => setIsEditing(true)}
                className="btn-secondary"
                style={{ padding: '6px 14px', fontSize: '13px' }}
              >
                <Edit2 size={13} /> Edit profile
              </button>
            )}
          </div>

          {!isEditing ? (
            /* Normal View */
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                <h1 style={{ fontSize: '20px', fontWeight: 700, color: 'var(--ink)', wordBreak: 'break-word' }}>{profile.name}</h1>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--ink-soft)' }}>
                  @{profile.handle}
                </span>
                {isOwner && (
                  <span className="chip chip-human" style={{ fontSize: '10px', padding: '2px 6px' }}>
                    You
                  </span>
                )}
              </div>

              {profile.bio ? (
                <p style={{ fontSize: '14px', color: 'var(--ink)', lineHeight: 1.5, marginBottom: '14px', wordBreak: 'break-word' }}>
                  {profile.bio}
                </p>
              ) : (
                <p style={{ fontSize: '14px', color: 'var(--ink-soft)', fontStyle: 'italic', marginBottom: '14px' }}>
                  No bio provided yet.
                </p>
              )}

              {profile.looking_for && profile.looking_for.length > 0 && (
                <div>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-soft)', marginBottom: '6px' }}>
                    LOOKING FOR
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {profile.looking_for.map((tag: string) => (
                      <span
                        key={tag}
                        style={{
                          fontSize: '12px',
                          fontWeight: 600,
                          backgroundColor: 'var(--surface)',
                          border: '1px solid var(--line)',
                          borderRadius: 'var(--radius-pill)',
                          padding: '3px 10px',
                          color: 'var(--ink)',
                        }}
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            /* Inline Edit View (Owner only) */
            <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  Name
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--line)',
                    backgroundColor: 'var(--surface)',
                    fontSize: '14px',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  Bio
                </label>
                <textarea
                  value={editBio}
                  onChange={(e) => setEditBio(e.target.value)}
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--line)',
                    backgroundColor: 'var(--surface)',
                    fontSize: '14px',
                    resize: 'none',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>
                  Looking for tags
                </label>
                <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    placeholder="e.g. hackathon"
                    style={{
                      flex: '1 1 160px',
                      padding: '6px 10px',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--line)',
                      backgroundColor: 'var(--surface)',
                      fontSize: '13px',
                    }}
                  />
                  <button
                    type="button"
                    onClick={addTag}
                    className="btn-secondary"
                    style={{ padding: '6px 12px', fontSize: '12px' }}
                  >
                    Add tag
                  </button>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                  {editTags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-pill)',
                        backgroundColor: 'var(--agent)',
                        fontSize: '11px',
                        fontWeight: 600,
                      }}
                    >
                      #{tag}
                      <X size={12} onClick={() => removeTag(tag)} style={{ cursor: 'pointer' }} />
                    </span>
                  ))}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '8px', marginTop: '6px', flexWrap: 'wrap' }}>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="btn-primary"
                  style={{ padding: '6px 14px', fontSize: '13px' }}
                >
                  <Check size={14} /> {isSaving ? 'Saving...' : 'Save changes'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="btn-secondary"
                  style={{ padding: '6px 14px', fontSize: '13px' }}
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Owned Agents Section */}
        <div className="screen-section">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '16px', fontWeight: 700 }}>
                {isOwner ? 'Your deployed agents' : `${profile.name}'s agents`}
              </h2>
              <span style={{ fontSize: '12px', color: 'var(--ink-soft)', fontFamily: 'var(--font-mono)' }}>
                ({agents.length})
              </span>
            </div>

            {isOwner && (
              <Link href="/agents/new" className="btn-secondary" style={{ padding: '4px 10px', fontSize: '12px' }}>
                <Plus size={13} /> Create agent
              </Link>
            )}
          </div>

          {agents.length === 0 ? (
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
                {isOwner ? 'You have no agents deployed yet.' : 'This member has not deployed any public agents yet.'}
              </p>
              {isOwner && (
                <div style={{ marginTop: '12px' }}>
                  <Link href="/agents/new" className="btn-primary" style={{ padding: '6px 14px', fontSize: '13px' }}>
                    <Plus size={14} /> Create your first agent
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 0',
                    borderBottom: '1px solid var(--line)',
                    flexWrap: 'wrap',
                    gap: '10px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: '1 1 180px' }}>
                    {/* Agent avatar: rounded square in --agent */}
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '8px',
                        backgroundColor: 'var(--agent)',
                        border: '1px solid var(--ink)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '14px',
                        color: 'var(--ink)',
                        flexShrink: 0,
                      }}
                    >
                      {agent.name.charAt(0)}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <Link
                          href={`/agents/${agent.id}`}
                          style={{
                            fontSize: '14px',
                            fontWeight: 700,
                            color: 'var(--ink)',
                            textDecoration: 'none',
                            wordBreak: 'break-word',
                          }}
                        >
                          {agent.name}
                        </Link>
                        <span
                          className="chip chip-agent"
                          style={{ fontSize: '10px', padding: '1px 6px' }}
                        >
                          {agent.status}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: 'var(--ink-soft)', display: 'flex', alignItems: 'center', gap: '4px', marginTop: '2px' }}>
                        <Clock size={12} />
                        <span>Last run: {formatRelativeTime(agent.last_run_at)}</span>
                      </div>
                    </div>
                  </div>

                  <Link
                    href={`/agents/${agent.id}`}
                    className="btn-secondary"
                    style={{ padding: '6px 12px', fontSize: '12px', flexShrink: 0 }}
                  >
                    View agent
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}

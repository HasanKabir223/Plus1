'use client';

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { db, formatRelativeTime } from '@/lib/db';
import type { Profile, Agent, Conversation, PostWithAuthor } from '@/types/database';
import PostCard from '@/components/feed/post-card';
import PostComposer from '@/components/feed/post-composer';
import styles from './profile.module.css';
import {
  ArrowLeft,
  Search,
  X,
  Plus,
  Trash2,
  AlertCircle,
  Clock,
  Play,
  Edit2,
  UserCheck,
  UserPlus,
  Bot,
  MessageSquare,
  ArrowRight,
  Shield,
  FileText,
  CalendarDays,
  RotateCw,
} from 'lucide-react';

/**
 * Extracts the first two characters from a display name in uppercase.
 * Supports Unicode letters, numbers, and international alphabets.
 * Examples:
 * - "Hasan Kabir" -> "HA"
 * - "hasankabir"  -> "HA"
 * - "Elena"       -> "EL"
 * - "José"        -> "JO"
 * - "Élise"       -> "ÉL"
 * - "H"           -> "H"
 */
function getAvatarLetters(displayName?: string | null): string {
  if (!displayName) return 'U';
  const trimmed = displayName.trim();
  if (!trimmed) return 'U';

  // Extract Unicode letters and numbers
  const letters = trimmed.match(/[\p{L}\p{N}]/gu);
  if (letters && letters.length >= 2) {
    return (letters[0] + letters[1]).toUpperCase();
  }
  if (letters && letters.length === 1) {
    return letters[0].toUpperCase();
  }

  // Fallback to first code units of trimmed string
  const chars = Array.from(trimmed);
  if (chars.length >= 2) {
    return (chars[0] + chars[1]).toUpperCase();
  }
  return chars[0]?.toUpperCase() || 'U';
}

export default function ProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const router = useRouter();
  const resolvedParams = use(params);
  const handleParam = decodeURIComponent(resolvedParams.handle);
  const { user, updateProfile, signOut } = useAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [conversations, setConversations] = useState<
    (Conversation & { initiator: Agent | null; target: Agent | null })[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningAgentId, setRunningAgentId] = useState<string | null>(null);

  // Sub-tabs: 'posts' | 'agents' | 'activity' | 'about'
  const [activeTab, setActiveTab] = useState<'posts' | 'agents' | 'activity' | 'about'>('posts');

  // Uploaded content: posts authored by this profile
  const [posts, setPosts] = useState<PostWithAuthor[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [postsError, setPostsError] = useState<string | null>(null);

  // Network Boost status (from /boost activation)
  const [isBoosted, setIsBoosted] = useState(false);

  // Followers & Following state
  const [isFollowing, setIsFollowing] = useState(false);
  const [followersCount, setFollowersCount] = useState(0);
  const [followingCount, setFollowingCount] = useState(0);
  const [isTogglingFollow, setIsTogglingFollow] = useState(false);

  // Edit profile modal state (owner only)
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBio, setEditBio] = useState('');
  const [editTags, setEditTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Account deletion state (owner only)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const isOwner = Boolean(user && profile && user.id === profile.id);

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      try {
        const cleanHandle = handleParam.replace(/^@/, '');
        const p = await db.getProfileByUsername(cleanHandle);
        if (!isMounted) return;
        if (!p) {
          setError('Profile not found');
          setIsLoading(false);
          return;
        }
        setProfile(p);
        setEditName(p.profilename || p.name || p.username);
        setEditBio(p.bio || '');
        setEditTags(p.looking_for || []);

        // Live metrics & follow status from db - strictly 0 baseline for empty accounts
        try {
          const stats = await db.getProfileStats(p.id);
          if (isMounted && stats) {
            setFollowersCount(stats.follower_count ?? 0);
            setFollowingCount(stats.following_count ?? 0);
          }
        } catch (statsErr) {
          console.warn('Failed to fetch profile stats:', statsErr);
          if (isMounted) {
            setFollowersCount(0);
            setFollowingCount(0);
          }
        }

        if (user && user.id !== p.id) {
          try {
            const userFollows = await db.isFollowing(user.id, p.id);
            if (isMounted) {
              setIsFollowing(userFollows);
            }
          } catch (followErr) {
            console.warn('Failed to check follow status:', followErr);
            if (isMounted) {
              setIsFollowing(false);
            }
          }
        } else {
          if (isMounted) {
            setIsFollowing(false);
          }
        }

        try {
          if (isMounted) {
            setPostsLoading(true);
            setPostsError(null);
          }
          const profilePosts = await db.fetchPostsByProfile(p.id, 50);
          if (isMounted) {
            setPosts(profilePosts || []);
            setPostsLoading(false);
          }
        } catch (postsErr) {
          console.warn('Failed to fetch profile posts:', postsErr);
          if (isMounted) {
            setPosts([]);
            setPostsError('Could not load posts. Please try again.');
            setPostsLoading(false);
          }
        }

        const userAgents = await db.getAgentsByOwner(p.id);
        if (!isMounted) return;
        const visibleAgents = user && user.id === p.id
          ? userAgents
          : userAgents.filter((a) => a.is_public);
        setAgents(visibleAgents);

        try {
          const convs = await db.getLiveConversationsForUser(p.id);
          if (isMounted) setConversations(convs || []);
        } catch {
          if (isMounted) setConversations([]);
        }
      } catch (err: unknown) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Error loading profile');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [handleParam, user]);

  // Sync boost verification status from /boost
  useEffect(() => {
    const timer = setTimeout(() => {
      if (typeof window !== 'undefined' && profile) {
        const activeForUser = user?.id && localStorage.getItem(`plus1_boosted_${user.id}`) === 'true';
        const activeForProfile = profile.id && localStorage.getItem(`plus1_boosted_${profile.id}`) === 'true';
        const activeGlobal = localStorage.getItem('plus1_boosted_global') === 'true';
        setIsBoosted(Boolean(activeForUser || activeForProfile || activeGlobal));
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [profile, user]);

  // Close modal on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isEditing) {
        setIsEditing(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditing]);

  // Refresh uploaded posts when the feed store changes (own composer, deletes)
  useEffect(() => {
    if (!profile?.id) return;
    const profileId = profile.id;
    const refreshPosts = async () => {
      try {
        const profilePosts = await db.fetchPostsByProfile(profileId, 50);
        setPosts(profilePosts || []);
        setPostsError(null);
      } catch {
        // Keep existing posts on background refresh failure
      }
    };
    return db.subscribe('posts', refreshPosts);
  }, [profile?.id]);

  const handleToggleFollow = async () => {
    if (!user) {
      router.push('/login');
      return;
    }
    if (!profile || isOwner || user.id === profile.id || isTogglingFollow) return;

    setIsTogglingFollow(true);
    const previousFollowing = isFollowing;
    const previousCount = followersCount;

    // Optimistic UI update
    const nextFollowing = !previousFollowing;
    setIsFollowing(nextFollowing);
    setFollowersCount((prev) => (nextFollowing ? prev + 1 : Math.max(0, prev - 1)));

    try {
      if (nextFollowing) {
        await db.followUser(user.id, profile.id);
      } else {
        await db.unfollowUser(user.id, profile.id);
      }

      // Sync fresh live stats from database
      const freshStats = await db.getProfileStats(profile.id);
      if (freshStats) {
        setFollowersCount(freshStats.follower_count);
        setFollowingCount(freshStats.following_count);
      }
    } catch (err: unknown) {
      console.error('Failed to update follow status:', err);
      // Rollback optimistic state
      setIsFollowing(previousFollowing);
      setFollowersCount(previousCount);
      alert(err instanceof Error ? err.message : 'Failed to update follow status. Please try again.');
    } finally {
      setIsTogglingFollow(false);
    }
  };

  const handleSaveProfile = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!profile || !isOwner) return;
    try {
      setIsSaving(true);
      const trimmedName = editName.trim() || profile.username;
      await updateProfile({
        profilename: trimmedName,
        name: trimmedName,
        bio: editBio,
        looking_for: editTags,
      });
      setProfile((prev: Profile | null) =>
        prev
          ? {
            ...prev,
            profilename: trimmedName,
            name: trimmedName,
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
    const clean = tagInput.trim().toLowerCase().replace(/^#/, '');
    if (clean && !editTags.includes(clean)) {
      setEditTags([...editTags, clean]);
      setTagInput('');
    }
  };

  const removeTag = (tag: string) => {
    setEditTags(editTags.filter((t) => t !== tag));
  };

  const handlePostCreated = (newPost: PostWithAuthor) => {
    setPosts((prev) => [newPost, ...prev]);
    setPostsError(null);
  };

  const handlePostDeleted = (deletedPostId: string) => {
    setPosts((prev) => prev.filter((p) => p.id !== deletedPostId));
  };

  const handleRetryPosts = async () => {
    if (!profile) return;
    try {
      setPostsLoading(true);
      setPostsError(null);
      const profilePosts = await db.fetchPostsByProfile(profile.id, 50);
      setPosts(profilePosts || []);
    } catch {
      setPostsError('Could not load posts. Please try again.');
    } finally {
      setPostsLoading(false);
    }
  };

  const handleQuickRun = async (agentId: string) => {
    if (!user) return;
    try {
      setRunningAgentId(agentId);
      await db.runAgent(agentId, user.id);
      const userAgents = await db.getAgentsByOwner(profile?.id || user.id);
      setAgents(userAgents);
    } catch (err) {
      console.error(err);
    } finally {
      setRunningAgentId(null);
    }
  };

  const handleDeleteAccount = async () => {
    if (!user) return;
    try {
      setIsDeletingAccount(true);
      setDeleteError(null);
      const res = await fetch('/api/account/delete', {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to delete account');
      }
      try {
        await db.deleteAccount(user.id);
      } catch {
        // Fallback local cleanup
      }
      await signOut();
      router.push('/');
      router.refresh();
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete account');
      setIsDeletingAccount(false);
    }
  };

  const formatJoinedDate = (isoString?: string) => {
    if (!isoString) return 'Recently';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return 'Recently';
      return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    } catch {
      return 'Recently';
    }
  };

  if (isLoading) {
    return (
      <AppShell headerTitle="Profile">
        <div className={styles.loadingContainer}>
          <div className={styles.loadingSpinner} />
          <p className={styles.loadingText}>Loading network profile...</p>
        </div>
      </AppShell>
    );
  }

  if (error || !profile) {
    return (
      <AppShell headerTitle="Profile">
        <div className={styles.notFoundContainer}>
          <AlertCircle size={40} color="var(--err)" style={{ margin: '0 auto 12px' }} />
          <h2 className={styles.notFoundTitle}>Profile not found</h2>
          <p className={styles.notFoundText}>
            No member with handle &ldquo;@{handleParam}&rdquo; was found on the Plus1 network.
          </p>
          <Link href="/explore" className="btn-secondary" style={{ fontSize: '13px', padding: '8px 16px' }}>
            Back to Explore
          </Link>
        </div>
      </AppShell>
    );
  }

  const displayName = profile.profilename || profile.name || profile.username;
  const avatarInitials = getAvatarLetters(displayName);

  return (
    <AppShell>
      <div className={styles.container}>
        {/* Top Sub-Header Navigation with Wireframe Explore Network Pill */}
        <div className={styles.topSubBar}>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined' && window.history.length > 1) {
                router.back();
              } else {
                router.push('/explore');
              }
            }}
            className={styles.backButton}
            aria-label="Back"
          >
            <ArrowLeft size={16} />
            <span>Back</span>
          </button>

          <Link
            href="/explore"
            className={styles.exploreNetworkPill}
            title="Explore Plus1 network"
          >
            <Search size={14} />
            <span>Explore network</span>
          </Link>
        </div>

        {/* Hero Identity Section - Centered layout per User Wireframe */}
        <section className={styles.heroSection}>
          {/* Centered Circular Avatar (First two letters of Display Name) */}
          <div className={styles.avatarContainer}>
            <div className={styles.avatarCircle} title={displayName}>
              {avatarInitials}
            </div>
          </div>

          {/* Centered Identity Information */}
          <div className={styles.heroInfo}>
            <div className={styles.displayNameRow}>
              <h1 className={styles.displayNameText}>{displayName.trim()}</h1>
              {isBoosted && (
                <span className={styles.boostBadge} title="Boosted node with priority indexing">
                  Boosted
                </span>
              )}
            </div>

            <div className={styles.usernameText}>@{profile.username}</div>

            {profile.bio ? (
              <p className={styles.bioText}>{profile.bio}</p>
            ) : (
              <p className={styles.bioEmptyText}>
                {isOwner
                  ? 'No bio provided yet. Click "Edit profile" to introduce yourself to the network.'
                  : 'No bio provided yet.'}
              </p>
            )}

            {/* Interest Tags */}
            {profile.looking_for && profile.looking_for.length > 0 && (
              <div className={styles.tagsRow}>
                {profile.looking_for.map((tag: string) => (
                  <span key={tag} className={styles.tagBadge}>
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            <div className={styles.metaLine}>
              <CalendarDays size={13} aria-hidden="true" />
              <span>Joined {formatJoinedDate(profile.created_at)}</span>
            </div>

            {/* Metrics Row: uploaded posts, agents, following, followers */}
            <div className={styles.metricsBar}>
              <button
                type="button"
                onClick={() => setActiveTab('posts')}
                className={`${styles.metricItem} ${activeTab === 'posts' ? styles.metricItemActive : ''}`}
                title="View uploaded posts"
                aria-pressed={activeTab === 'posts'}
              >
                <span className={styles.metricValue}>{posts.length}</span>
                <span className={styles.metricLabel}>{posts.length === 1 ? 'Post' : 'Posts'}</span>
              </button>

              <div className={styles.metricDivider} />

              <button
                type="button"
                onClick={() => setActiveTab('agents')}
                className={`${styles.metricItem} ${activeTab === 'agents' ? styles.metricItemActive : ''}`}
                title="View deployed agents"
                aria-pressed={activeTab === 'agents'}
              >
                <span className={styles.metricValue}>{agents.length}</span>
                <span className={styles.metricLabel}>{agents.length === 1 ? 'Agent' : 'Agents'}</span>
              </button>

              <div className={styles.metricDivider} />

              <div
                className={styles.metricStatic}
                title={isOwner ? 'Profiles you follow' : `Profiles ${displayName.trim()} follows`}
              >
                <span className={styles.metricValue}>{followingCount}</span>
                <span className={styles.metricLabel}>Following</span>
              </div>

              <div className={styles.metricDivider} />

              <div
                className={styles.metricStatic}
                title={isOwner ? 'Profiles following you' : `Profiles following ${displayName.trim()}`}
              >
                <span className={styles.metricValue}>{followersCount}</span>
                <span className={styles.metricLabel}>Followers</span>
              </div>
            </div>

            {/* Action Buttons Row */}
            <div className={styles.actionRow}>
              {isOwner ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (profile) {
                        setEditName(profile.profilename || profile.name || profile.username);
                        setEditBio(profile.bio || '');
                        setEditTags(profile.looking_for || []);
                      }
                      setIsEditing(true);
                    }}
                    className={styles.editProfileBtn}
                  >
                    <Edit2 size={14} />
                    <span>Edit profile</span>
                  </button>

                  <Link
                    href="/agents/new"
                    className={`btn-primary ${styles.deployHeaderBtn}`}
                  >
                    <Plus size={14} />
                    <span>Deploy agent</span>
                  </Link>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={handleToggleFollow}
                    disabled={isTogglingFollow}
                    className={isFollowing ? styles.followingBtn : styles.followBtn}
                  >
                    {isFollowing ? (
                      <>
                        <UserCheck size={15} />
                        <span>Following</span>
                      </>
                    ) : (
                      <>
                        <UserPlus size={15} />
                        <span>Follow</span>
                      </>
                    )}
                  </button>

                  <Link href="/explore" className={styles.exploreLinkBtn}>
                    <Search size={14} />
                    <span>Explore network</span>
                  </Link>
                </>
              )}
            </div>
          </div>
        </section>

        {/* Section Navigation Tabs */}
        <div className={styles.tabsNav} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'posts'}
            onClick={() => setActiveTab('posts')}
            className={`${styles.tabItem} ${activeTab === 'posts' ? styles.tabItemActive : ''}`}
          >
            <FileText size={16} />
            <span>Posts ({posts.length})</span>
            {activeTab === 'posts' && <div className={styles.tabIndicator} />}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'agents'}
            onClick={() => setActiveTab('agents')}
            className={`${styles.tabItem} ${activeTab === 'agents' ? styles.tabItemActive : ''}`}
          >
            <Bot size={16} />
            <span>Agents ({agents.length})</span>
            {activeTab === 'agents' && <div className={styles.tabIndicator} />}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'activity'}
            onClick={() => setActiveTab('activity')}
            className={`${styles.tabItem} ${activeTab === 'activity' ? styles.tabItemActive : ''}`}
          >
            <MessageSquare size={16} />
            <span>Activity ({conversations.length})</span>
            {activeTab === 'activity' && <div className={styles.tabIndicator} />}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'about'}
            onClick={() => setActiveTab('about')}
            className={`${styles.tabItem} ${activeTab === 'about' ? styles.tabItemActive : ''}`}
          >
            <Shield size={16} />
            <span>About</span>
            {activeTab === 'about' && <div className={styles.tabIndicator} />}
          </button>
        </div>

        {/* Tab 0: Uploaded Posts */}
        {activeTab === 'posts' && (
          <div className={styles.tabContent}>
            {isOwner && (
              <div className={styles.postsComposerWrap}>
                <PostComposer onPostCreated={handlePostCreated} />
              </div>
            )}

            <div className={styles.deployBar}>
              <div>
                <h3 className={styles.deployBarTitle}>
                  {isOwner ? 'Your posts' : `Posts by ${displayName.trim()}`}
                </h3>
                <p className={styles.deployBarSub}>
                  {posts.length === 0
                    ? 'Updates shared on the network appear here.'
                    : `${posts.length} ${posts.length === 1 ? 'update' : 'updates'} shared on the network.`}
                </p>
              </div>
            </div>

            {postsLoading ? (
              <div className={styles.postsLoading} role="status" aria-label="Loading posts">
                <div className={styles.loadingSpinner} />
                <p className={styles.loadingText}>Loading posts...</p>
              </div>
            ) : postsError ? (
              <div className={styles.postsError} role="alert">
                <span className={styles.postsErrorText}>
                  <AlertCircle size={15} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                  {postsError}
                </span>
                <button
                  type="button"
                  onClick={handleRetryPosts}
                  className={styles.postsRetryBtn}
                >
                  <RotateCw size={13} />
                  <span>Retry</span>
                </button>
              </div>
            ) : posts.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIconBox}>
                  <FileText size={28} color="var(--ink)" />
                </div>
                <h3 className={styles.emptyTitle}>
                  {isOwner ? 'No posts yet' : 'No posts shared yet'}
                </h3>
                <p className={styles.emptyDesc}>
                  {isOwner
                    ? 'Share your first update above. Your posts will appear here and on the Home feed.'
                    : 'This member has not shared any updates on the network yet.'}
                </p>
              </div>
            ) : (
              <div className={styles.postsList}>
                {posts.map((post) => (
                  <PostCard key={post.id} post={post} onPostDeleted={handlePostDeleted} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 1: Deployed Agents List */}
        {activeTab === 'agents' && (
          <div className={styles.tabContent}>
            {isOwner && (
              <div className={styles.deployBar}>
                <div>
                  <h3 className={styles.deployBarTitle}>Your Deployed Agents</h3>
                  <p className={styles.deployBarSub}>
                    Agents operate autonomously on the network based on their skills.
                  </p>
                </div>
              </div>
            )}

            {agents.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIconBox}>
                  <Bot size={28} color="var(--ink)" />
                </div>
                <h3 className={styles.emptyTitle}>
                  {isOwner ? 'No agents deployed yet' : 'No public agents deployed'}
                </h3>
                <p className={styles.emptyDesc}>
                  {isOwner
                    ? 'Deploy your first autonomous agent to browse the network, search profiles, and make peer introductions.'
                    : 'This member has not made any public agents available yet.'}
                </p>
                <div className={styles.emptyActions}>
                  {isOwner && (
                    <Link href="/agents/new" className="btn-primary" style={{ padding: '8px 20px', fontSize: '13px' }}>
                      <Plus size={15} /> Create your first agent
                    </Link>
                  )}
                  <Link href="/explore" className="btn-secondary" style={{ padding: '8px 18px', fontSize: '13px' }}>
                    <Search size={14} /> Browse network agents
                  </Link>
                </div>
              </div>
            ) : (
              <div className={styles.agentList}>
                {agents.map((agent) => (
                  <div key={agent.id} className={styles.agentRow}>
                    {/* Agent avatar: rounded square in --agent per theme.md */}
                    <div className={styles.agentAvatarSquare} title={agent.name}>
                      {Array.from(agent.name.trim())[0]?.toUpperCase() || 'A'}
                    </div>

                    <div className={styles.agentMain}>
                      <div className={styles.agentTopLine}>
                        <div className={styles.agentNameGroup}>
                          <Link href={`/agents/${agent.id}`} className={styles.agentName}>
                            {agent.name}
                          </Link>
                          <span className={styles.agentHandle}>
                            @{agent.name.toLowerCase().replace(/\s+/g, '')}
                          </span>
                          <span className={styles.agentDot}>·</span>
                          <span className={styles.agentTime}>
                            <Clock size={12} />
                            {formatRelativeTime(agent.last_run_at)}
                          </span>
                        </div>

                        <span
                          className={`chip ${agent.status === 'active' ? 'chip-agent' : ''}`}
                          style={{ fontSize: '11px', padding: '2px 8px' }}
                        >
                          {agent.status}
                        </span>
                      </div>

                      <p className={styles.agentBio}>
                        {agent.personality || 'Autonomous representative on the Plus1 network.'}
                      </p>

                      <div className={styles.agentFooter}>
                        <div className={styles.agentChips}>
                          {agent.is_public && (
                            <span className={styles.agentPublicChip}>
                              #public
                            </span>
                          )}
                        </div>

                        <div className={styles.agentActions}>
                          {isOwner && (
                            <button
                              type="button"
                              onClick={() => handleQuickRun(agent.id)}
                              disabled={runningAgentId === agent.id || agent.status === 'paused'}
                              className={styles.agentRunBtn}
                              title="Trigger immediate execution cycle"
                            >
                              {runningAgentId === agent.id ? (
                                'Running...'
                              ) : (
                                <>
                                  <Play size={12} /> Run agent
                                </>
                              )}
                            </button>
                          )}

                          <Link
                            href={`/agents/${agent.id}`}
                            className={styles.agentViewBtn}
                          >
                            <span>View agent</span>
                            <ArrowRight size={13} />
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Activity List (Live Multi-Agent Dialogue) */}
        {activeTab === 'activity' && (
          <div className={styles.tabContent}>
            {conversations.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIconBox}>
                  <MessageSquare size={28} color="var(--ink)" />
                </div>
                <h3 className={styles.emptyTitle}>No agent activity recorded</h3>
                <p className={styles.emptyDesc}>
                  Autonomous peer dialogues and technical evaluations conducted by agents will appear here.
                </p>
              </div>
            ) : (
              <div className={styles.activityList}>
                {conversations.map((c) => {
                  const isInitiator = agents.some((a) => a.id === c.initiator_agent_id);
                  const myAgent = isInitiator ? c.initiator : c.target;
                  const peerAgent = isInitiator ? c.target : c.initiator;

                  return (
                    <div key={c.id} className={styles.activityRow}>
                      <div className={styles.activityAvatarSquare}>
                        {myAgent?.name?.charAt(0).toUpperCase() || 'A'}
                      </div>

                      <div className={styles.activityMain}>
                        <div className={styles.activityHeader}>
                          <div className={styles.activityTitleGroup}>
                            <span className={styles.activityAgentName}>{myAgent?.name || 'Agent'}</span>
                            <span className={styles.activityPeerText}>
                              dialogue with @{peerAgent?.name || 'PeerAgent'}
                            </span>
                            <span className={styles.agentDot}>·</span>
                            <span className={styles.agentTime}>
                              {formatRelativeTime(c.created_at)}
                            </span>
                          </div>

                          <span
                            className={c.status === 'live' ? 'chip chip-human' : 'chip'}
                            style={{ fontSize: '11px', padding: '2px 8px' }}
                          >
                            {c.status === 'live' ? 'Live' : 'Done'} ({c.turn_count}/{c.max_turns} turns)
                          </span>
                        </div>

                        <p className={styles.activitySnippet}>
                          Multi-turn agent exchange between {myAgent?.name || 'Agent'} and {peerAgent?.name || 'peer'} assessing collaborative synergy.
                        </p>

                        <div className={styles.activityFooter}>
                          <Link href={`/threads/${c.id}`} className={styles.threadLinkBtn}>
                            <span>View conversation thread</span>
                            <ArrowRight size={13} />
                          </Link>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: About Member & Network Details */}
        {activeTab === 'about' && (
          <div className={styles.tabContent}>
            <div className={styles.aboutGrid}>
              <div className={styles.aboutCard}>
                <h3 className={styles.aboutCardTitle}>About {displayName}</h3>
                <p className={styles.aboutCardBody}>
                  {profile.bio || 'No extended bio provided.'}
                </p>
              </div>

              {profile.looking_for && profile.looking_for.length > 0 && (
                <div className={styles.aboutCard}>
                  <h3 className={styles.aboutCardTitle}>Looking For / Focus Areas</h3>
                  <div className={styles.aboutTagsRow}>
                    {profile.looking_for.map((tag) => (
                      <span key={tag} className={styles.tagBadge}>
                        #{tag}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className={styles.aboutCard}>
                <h3 className={styles.aboutCardTitle}>Network Node Metadata</h3>
                <div className={styles.metaList}>
                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Handle</span>
                    <span className={styles.metaValueMono}>@{profile.username}</span>
                  </div>
                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Member Since</span>
                    <span className={styles.metaValue}>{formatJoinedDate(profile.created_at)}</span>
                  </div>
                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Verification</span>
                    <span className={styles.metaValueOk}>Active Node · Authenticated</span>
                  </div>
                  <div className={styles.metaRow}>
                    <span className={styles.metaLabel}>Boost Status</span>
                    {isBoosted ? (
                      <span className={styles.metaValueOk}>Boosted Node · Priority Indexing</span>
                    ) : isOwner ? (
                      <Link href="/boost" className={styles.metaBoostLink} title="Activate Boost">
                        Standard Node · Activate Boost
                      </Link>
                    ) : (
                      <span className={styles.metaValue}>Standard Node</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Danger Zone: Account Deletion (Owner only) */}
              {isOwner && (
                <div className={styles.dangerCard}>
                  <h3 className={styles.dangerCardTitle}>Danger Zone</h3>
                  <p className={styles.dangerCardText}>
                    Permanently delete your account from the network database. This action immediately removes your profile and all deployed agents.
                  </p>

                  {!showDeleteConfirm ? (
                    <button
                      type="button"
                      onClick={() => setShowDeleteConfirm(true)}
                      className={styles.deleteAccountBtn}
                    >
                      <Trash2 size={14} />
                      <span>Delete account</span>
                    </button>
                  ) : (
                    <div className={styles.dangerConfirmBox}>
                      <div className={styles.dangerConfirmHeading}>
                        Confirm Permanent Account Deletion
                      </div>
                      <p className={styles.dangerConfirmNote}>
                        This will permanently delete your authentication record (<code className={styles.codeSnippet}>{user?.id}</code>). All dependent public profiles and deployed agents will be completely removed.
                      </p>

                      {deleteError && (
                        <div className={styles.dangerErrorMsg}>
                          Error: {deleteError}
                        </div>
                      )}

                      <div className={styles.dangerBtnRow}>
                        <button
                          type="button"
                          onClick={handleDeleteAccount}
                          disabled={isDeletingAccount}
                          className={styles.deleteConfirmBtn}
                        >
                          {isDeletingAccount ? 'Deleting account...' : 'Yes, permanently delete my account'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowDeleteConfirm(false);
                            setDeleteError(null);
                          }}
                          disabled={isDeletingAccount}
                          className="btn-secondary"
                          style={{ padding: '8px 16px', fontSize: '13px' }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Clean Plus1 Modal: Edit Profile (Owner only) */}
        {isEditing && (
          <div
            className={styles.modalBackdrop}
            onClick={(e) => {
              if (e.target === e.currentTarget) setIsEditing(false);
            }}
          >
            <div
              className={styles.modalDialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-profile-title"
            >
              <div className={styles.modalHeader}>
                <div className={styles.modalHeaderLeft}>
                  <button
                    type="button"
                    onClick={() => setIsEditing(false)}
                    className={styles.modalCloseBtn}
                    aria-label="Close"
                  >
                    <X size={18} />
                  </button>
                  <h2 id="edit-profile-title" className={styles.modalTitle}>
                    Edit profile
                  </h2>
                </div>

                <button
                  type="button"
                  onClick={handleSaveProfile}
                  disabled={isSaving || !editName.trim()}
                  className={styles.modalSaveBtn}
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              </div>

              <div className={styles.modalBody}>
                <div className={styles.inputGroup}>
                  <label className={styles.inputLabel}>
                    <span>Display name</span>
                    <span className={styles.inputCount}>{editName.length} / 50</span>
                  </label>
                  <input
                    type="text"
                    value={editName}
                    maxLength={50}
                    onChange={(e) => setEditName(e.target.value)}
                    className={styles.textInput}
                    placeholder="Your full name or alias"
                    required
                  />
                </div>

                <div className={styles.inputGroup}>
                  <label className={styles.inputLabel}>
                    <span>Bio</span>
                    <span className={styles.inputCount}>{editBio.length} / 160</span>
                  </label>
                  <textarea
                    value={editBio}
                    maxLength={160}
                    rows={3}
                    onChange={(e) => setEditBio(e.target.value)}
                    className={styles.textArea}
                    placeholder="Tell the network what you're building..."
                  />
                </div>

                <div className={styles.inputGroup}>
                  <label className={styles.inputLabel}>
                    <span>Looking for tags</span>
                  </label>
                  <div className={styles.tagInputRow}>
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addTag();
                        }
                      }}
                      placeholder="e.g. teammates, distributed-systems"
                      className={styles.textInput}
                    />
                    <button
                      type="button"
                      onClick={addTag}
                      className="btn-secondary"
                      style={{ padding: '8px 14px', fontSize: '13px', borderRadius: 'var(--radius-pill)', flexShrink: 0 }}
                    >
                      Add tag
                    </button>
                  </div>

                  <div className={styles.modalTagsWrap}>
                    {editTags.map((tag) => (
                      <span key={tag} className={styles.modalTagChip}>
                        #{tag}
                        <X
                          size={13}
                          onClick={() => removeTag(tag)}
                          className={styles.removeTagIcon}
                          aria-label={`Remove tag ${tag}`}
                        />
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}

'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { db } from '@/lib/db';
import type { Agent, InboxItem } from '@/types/database';
import styles from './AppShell.module.css';
import {
  Home,
  Compass,
  Inbox,
  User,
  Plus,
  LogOut,
  Play,
  CheckCircle,
} from 'lucide-react';

interface AppShellProps {
  children: React.ReactNode;
  headerTitle?: string;
  headerRight?: React.ReactNode;
}

export default function AppShell({ children, headerTitle, headerRight }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, profile, signOut } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [userAgents, setUserAgents] = useState<Agent[]>([]);
  const [runningAgentId, setRunningAgentId] = useState<string | null>(null);

  // Load unread count and user agents from DB
  const loadSidebarData = async () => {
    if (!user) return;
    try {
      const items = await db.getInboxItems(user.id);
      const unread = items.filter((i) => i.status === 'unread').length;
      setUnreadCount(unread);

      const agents = await db.getAgentsByOwner(user.id);
      setUserAgents(agents);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    loadSidebarData();
    const unsubInbox = db.subscribe('inbox', loadSidebarData);
    const unsubAgents = db.subscribe('agents', loadSidebarData);
    return () => {
      unsubInbox();
      unsubAgents();
    };
  }, [user]);

  const handleQuickRun = async (agentId: string) => {
    if (!user) return;
    try {
      setRunningAgentId(agentId);
      await db.runAgent(agentId, user.id);
      await loadSidebarData();
    } catch (e) {
      console.error(e);
    } finally {
      setRunningAgentId(null);
    }
  };

  const displayName = profile?.profilename || profile?.username || '';
  const userInitial = displayName ? displayName.charAt(0).toUpperCase() : 'U';

  const navItems = [
    { href: '/home', label: 'Home', icon: Home, badge: 0 },
    { href: '/explore', label: 'Explore', icon: Compass, badge: 0 },
    { href: '/home#inbox', label: 'Inbox', icon: Inbox, badge: unreadCount },
    { href: profile?.username ? `/u/${profile.username}` : '/onboarding', label: 'Profile', icon: User, badge: 0 },
  ];

  return (
    <div className={styles.layout}>
      {/* Left Navigation Rail (Twitter/X style) */}
      <aside className={styles.sidebar}>
        <div>
          <Link href="/home" className={styles.brand}>
            <span>Plus1</span>
            <span className={styles.brandBadge}>Network</span>
          </Link>

          <nav className={styles.nav}>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href || (item.href.startsWith('/u/') && pathname.startsWith('/u/'));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}
                >
                  <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                  <span>{item.label}</span>
                  {item.badge > 0 && <span className={styles.navBadge}>{item.badge}</span>}
                </Link>
              );
            })}
          </nav>

          <div className={styles.sidebarAction}>
            <button
              onClick={() => router.push('/agents/new')}
              className={styles.createBtn}
            >
              <Plus size={18} strokeWidth={2.5} />
              <span>Create agent</span>
            </button>
          </div>
        </div>

        {/* User Badge at Bottom */}
        <div className={styles.userSection}>
          <div className={styles.userCard}>
            <div className={styles.humanAvatar}>
              {userInitial}
            </div>
            <div className={styles.userInfo} onClick={() => profile?.username && router.push(`/u/${profile.username}`)}>
              <div className={styles.userName}>{displayName}</div>
              {profile?.username && <div className={styles.userHandle}>@{profile.username}</div>}
            </div>
            <button
              onClick={() => signOut()}
              className={styles.logoutBtn}
              title="Log out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Column */}
      <main className={styles.main}>
        {/* Mobile Top Bar */}
        <div className={styles.mobileTopBar}>
          <Link href="/home" className={styles.mobileBrand}>
            <span>Plus1</span>
            <span className={styles.brandBadge}>Network</span>
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              onClick={() => router.push('/agents/new')}
              className={styles.mobileCreateBtn}
              title="Create agent"
            >
              <Plus size={20} strokeWidth={2.5} />
            </button>
            <div
              className={styles.humanAvatar}
              style={{ width: '32px', height: '32px', fontSize: '13px', cursor: 'pointer' }}
              onClick={() => profile?.username && router.push(`/u/${profile.username}`)}
              title="View profile"
            >
              {userInitial}
            </div>
          </div>
        </div>

        {headerTitle && (
          <header className={styles.header}>
            <h1 className={styles.headerTitle}>{headerTitle}</h1>
            {headerRight && <div>{headerRight}</div>}
          </header>
        )}
        <div className={styles.content}>{children}</div>
      </main>

      {/* Right Sidebar (Network & Agent Pulse) */}
      <aside className={styles.aside}>
        {/* Your Active Agents Widget */}
        <div className={styles.widgetBox}>
          <h2 className={styles.widgetTitle}>Your agents</h2>
          {userAgents.length === 0 ? (
            <div style={{ fontSize: '13px', color: 'var(--ink-soft)' }}>
              No agents yet. Create one to explore the network on your behalf.
            </div>
          ) : (
            userAgents.map((agent) => (
              <div key={agent.id} className={styles.widgetRow}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '6px',
                      backgroundColor: 'var(--agent)',
                      border: '1px solid var(--ink)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: 700,
                    }}
                  >
                    {agent.name.charAt(0)}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '13px' }}>{agent.name}</div>
                    <div style={{ fontSize: '11px', color: 'var(--ink-soft)' }}>
                      {agent.status}
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => handleQuickRun(agent.id)}
                  disabled={runningAgentId === agent.id || agent.status === 'paused'}
                  className="btn-secondary"
                  style={{
                    padding: '4px 10px',
                    fontSize: '12px',
                    opacity: agent.status === 'paused' ? 0.5 : 1,
                  }}
                >
                  {runningAgentId === agent.id ? (
                    'Running...'
                  ) : (
                    <>
                      <Play size={12} /> Run
                    </>
                  )}
                </button>
              </div>
            ))
          )}
        </div>

        {/* Network Principles */}
        <div className={styles.widgetBox}>
          <h2 className={styles.widgetTitle}>How agents work</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px', color: 'var(--ink-soft)' }}>
            <div style={{ display: 'flex', gap: '8px' }}>
              <CheckCircle size={16} color="var(--ok)" style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>Agents search public profiles for technical overlap.</span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <CheckCircle size={16} color="var(--ok)" style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>Peer conversations run up to 6 turns before reporting.</span>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <CheckCircle size={16} color="var(--ok)" style={{ flexShrink: 0, marginTop: '2px' }} />
              <span>Key findings arrive in your Home Inbox in real time.</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile Fixed Bottom Navigation Bar */}
      <nav className={styles.mobileBottomNav} aria-label="Mobile Navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || (item.href.startsWith('/u/') && pathname.startsWith('/u/'));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.mobileNavItem} ${isActive ? styles.mobileNavItemActive : ''}`}
            >
              <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
              <span>{item.label}</span>
              {item.badge > 0 && <span className={styles.mobileBadge}>{item.badge}</span>}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

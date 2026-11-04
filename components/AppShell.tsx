'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { db } from '@/lib/db';
import type { Agent } from '@/types/database';
import styles from './AppShell.module.css';
import {
  Home,
  Compass,
  User,
  Plus,
  LogOut,
  Play,
  MessageCircle,
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
  const [userAgents, setUserAgents] = useState<Agent[]>([]);


  // Load user agents from DB
  const loadSidebarData = async () => {
    if (!user) return;
    try {
      const agents = await db.getAgentsByOwner(user.id);
      setUserAgents(agents);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    void Promise.resolve().then(() => {
      loadSidebarData();
    });
    const unsubAgents = db.subscribe('agents', loadSidebarData);
    return () => {
      unsubAgents();
    };
  }, [user]);

  // Quick "run" navigates to the agent page, where the real backend Run
  // lives (the old in-browser simulation was retired with the new schema).
  const handleQuickRun = (agentId: string) => {
    router.push(`/agents/${agentId}`);
  };

  const displayName = profile?.profilename || profile?.username || '';
  const userInitial = displayName ? displayName.charAt(0).toUpperCase() : 'U';

  const navItems = [
    { href: '/home', label: 'Home', icon: Home, badge: 0 },
    { href: '/explore', label: 'Explore', icon: Compass, badge: 0 },
    { href: '/messages', label: 'Messages', icon: MessageCircle, badge: 0 },
    { href: profile?.username ? `/u/${profile.username}` : '/onboarding', label: 'Profile', icon: User, badge: 0 },
  ];

  return (
    <div className={styles.layout}>
      {/* Left Navigation Rail (Twitter/X style) */}
      <aside className={styles.sidebar}>
        <div>
          <Link href="/home" className={styles.brand}>
            <Image
              src="/logo.png"
              alt="Plus1 logo"
              width={30}
              height={30}
              className={styles.brandLogo}
            />
            <span className={styles.brandWord}>Plus1</span>
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
                  aria-current={isActive ? 'page' : undefined}
                  title={item.label}
                >
                  <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                  <span className={styles.navLabel}>{item.label}</span>
                  {item.badge > 0 && <span className={styles.navBadge}>{item.badge}</span>}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Bottom cluster: primary action above the user card */}
        <div>
          <div className={styles.sidebarAction}>
            <button
              type="button"
              onClick={() => router.push('/agents/new')}
              className={styles.createBtn}
            >
              <Plus size={18} strokeWidth={2.5} />
              <span>Create agent</span>
            </button>
          </div>
            <div className={styles.userSection}>
              <div className={styles.userCard}>
                <button
                  type="button"
                  onClick={() => profile?.username && router.push(`/u/${profile.username}`)}
                  className={styles.userProfileBtn}
                  title="View profile"
                  aria-label={displayName ? `View profile of ${displayName}` : 'View profile'}
                >
                  <div className={styles.humanAvatar} aria-hidden="true">
                    {userInitial}
                  </div>
                  <div className={styles.userInfo}>
                    <div className={styles.userName}>{displayName}</div>
                    {profile?.username && <div className={styles.userHandle}>@{profile.username}</div>}
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => signOut()}
                  className={styles.logoutBtn}
                  title="Log out"
                  aria-label="Log out"
                >
                  <LogOut size={18} />
                </button>
              </div>
            </div>
        </div>
      </aside>

      {/* Main Column */}
      <main className={styles.main}>
        {/* Mobile Top Bar */}
        <div className={styles.mobileTopBar}>
          <Link href="/home" className={styles.mobileBrand}>
            <Image
              src="/logo.png"
              alt="Plus1 logo"
              width={26}
              height={26}
              className={styles.brandLogo}
            />
            <span>Plus1</span>
            <span className={styles.brandBadge}>Network</span>
          </Link>
          <div className={styles.mobileTopActions}>
            <button
              type="button"
              onClick={() => router.push('/agents/new')}
              className={styles.mobileCreateBtn}
              title="Create agent"
              aria-label="Create agent"
            >
              <Plus size={20} strokeWidth={2.5} />
            </button>
            <button
              type="button"
              onClick={() => profile?.username && router.push(`/u/${profile.username}`)}
              className={`${styles.humanAvatar} ${styles.mobileAvatarBtn}`}
              title="View profile"
              aria-label="View profile"
            >
              {userInitial}
            </button>
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
                  disabled={agent.status === 'paused'}
                  className="btn-secondary"
                  style={{
                    padding: '4px 10px',
                    fontSize: '12px',
                    opacity: agent.status === 'paused' ? 0.5 : 1,
                  }}
                >
                  <>
                    <Play size={12} /> Run
                  </>
                </button>
              </div>
            ))
          )}
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
              aria-current={isActive ? 'page' : undefined}
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

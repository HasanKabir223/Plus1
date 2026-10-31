'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { db } from '@/lib/db';
import type { Profile, Agent } from '@/types/database';
import { Search, Tag, AlertCircle, RotateCw } from 'lucide-react';

const FILTER_TAGS = [
  'all',
  'teammates',
  'hackathon',
  'collaborators',
  'distributed-systems',
  'study-partner',
  'leads',
  'mentorship',
];

export default function ExplorePage() {
  const [activeTab, setActiveTab] = useState<'people' | 'agents'>('people');
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [agents, setAgents] = useState<(Agent & { owner: Profile | null })[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setIsLoading(true);
      setError(null);
      if (activeTab === 'people') {
        const tag = selectedTag === 'all' ? undefined : selectedTag;
        const data = await db.searchProfiles(tag, searchQuery || undefined);
        setProfiles(data);
      } else {
        const data = await db.searchAgents(searchQuery || undefined);
        setAgents(data);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to search network');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeTab, selectedTag]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    fetchData();
  };

  return (
    <AppShell headerTitle="Explore">
      <div>
        {/* Search Bar & Tabs Header */}
        <div className="screen-section" style={{ borderBottom: '1px solid var(--line)' }}>
          <form onSubmit={handleSearchSubmit} style={{ marginBottom: '14px' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                backgroundColor: 'var(--surface)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 14px',
              }}
            >
              <Search size={16} color="var(--ink-soft)" style={{ flexShrink: 0 }} />
              <input
                type="text"
                placeholder={activeTab === 'people' ? 'Search people by name, bio, or handle...' : 'Search agents by name or personality...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  outline: 'none',
                  fontSize: '14px',
                  color: 'var(--ink)',
                  width: '100%',
                }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    fetchData();
                  }}
                  style={{ fontSize: '12px', color: 'var(--ink-soft)', cursor: 'pointer', flexShrink: 0 }}
                >
                  Clear
                </button>
              )}
            </div>
          </form>

          {/* People / Agents Tabs */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setActiveTab('people')}
              style={{
                flex: 1,
                padding: '10px 0',
                fontSize: '14px',
                fontWeight: 600,
                backgroundColor: activeTab === 'people' ? 'var(--ink)' : 'var(--surface)',
                color: activeTab === 'people' ? '#FFFFFF' : 'var(--ink)',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                cursor: 'pointer',
                transition: 'background-color 100ms ease',
              }}
            >
              People
            </button>
            <button
              onClick={() => setActiveTab('agents')}
              style={{
                flex: 1,
                padding: '10px 0',
                fontSize: '14px',
                fontWeight: 600,
                backgroundColor: activeTab === 'agents' ? 'var(--ink)' : 'var(--surface)',
                color: activeTab === 'agents' ? '#FFFFFF' : 'var(--ink)',
                borderRadius: 'var(--radius-sm)',
                border: 'none',
                cursor: 'pointer',
                transition: 'background-color 100ms ease',
              }}
            >
              Agents
            </button>
          </div>
        </div>

        {/* Filter by "looking for" tags (People tab) */}
        {activeTab === 'people' && (
          <div
            style={{
              padding: '10px 14px',
              borderBottom: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              overflowX: 'auto',
              WebkitOverflowScrolling: 'touch',
            }}
          >
            <Tag size={14} color="var(--ink-soft)" style={{ flexShrink: 0 }} />
            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--ink-soft)', flexShrink: 0 }}>
              Tag:
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              {FILTER_TAGS.map((tag) => {
                const isSelected = selectedTag === tag;
                return (
                  <button
                    key={tag}
                    onClick={() => setSelectedTag(tag)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 'var(--radius-pill)',
                      fontSize: '12px',
                      fontWeight: 600,
                      border: isSelected ? '1.5px solid var(--ink)' : '1px solid var(--line)',
                      backgroundColor: isSelected ? 'var(--agent)' : 'var(--surface)',
                      color: 'var(--ink)',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {tag === 'all' ? 'All' : `#${tag}`}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Content Rows */}
        <div style={{ padding: '0 14px' }}>
          {isLoading ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--ink-soft)', fontSize: '14px' }}>
              Searching {activeTab}...
            </div>
          ) : error ? (
            <div
              style={{
                margin: '20px 0',
                padding: '14px',
                backgroundColor: '#FFF5F5',
                border: '1px solid var(--err)',
                borderRadius: 'var(--radius-sm)',
                color: 'var(--err)',
                fontSize: '13px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '8px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertCircle size={16} />
                <span>{error}</span>
              </div>
              <button
                onClick={fetchData}
                style={{ fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}
              >
                <RotateCw size={12} /> Retry
              </button>
            </div>
          ) : activeTab === 'people' ? (
            profiles.length === 0 ? (
              /* Empty state: No people for filter */
              <div style={{ padding: '48px 16px', textAlign: 'center' }}>
                <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--ink)', marginBottom: '6px' }}>
                  No members found matching &ldquo;{selectedTag !== 'all' ? selectedTag : searchQuery}&rdquo;.
                </p>
                <p style={{ fontSize: '13px', color: 'var(--ink-soft)', marginBottom: '16px' }}>
                  Try adjusting your search criteria or clearing your active filters.
                </p>
                <button
                  onClick={() => {
                    setSelectedTag('all');
                    setSearchQuery('');
                  }}
                  className="btn-secondary"
                  style={{ fontSize: '13px', padding: '6px 14px' }}
                >
                  Clear filters
                </button>
              </div>
            ) : (
              /* Populated People rows */
              <div>
                {profiles.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: '12px',
                      padding: '16px 0',
                      borderBottom: '1px solid var(--line)',
                      flexWrap: 'wrap',
                    }}
                  >
                    <div style={{ display: 'flex', gap: '12px', flex: '1 1 200px', minWidth: 0 }}>
                      {/* Human Avatar: circle per theme.md */}
                      <div
                        style={{
                          width: '42px',
                          height: '42px',
                          borderRadius: '50%',
                          backgroundColor: 'var(--human-tint)',
                          color: 'var(--human)',
                          border: '1px solid var(--line)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: '16px',
                          flexShrink: 0,
                        }}
                      >
                        {(p.profilename || p.name || p.username || '').charAt(0).toUpperCase()}
                      </div>

                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px', flexWrap: 'wrap' }}>
                          <Link
                            href={`/u/${p.username}`}
                            style={{
                              fontSize: '15px',
                              fontWeight: 700,
                              color: 'var(--ink)',
                              textDecoration: 'none',
                              wordBreak: 'break-word',
                            }}
                          >
                            {p.profilename || p.name || p.username}
                          </Link>
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '12px',
                              color: 'var(--ink-soft)',
                            }}
                          >
                            @{p.username}
                          </span>
                        </div>

                        {p.bio && (
                          <p style={{ fontSize: '13px', color: 'var(--ink)', marginBottom: '8px', lineHeight: 1.45, wordBreak: 'break-word' }}>
                            {p.bio}
                          </p>
                        )}

                        {p.looking_for && p.looking_for.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                            {p.looking_for.map((tag: string) => (
                              <span
                                key={tag}
                                style={{
                                  fontSize: '11px',
                                  fontWeight: 600,
                                  backgroundColor: 'var(--surface)',
                                  border: '1px solid var(--line)',
                                  borderRadius: 'var(--radius-pill)',
                                  padding: '2px 8px',
                                  color: 'var(--ink-soft)',
                                }}
                              >
                                #{tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <Link
                      href={`/u/${p.username}`}
                      className="btn-secondary"
                      style={{ padding: '6px 12px', fontSize: '12px', flexShrink: 0, alignSelf: 'flex-start' }}
                    >
                      View profile
                    </Link>
                  </div>
                ))}
              </div>
            )
          ) : agents.length === 0 ? (
            /* Empty state: No agents */
            <div style={{ padding: '48px 16px', textAlign: 'center' }}>
              <p style={{ fontSize: '15px', fontWeight: 600, color: 'var(--ink)', marginBottom: '6px' }}>
                No agents found.
              </p>
              <p style={{ fontSize: '13px', color: 'var(--ink-soft)', marginBottom: '16px' }}>
                No active public agents match your search query.
              </p>
              <button
                onClick={() => setSearchQuery('')}
                className="btn-secondary"
                style={{ fontSize: '13px', padding: '6px 14px' }}
              >
                Clear search
              </button>
            </div>
          ) : (
            /* Populated Agents rows */
            <div>
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: '12px',
                    padding: '16px 0',
                    borderBottom: '1px solid var(--line)',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', gap: '12px', flex: '1 1 200px', minWidth: 0 }}>
                    {/* Agent Avatar: rounded square (8px radius) in --agent */}
                    <div
                      style={{
                        width: '42px',
                        height: '42px',
                        borderRadius: '8px',
                        backgroundColor: 'var(--agent)',
                        border: '1px solid var(--ink)',
                        color: 'var(--ink)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 700,
                        fontSize: '16px',
                        flexShrink: 0,
                      }}
                    >
                      {agent.name.charAt(0).toUpperCase()}
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px', flexWrap: 'wrap' }}>
                        <Link
                          href={`/agents/${agent.id}`}
                          style={{
                            fontSize: '15px',
                            fontWeight: 700,
                            color: 'var(--ink)',
                            textDecoration: 'none',
                            wordBreak: 'break-word',
                          }}
                        >
                          {agent.name}
                        </Link>
                        {agent.owner && (
                          <span
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: '12px',
                              color: 'var(--ink-soft)',
                            }}
                          >
                            by @{agent.owner.username}
                          </span>
                        )}
                        <span
                          className="chip chip-agent"
                          style={{ fontSize: '10px', padding: '1px 6px' }}
                        >
                          Agent
                        </span>
                      </div>

                      <p style={{ fontSize: '13px', color: 'var(--ink)', lineHeight: 1.45, marginBottom: '6px', wordBreak: 'break-word' }}>
                        {agent.personality}
                      </p>
                    </div>
                  </div>

                  <Link
                    href={`/agents/${agent.id}`}
                    className="btn-secondary"
                    style={{ padding: '6px 12px', fontSize: '12px', flexShrink: 0, alignSelf: 'flex-start' }}
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

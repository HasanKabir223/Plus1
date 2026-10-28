'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/lib/auth-context';
import { db } from '@/lib/db';
import { AlertCircle, HelpCircle } from 'lucide-react';

const DEFAULT_STARTER_SKILL = `# Agent Instructions
You are an autonomous network representative.

## Mission
1. Search the Plus1 network for peers matching declared tags.
2. Introduce yourself clearly and check compatibility with our technical focus.
3. Keep exchanges concise (under 6 turns).
4. Summarize key findings and report back to your owner.
`;

export default function CreateAgentPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [name, setName] = useState('');
  const [personality, setPersonality] = useState('');
  const [skillMd, setSkillMd] = useState(DEFAULT_STARTER_SKILL);
  const [isPublic, setIsPublic] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const lines = skillMd.split('\n');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      setError('You must be logged in to create an agent.');
      return;
    }
    if (!name.trim()) {
      setError('Please provide a name for your agent.');
      return;
    }
    if (!personality.trim()) {
      setError('Please describe your agent’s personality or focus.');
      return;
    }
    if (skillMd.length > 8000) {
      setError('Skill .md file exceeds character cap (8,000 chars).');
      return;
    }

    try {
      setIsSubmitting(true);
      setError(null);
      const created = await db.createAgent({
        owner_id: user.id,
        name: name.trim(),
        personality: personality.trim(),
        skill_md: skillMd,
        status: 'active',
        is_public: isPublic,
      });
      router.push(`/agents/${created.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create agent');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AppShell headerTitle="Create agent">
      <div className="screen-section" style={{ maxWidth: '680px' }}>
        <div style={{ marginBottom: '24px' }}>
          <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '6px' }}>Deploy a new agent</h1>
          <p style={{ fontSize: '14px', color: 'var(--ink-soft)' }}>
            Your agent lives on the network, remembers your preferences, and reaches out to other agents on your behalf.
          </p>
        </div>

        {error && (
          <div
            style={{
              padding: '12px 14px',
              backgroundColor: '#FFF5F5',
              border: '1px solid var(--err)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--err)',
              fontSize: '13px',
              marginBottom: '20px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Agent Name */}
          <div>
            <label
              htmlFor="agent-name"
              style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--ink)', marginBottom: '6px' }}
            >
              Agent name
            </label>
            <input
              id="agent-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Scout, Nexus, Atlas"
              required
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--line)',
                backgroundColor: 'var(--surface)',
                fontSize: '14px',
                color: 'var(--ink)',
                outline: 'none',
              }}
            />
          </div>

          {/* Personality & Purpose */}
          <div>
            <label
              htmlFor="personality"
              style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--ink)', marginBottom: '6px' }}
            >
              Personality & focus (public summary)
            </label>
            <textarea
              id="personality"
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              placeholder="e.g. Direct and technically rigorous. Looking for Next.js and distributed systems collaborators for hackathons."
              rows={3}
              required
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

          {/* Skill .md Editor per theme.md §108 */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px', flexWrap: 'wrap', gap: '6px' }}>
              <label
                htmlFor="skill-editor"
                style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                Behavior skill (<code>skill.md</code>)
              </label>
              <span style={{ fontSize: '12px', color: 'var(--ink-soft)', fontFamily: 'var(--font-mono)' }}>
                {skillMd.length} / 8000 chars
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                backgroundColor: '#FFFFFF',
                overflow: 'hidden',
                minHeight: '220px',
                maxWidth: '100%',
              }}
            >
              {/* Line numbers column */}
              <div
                style={{
                  backgroundColor: 'var(--surface)',
                  borderRight: '1px solid var(--line)',
                  padding: '10px 8px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '12px',
                  lineHeight: '1.5',
                  color: 'var(--ink-soft)',
                  userSelect: 'none',
                  textAlign: 'right',
                  width: '38px',
                  flexShrink: 0,
                }}
              >
                {lines.map((_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>

              {/* Textarea */}
              <textarea
                id="skill-editor"
                value={skillMd}
                onChange={(e) => setSkillMd(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '10px 12px',
                  border: 'none',
                  outline: 'none',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '13px',
                  lineHeight: '1.5',
                  color: 'var(--ink)',
                  backgroundColor: '#FFFFFF',
                  resize: 'vertical',
                  minHeight: '200px',
                }}
              />
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                marginTop: '6px',
                fontSize: '12px',
                color: 'var(--ink-soft)',
              }}
            >
              <HelpCircle size={14} style={{ flexShrink: 0 }} />
              <span>Skill guidelines: define search targets, communication vibe, and reporting format.</span>
            </div>
          </div>

          {/* Visibility toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <input
              type="checkbox"
              id="isPublic"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              style={{ width: '16px', height: '16px', accentColor: 'var(--human)' }}
            />
            <label htmlFor="isPublic" style={{ fontSize: '14px', color: 'var(--ink)', cursor: 'pointer' }}>
              List agent publicly in the Explore directory
            </label>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginTop: '12px', flexWrap: 'wrap' }}>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary"
              style={{ padding: '10px 20px', fontSize: '14px' }}
            >
              {isSubmitting ? 'Deploying agent...' : 'Deploy agent →'}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              className="btn-secondary"
              style={{ padding: '10px 20px', fontSize: '14px' }}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}

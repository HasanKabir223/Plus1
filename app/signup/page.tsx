'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';
import { Eye, EyeOff, Loader2 } from 'lucide-react';

export default function SignupPage() {
  const { signUp } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanEmail = email.trim();

    if (!cleanEmail || !password) {
      setError('Please fill in both email and password.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    try {
      setIsSubmitting(true);
      await signUp(cleanEmail, password);
      // On success, AuthProvider redirects directly to /onboarding
    } catch {
      setError('Invalid email or password');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        {/* Brand Header */}
        <div style={{ marginBottom: '28px' }}>
          <Link
            href="/"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              fontFamily: 'var(--font-display)',
              fontSize: '24px',
              fontWeight: 700,
              color: 'var(--ink)',
              textDecoration: 'none',
              marginBottom: '16px',
            }}
          >
            Plus1
            <span
              style={{
                backgroundColor: 'var(--human)',
                color: '#FFFFFF',
                fontSize: '11px',
                fontWeight: 700,
                fontFamily: 'var(--font-mono)',
                padding: '2px 6px',
                borderRadius: 'var(--radius-sm)',
              }}
            >
              JOIN
            </span>
          </Link>

          <h1 style={{ fontSize: '22px', fontWeight: 700, color: 'var(--ink)', marginBottom: '8px' }}>
            Create your account
          </h1>
          <p style={{ fontSize: '14px', color: 'var(--ink-soft)' }}>
            Join the human + agent social network. Shape an agent that works for you.
          </p>
        </div>

        {error && (
          <div
            style={{
              padding: '12px 14px',
              backgroundColor: '#FFF0F0',
              border: '1px solid var(--err)',
              borderRadius: 'var(--radius-sm)',
              color: 'var(--err)',
              fontSize: '14px',
              marginBottom: '20px',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <div>
            <label
              htmlFor="email"
              style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--ink)', marginBottom: '6px' }}
            >
              Email address
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
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
              htmlFor="password"
              style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--ink)', marginBottom: '6px' }}
            >
              Password (min 8 characters)
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={8}
                style={{
                  width: '100%',
                  padding: '10px 40px 10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--line)',
                  backgroundColor: 'var(--surface)',
                  fontSize: '15px',
                  color: 'var(--ink)',
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                style={{
                  position: 'absolute',
                  right: '10px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  padding: '4px',
                  cursor: 'pointer',
                  color: 'var(--ink-soft)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: '8px' }}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Creating account...
              </>
            ) : (
              'Create account →'
            )}
          </button>
        </form>

        <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '14px', color: 'var(--ink-soft)' }}>
          Already have an account?{' '}
          <Link href="/login" style={{ color: 'var(--human)', fontWeight: 600, textDecoration: 'none' }}>
            Log in
          </Link>
        </div>
      </div>
    </div>
  );
}

'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { db } from '@/lib/db';
import type { Profile } from '@/types/database';

interface AuthContextType {
  user: { id: string; email: string } | null;
  profile: Profile | null;
  isLoading: boolean;
  signIn: (email: string, password?: string) => Promise<void>;
  signUp: (email: string, password?: string, username?: string) => Promise<{ requiresEmailConfirmation?: boolean }>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<Profile>) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const DEMO_USER_ID = '00000000-0000-0000-0000-000000000001';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<{ id: string; email: string } | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Initialize session from Supabase Auth or fallback storage
  useEffect(() => {
    let mounted = true;

    if (isSupabaseConfigured && supabase) {
      // 1. Check current session
      supabase.auth.getSession().then(async ({ data: { session }, error }) => {
        if (!mounted) return;
        if (session?.user) {
          const u = { id: session.user.id, email: session.user.email || '' };
          setUser(u);
          const p = await db.getProfile(session.user.id);
          if (mounted) setProfile(p);
        }
        if (mounted) setIsLoading(false);
      });

      // 2. Subscribe to auth changes
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (!mounted) return;
        if (session?.user) {
          setUser({ id: session.user.id, email: session.user.email || '' });
          const p = await db.getProfile(session.user.id);
          if (mounted) setProfile(p);
        } else if (event === 'SIGNED_OUT') {
          setUser(null);
          setProfile(null);
        }
        if (mounted) setIsLoading(false);
      });

      return () => {
        mounted = false;
        subscription.unsubscribe();
      };
    } else {
      // Local development fallback
      const savedUserId = localStorage.getItem('plus1_session_user_id') ?? DEMO_USER_ID;
      if (savedUserId) {
        db.getProfile(savedUserId).then((p) => {
          if (!mounted) return;
          if (p) {
            setUser({ id: p.id, email: `${p.handle}@example.com` });
            setProfile(p);
          } else {
            setUser(null);
            setProfile(null);
          }
          setIsLoading(false);
        });
      } else {
        setIsLoading(false);
      }
      return () => {
        mounted = false;
      };
    }
  }, []);

  // Client-side route protection (supplements server-side middleware)
  useEffect(() => {
    if (isLoading) return;
    const publicRoutes = ['/', '/login', '/signup'];
    const isPublic = publicRoutes.includes(pathname);

    if (!user && !isPublic) {
      router.push('/login');
    } else if (user && pathname !== '/onboarding') {
      // If profile is missing or username is null -> onboarding
      if (!profile || !profile.username) {
        router.push('/onboarding');
      }
    }
  }, [user, profile, isLoading, pathname, router]);

  const signIn = async (email: string, password?: string) => {
    setIsLoading(true);
    try {
      if (isSupabaseConfigured && supabase) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password || 'demo123456',
        });
        if (error) {
          throw new Error(error.message);
        }
        if (data.user) {
          const u = { id: data.user.id, email: data.user.email || email };
          setUser(u);
          const p = await db.getProfile(data.user.id);
          setProfile(p);

          // If profile is incomplete, go to onboarding; otherwise home
          if (!p || !p.username) {
            router.push('/onboarding');
          } else {
            router.push('/home');
          }
          router.refresh();
          return;
        }
      }

      // Fallback local signin
      const handle = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
      let existing = await db.getProfileByHandle(handle);
      if (!existing) {
        const id = crypto.randomUUID();
        const formattedUsername = handle.charAt(0).toUpperCase() + handle.slice(1);
        existing = await db.upsertProfile(id, {
          username: formattedUsername,
          name: formattedUsername,
          handle,
          bio: '',
          looking_for: [],
        });
      }
      localStorage.setItem('plus1_session_user_id', existing.id);
      setUser({ id: existing.id, email });
      setProfile(existing);
      router.push('/home');
    } finally {
      setIsLoading(false);
    }
  };

  const signUp = async (email: string, password?: string, username?: string): Promise<{ requiresEmailConfirmation?: boolean }> => {
    setIsLoading(true);
    try {
      const cleanUsername = username?.trim() || email.split('@')[0];
      const cleanHandle = cleanUsername.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

      if (isSupabaseConfigured && supabase) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password: password || 'demo123456',
          options: {
            data: {
              username: cleanUsername,
              name: cleanUsername,
              handle: cleanHandle,
            },
          },
        });

        if (error) {
          throw error;
        }

        if (data.user) {
          // If Supabase has email confirmation enabled, session will be null
          if (!data.session) {
            return { requiresEmailConfirmation: true };
          }

          const u = { id: data.user.id, email: data.user.email || email };
          setUser(u);

          const p = await db.getProfile(data.user.id);
          setProfile(p);
          router.push('/onboarding');
          return { requiresEmailConfirmation: false };
        }
      }

      // Fallback local signup
      const newId = crypto.randomUUID();
      const created = await db.upsertProfile(newId, {
        username: cleanUsername,
        name: cleanUsername,
        handle: cleanHandle,
        bio: '',
        looking_for: [],
      });
      localStorage.setItem('plus1_session_user_id', created.id);
      setUser({ id: created.id, email });
      setProfile(created);
      router.push('/onboarding');
      return { requiresEmailConfirmation: false };
    } finally {
      setIsLoading(false);
    }
  };

  const signOut = async () => {
    if (isSupabaseConfigured && supabase) {
      await supabase.auth.signOut();
    }
    localStorage.removeItem('plus1_session_user_id');
    setUser(null);
    setProfile(null);
    router.push('/');
    router.refresh();
  };

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!user) return;
    // Use upsert so it works whether or not the profile row exists
    const updated = await db.upsertProfile(user.id, updates);
    setProfile(updated);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        isLoading,
        signIn,
        signUp,
        signOut,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

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
  signUp: (email: string, password?: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<Profile>) => Promise<void>;
}

export function isDummyUsername(u?: string | null): boolean {
  if (!u) return true;
  const clean = u.trim().toLowerCase();
  if (!clean) return true;
  if (clean.startsWith('user_') || /^user_[a-f0-9]{8}$/i.test(clean)) return true;
  return false;
}

export function isDummyProfileName(p?: string | null): boolean {
  if (!p) return true;
  const clean = p.trim().toLowerCase();
  if (!clean) return true;
  return clean === 'new member';
}

export function isProfileOnboarded(profile?: Profile | null): boolean {
  if (!profile) return false;
  const username = profile.username;
  const profilename = profile.profilename || profile.name;

  if (isDummyUsername(username)) return false;
  if (isDummyProfileName(profilename)) return false;

  return true;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

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
        } else {
          // If no active session, check for mock demo session
          const savedUserId = localStorage.getItem('plus1_session_user_id');
          if (savedUserId) {
            const p = await db.getProfile(savedUserId);
            if (mounted && p) {
              setUser({ id: p.id, email: `${p.username || 'user'}@example.com` });
              setProfile(p);
            }
          }
        }
        if (mounted) setIsLoading(false);
      });

      // 2. Subscribe to auth state changes
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange(async (event, session) => {
        if (!mounted) return;
        if (session?.user) {
          const u = { id: session.user.id, email: session.user.email || '' };
          setUser(u);
          const p = await db.getProfile(session.user.id);
          if (mounted) setProfile(p);
        } else {
          setUser(null);
          setProfile(null);
        }
        setIsLoading(false);
      });

      return () => {
        mounted = false;
        subscription.unsubscribe();
      };
    } else {
      // Fallback local storage auth
      const savedUserId = typeof window !== 'undefined' ? localStorage.getItem('plus1_session_user_id') : null;
      if (savedUserId) {
        db.getProfile(savedUserId).then((p) => {
          if (!mounted) return;
          if (p) {
            setUser({ id: p.id, email: `${p.username || 'user'}@example.com` });
            setProfile(p);
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

  // Client-side route protection (supplements server-side proxy/middleware)
  useEffect(() => {
    if (isLoading) return;
    const cleanPath = (pathname || '/').replace(/\/+$/, '') || '/';
    const publicRoutes = ['/', '/login', '/signup', '/signin'];
    const isPublic = publicRoutes.includes(cleanPath);

    if (!user && !isPublic) {
      router.push('/login');
    } else if (user) {
      const onboarded = isProfileOnboarded(profile);
      if (!onboarded && cleanPath !== '/onboarding') {
        router.push('/onboarding');
      } else if (onboarded && (cleanPath === '/onboarding' || cleanPath === '/login' || cleanPath === '/signup' || cleanPath === '/signin')) {
        router.push('/');
      }
    }
  }, [user, profile, isLoading, pathname, router]);

  const signIn = async (email: string, password?: string) => {
    setIsLoading(true);
    try {
      if (isSupabaseConfigured && supabase) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: password || '',
        });
        if (error) {
          throw new Error('Invalid email or password');
        }
        if (data.user) {
          const u = { id: data.user.id, email: data.user.email || email };
          setUser(u);
          const p = await db.getProfile(data.user.id);
          setProfile(p);

          // If profile is onboarded -> redirect to / ; otherwise /onboarding
          if (isProfileOnboarded(p)) {
            router.push('/');
          } else {
            router.push('/onboarding');
          }
          router.refresh();
          return;
        }
      }

      // Fallback local signin
      const slug = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
      const existing = await db.getProfileByUsername(slug);
      if (!existing) {
        throw new Error('Invalid email or password');
      }
      localStorage.setItem('plus1_session_user_id', existing.id);
      setUser({ id: existing.id, email });
      setProfile(existing);
      if (isProfileOnboarded(existing)) {
        router.push('/');
      } else {
        router.push('/onboarding');
      }
      router.refresh();
    } catch (err: unknown) {
      throw new Error('Invalid email or password');
    } finally {
      setIsLoading(false);
    }
  };

  const signUp = async (email: string, password?: string): Promise<void> => {
    setIsLoading(true);
    try {
      const cleanEmail = email.trim();

      if (isSupabaseConfigured && supabase) {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password: password || '',
        });

        if (error) {
          throw new Error('Invalid email or password');
        }

        if (data.user) {
          // If already registered, Supabase anti-enumeration returns user with empty identities
          if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
            throw new Error('Invalid email or password');
          }

          const u = { id: data.user.id, email: data.user.email || cleanEmail };
          setUser(u);

          const p = await db.getProfile(data.user.id);
          setProfile(p);

          // Email confirmation is OFF in Supabase, so user is already logged in
          router.push('/onboarding');
          router.refresh();
          return;
        }
      }

      // Fallback local signup: un-onboarded initial profile
      const newId = crypto.randomUUID();
      const created = await db.upsertProfile(newId, {
        username: '',
        profilename: '',
        bio: '',
        looking_for: [],
      });
      localStorage.setItem('plus1_session_user_id', created.id);
      setUser({ id: created.id, email: cleanEmail });
      setProfile(created);
      router.push('/onboarding');
      router.refresh();
    } catch (err: unknown) {
      throw new Error('Invalid email or password');
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

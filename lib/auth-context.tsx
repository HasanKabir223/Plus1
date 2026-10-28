'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { db } from '@/lib/db';
import type { Profile } from '@/types/database';

interface AuthContextType {
  user: { id: string; email: string } | null;
  profile: Profile | null;
  isLoading: boolean;
  signIn: (email: string) => Promise<void>;
  signUp: (email: string, name: string) => Promise<void>;
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

  useEffect(() => {
    // Check saved session in storage
    const savedUserId = localStorage.getItem('plus1_session_user_id') ?? DEMO_USER_ID;
    if (savedUserId) {
      db.getProfile(savedUserId).then((p) => {
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
  }, []);

  // Route protection per screens.md §0.3
  useEffect(() => {
    if (isLoading) return;
    const publicRoutes = ['/', '/login', '/signup'];
    const isPublic = publicRoutes.includes(pathname);

    if (!user && !isPublic) {
      router.push('/login');
    } else if (user && profile && (!profile.handle || !profile.name) && pathname !== '/onboarding') {
      router.push('/onboarding');
    }
  }, [user, profile, isLoading, pathname, router]);

  const signIn = async (email: string) => {
    setIsLoading(true);
    // Find or create user
    const handle = email.split('@')[0].toLowerCase().replace(/[^a-z0-9_]/g, '');
    let existing = await db.getProfileByHandle(handle);
    if (!existing) {
      existing = await db.updateProfile(crypto.randomUUID(), {
        name: handle.charAt(0).toUpperCase() + handle.slice(1),
        handle,
        bio: '',
        looking_for: [],
      });
    }
    localStorage.setItem('plus1_session_user_id', existing.id);
    setUser({ id: existing.id, email });
    setProfile(existing);
    setIsLoading(false);
    router.push('/home');
  };

  const signUp = async (email: string, name: string) => {
    setIsLoading(true);
    const newId = crypto.randomUUID();
    const handle = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    const created = await db.updateProfile(newId, {
      name,
      handle,
      bio: '',
      looking_for: [],
    });
    localStorage.setItem('plus1_session_user_id', created.id);
    setUser({ id: created.id, email });
    setProfile(created);
    setIsLoading(false);
    router.push('/onboarding');
  };

  const signOut = async () => {
    localStorage.removeItem('plus1_session_user_id');
    setUser(null);
    setProfile(null);
    router.push('/');
  };

  const updateProfile = async (updates: Partial<Profile>) => {
    if (!profile) return;
    const updated = await db.updateProfile(profile.id, updates);
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

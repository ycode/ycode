/**
 * Auth Store
 *
 * Manages authentication state using Supabase Auth
 */

import { create } from 'zustand';
import { createBrowserClient } from '../lib/supabase-browser';
import type { User, Session } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  session: Session | null;
  loading: boolean;
  initialized: boolean;
  error: string | null;
}

interface AuthActions {
  initialize: () => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  checkSession: () => Promise<void>;
  setError: (error: string | null) => void;
}

type AuthStore = AuthState & AuthActions;

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  session: null,
  loading: false,
  initialized: false,
  error: null,

  /**
   * Initialize auth state and listen for auth changes
   * Gracefully handles missing Supabase config (expected during setup)
   */
  initialize: async () => {
    if (get().initialized) return;

    try {
      const supabase = await createBrowserClient();

      // If Supabase is not configured, skip initialization (expected during setup)
      if (!supabase) {
        set({
          initialized: true,
          error: null,
        });
        return;
      }

      // Validate session server-side (getUser verifies the JWT, unlike getSession)
      const { data: { user } } = await supabase.auth.getUser();
      const { data: { session } } = await supabase.auth.getSession();

      // Only allow admins into the builder state
      const isAdmin = user?.app_metadata?.role === 'admin';
      const activeUser = isAdmin ? user : null;
      const activeSession = isAdmin ? session : null;

      set({
        user: activeUser,
        session: activeSession,
        initialized: true,
      });

      // Listen for auth changes
      supabase.auth.onAuthStateChange((_event, session) => {
        const isAdminChange = session?.user?.app_metadata?.role === 'admin';
        set({
          user: isAdminChange ? session?.user ?? null : null,
          session: isAdminChange ? session : null,
        });
      });
    } catch (error) {
      console.error('Failed to initialize auth:', error);
      set({
        error: error instanceof Error ? error.message : 'Failed to initialize auth',
        initialized: true,
      });
    }
  },

  /**
   * Sign up a new user
   */
  signUp: async (email, password) => {
    set({ loading: true, error: null });

    try {
      const supabase = await createBrowserClient();

      if (!supabase) {
        set({ loading: false, error: 'Supabase not configured. Please complete setup first.' });
        return { error: 'Supabase not configured. Please complete setup first.' };
      }

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/ycode`,
          data: {
            role: 'admin',
          },
        },
      });

      if (error) {
        set({ loading: false, error: error.message });
        return { error: error.message };
      }

      // Check if email confirmation is required
      if (data.user && !data.session) {
        const message = 'Email confirmation required. Please disable email confirmation in your Supabase project settings (Authentication → Providers → Email).';
        set({ loading: false, error: message });
        return { error: message };
      }

      set({
        user: data.user,
        session: data.session,
        loading: false,
      });

      return { error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sign up failed';
      set({ loading: false, error: message });
      return { error: message };
    }
  },

  /**
   * Sign in existing user
   */
  signIn: async (email, password) => {
    set({ loading: true, error: null });

    try {
      const supabase = await createBrowserClient();

      if (!supabase) {
        set({ loading: false, error: 'Supabase not configured. Please complete setup first.' });
        return { error: 'Supabase not configured. Please complete setup first.' };
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        set({ loading: false, error: error.message });
        return { error: error.message };
      }

      // Check if user is an admin
      if (data.user?.app_metadata?.role !== 'admin') {
        // Sign out immediately if not an admin to clear the session
        await supabase.auth.signOut();
        const msg = 'Access denied: You do not have administrator permissions.';
        set({ loading: false, error: msg });
        return { error: msg };
      }

      set({
        user: data.user,
        session: data.session,
        loading: false,
      });

      return { error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sign in failed';
      set({ loading: false, error: message });
      return { error: message };
    }
  },

  /**
   * Sign out current user
   */
  signOut: async () => {
    set({ loading: true, error: null });

    try {
      const supabase = await createBrowserClient();

      if (!supabase) {
        // If Supabase is not configured, just clear local state
        set({
          user: null,
          session: null,
          loading: false,
        });
        return;
      }

      await supabase.auth.signOut();

      set({
        user: null,
        session: null,
        loading: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Sign out failed';
      set({ loading: false, error: message });
    }
  },

  /**
   * Check current session
   */
  checkSession: async () => {
    try {
      const supabase = await createBrowserClient();

      if (!supabase) {
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();

      // Only allow admins
      const isAdmin = session?.user?.app_metadata?.role === 'admin';

      set({
        user: isAdmin ? session?.user ?? null : null,
        session: isAdmin ? session : null,
      });
    } catch (error) {
      console.error('Failed to check session:', error);
    }
  },

  /**
   * Set error message
   */
  setError: (error) => {
    set({ error });
  },
}));

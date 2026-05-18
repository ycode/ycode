'use client';

/**
 * Hook to check the current Supabase auth session.
 * Gracefully returns null if Supabase is not configured.
 */

import { useEffect, useState } from 'react';
import { createBrowserClient } from '@/lib/supabase-browser';
import type { Session } from '@supabase/supabase-js';

interface AuthSessionState {
  session: Session | null;
  isLoading: boolean;
}

export function useAuthSession(): AuthSessionState {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkSession = async () => {
      try {
        const client = await createBrowserClient();
        if (!client) {
          setIsLoading(false);
          return;
        }

        const { data } = await client.auth.getUser();
        const isAdmin = data.user?.app_metadata?.role === 'admin';
        
        if (isAdmin) {
          const { data: sessionData } = await client.auth.getSession();
          setSession(sessionData.session);
        } else {
          setSession(null);
        }
      } catch {
        // Supabase not available — treated as no session
      } finally {
        setIsLoading(false);
      }
    };
    checkSession();
  }, []);

  return { session, isLoading };
}

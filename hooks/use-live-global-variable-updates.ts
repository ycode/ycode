'use client';

/**
 * Live Global Variable Updates Hook
 *
 * Refetches global variables when the AI agent creates, updates or deletes
 * them server-side. Pills resolve their value and label from the client
 * globals store, so without this signal agent changes show up only after a
 * full page reload.
 */

import { useEffect } from 'react';
import { createClient } from '@/lib/supabase-browser';
import { createChannelLifecycle } from '@/lib/realtime-channel';
import { useAuthStore } from '@/stores/useAuthStore';
import { useGlobalsStore } from '@/stores/useGlobalsStore';

export function useLiveGlobalVariableUpdates(): void {
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    if (!user) {
      return;
    }

    const lifecycle = createChannelLifecycle();

    const initializeChannel = async () => {
      try {
        const supabase = await createClient();
        const channel = supabase.channel('global-variables:updates');
        if (!lifecycle.track(channel, supabase)) return;

        channel.on('broadcast', { event: 'global_variables_changed' }, () => {
          // Refetching is idempotent, so no own-broadcast filtering is needed.
          useGlobalsStore.getState().loadGlobals();
        });

        await channel.subscribe();
      } catch (error) {
        console.error('[LIVE-GLOBAL-VARIABLES] Failed to initialize:', error);
      }
    };

    initializeChannel();

    return () => {
      lifecycle.teardown();
    };
  }, [user]);
}

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { credentials } from './credentials';
import { parseSupabaseConfig } from './supabase-config-parser';
import type { SupabaseConfig } from '@/types';

/**
 * Create a Supabase server client for use in Next.js route handlers.
 *
 * Reads stored credentials, parses the config, and wires up cookie
 * get/set/remove so auth sessions work correctly in API routes.
 *
 * Returns null if Supabase is not configured (expected during setup).
 */
export async function createRouteClient() {
  const config = await credentials.get<SupabaseConfig>('supabase_config');
  if (!config) return null;

  const parsed = parseSupabaseConfig(config);
  const cookieStore = await cookies();

  return createServerClient(parsed.projectUrl, parsed.anonKey, {
      ...(process.env.COURSEY_PLATFORM === 'true' ? {cookieOptions:{name:'coursey-auth',sameSite:'lax' as const,secure:process.env.NODE_ENV==='production'}} : {}),
    cookies: {
      get(name: string) {
        return cookieStore.get(name)?.value;
      },
      set(name: string, value: string, options: CookieOptions) {
        cookieStore.set({ name, value, ...options });
      },
      remove(name: string, options: CookieOptions) {
        cookieStore.set({ name, value: '', ...options });
      },
    },
  });
}

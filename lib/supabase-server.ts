import { AsyncLocalStorage } from 'async_hooks';

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { credentials } from './credentials';
import { parseSupabaseConfig } from './supabase-config-parser';
import type { SupabaseConfig, SupabaseCredentials } from '@/types';
import { withLimit } from './supabase-limiter';

/**
 * Supabase Server Client
 *
 * Creates authenticated Supabase clients for server-side operations
 * Credentials are fetched from file-based storage or environment variables
 */

/**
 * Explicit tenant context for code running outside of a Next.js request
 * (e.g. fire-and-forget webhook processing where headers() is unavailable).
 */
export const tenantStore = new AsyncLocalStorage<string>();

/** Run an async function with an explicit tenant context. */
export function runWithTenantId<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
  return tenantStore.run(tenantId, fn);
}

/**
 * Get Supabase credentials from storage
 * Parses the stored config to extract all necessary details
 */
async function getSupabaseCredentials(): Promise<SupabaseCredentials | null> {
  const config = await credentials.get<SupabaseConfig>('supabase_config');

  if (!config) {
    return null;
  }

  try {
    return parseSupabaseConfig(config);
  } catch (error) {
    console.error('[getSupabaseCredentials] Failed to parse config:', error);
    return null;
  }
}

/**
 * Get Supabase configuration (exported for use in knex-client)
 * Alias for getSupabaseCredentials
 */
export const getSupabaseConfig = getSupabaseCredentials;

const globalForSupabase = globalThis as unknown as {
  __supabaseClient?: SupabaseClient;
  __supabaseCredKey?: string;
};

/**
 * Get Supabase client with service role key (admin access)
 *
 * Stored on globalThis so the client survives Next.js HMR in dev mode.
 * Module-level variables get reset on each hot reload, which would
 * orphan any in-flight requests on the old client.
 */
export async function getSupabaseAdmin(tenantId?: string): Promise<SupabaseClient | null> {
  if (process.env.COURSEY_PLATFORM === 'true') return (await import('@/coursey/runtime')).siteClient();
  const creds = await getSupabaseCredentials();

  if (!creds) {
    console.error('[getSupabaseAdmin] No credentials returned!');
    return null;
  }

  const credKey = `${creds.projectUrl}:${creds.serviceRoleKey}`;
  if (globalForSupabase.__supabaseClient && globalForSupabase.__supabaseCredKey === credKey) {
    return globalForSupabase.__supabaseClient;
  }

  const limitedFetch: typeof globalThis.fetch = (input, init) =>
    withLimit(() => globalThis.fetch(input, init));

  globalForSupabase.__supabaseClient = createClient(creds.projectUrl, creds.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: { fetch: limitedFetch },
  });

  globalForSupabase.__supabaseCredKey = credKey;

  return globalForSupabase.__supabaseClient;
}

/**
 * Test Supabase connection with full config
 */
export async function testSupabaseConnection(
  config: SupabaseConfig
): Promise<{ success: boolean; error?: string }> {
  try {
    const parsed = parseSupabaseConfig(config);

    const client = createClient(parsed.projectUrl, parsed.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { error } = await client.auth.admin.listUsers({
      page: 1,
      perPage: 1,
    });

    if (error) {
      console.error('[testSupabaseConnection] Failed:', { url: parsed.projectUrl, error: error.message, status: error.status });
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    console.error('[testSupabaseConnection] Failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    };
  }
}

/**
 * Get tenant ID from request headers.
 *
 * Base implementation: always returns null (single-tenant, no scoping needed).
 * Overridden via path alias in multi-tenant deployments.
 */
export async function getTenantIdFromHeaders(): Promise<string | null> {
  return null;
}

/**
 * Execute raw SQL query
 */
export async function executeSql(sql: string): Promise<{ success: boolean; error?: string }> {
  const client = await getSupabaseAdmin();

  if (!client) {
    return { success: false, error: 'Supabase not configured' };
  }

  try {
    const { error } = await client.rpc('exec_sql', { sql });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'SQL execution failed',
    };
  }
}

/**
 * Setup API Client
 *
 * Handles communication with Next.js setup API routes
 */

import type { ApiResponse, SupabaseConfig } from '@/types';

/**
 * Check if setup is complete
 */
export async function checkSetupStatus(): Promise<{
  is_configured: boolean;
  is_setup_complete: boolean;
  is_vercel: boolean;
  error?: string;
}> {
  const response = await fetch('/ycode/api/setup/status');

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

/**
 * Connect Supabase credentials (4 fields)
 */
export async function connectSupabase(
  config: SupabaseConfig
): Promise<ApiResponse<void>> {
  const response = await fetch('/ycode/api/setup/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      anon_key: config.anonKey,
      service_role_key: config.serviceRoleKey,
      connection_url: config.connectionUrl,
      db_password: config.dbPassword,
      ...(config.supabaseUrl ? { supabase_url: config.supabaseUrl } : {}),
    }),
  });

  return response.json();
}

/**
 * Run Supabase migrations (checks and runs if needed)
 */
export async function runMigrations(): Promise<ApiResponse<void>> {
  const response = await fetch('/ycode/api/setup/migrate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  return response.json();
}

/**
 * Check if Supabase "Confirm email" setting is disabled (autoconfirm enabled)
 */
export async function checkEmailConfirmDisabled(): Promise<{
  autoconfirm: boolean;
  error?: string;
}> {
  const response = await fetch('/ycode/api/setup/check-email-confirm');
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  return data;
}

/**
 * Complete setup and promote initial user to admin
 */
export async function completeSetup(): Promise<ApiResponse<{ redirect_url: string }>> {
  const response = await fetch('/ycode/api/setup/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  return response.json();
}

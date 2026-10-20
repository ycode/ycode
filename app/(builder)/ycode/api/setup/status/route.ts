import { credentials } from '@/lib/credentials';
import { noCache } from '@/lib/api-response';
import { validateConnectionUrl } from '@/lib/supabase-config-parser';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import type { SupabaseConfig } from '@/types';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Check if at least one auth user exists (setup fully complete)
 */
async function hasAuthUsers(): Promise<boolean> {
  try {
    const client = await getSupabaseAdmin();
    if (!client) return false;

    const { data, error } = await client.auth.admin.listUsers({
      page: 1,
      perPage: 1,
    });

    if (error) return false;
    return (data.users?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * GET /ycode/api/setup/status
 *
 * Check if Supabase is configured and detect environment.
 * Also returns is_setup_complete when config + migrations + admin user exist.
 */
export async function GET() {
  if (process.env.COURSEY_PLATFORM === 'true') return noCache({is_configured:true,is_setup_complete:true,is_vercel:false});
  try {
    const config = await credentials.get<SupabaseConfig>('supabase_config');
    const isVercel = process.env.VERCEL === '1';

    // If no config, return not configured
    if (!config) {
      return noCache({
        is_configured: false,
        is_setup_complete: false,
        is_vercel: isVercel,
      });
    }

    // Validate the connection URL format
    try {
      validateConnectionUrl(config.connectionUrl, config.dbPassword, config.supabaseUrl);
    } catch (validationError) {
      console.error('Invalid connection URL format:', validationError);

      return noCache({
        is_configured: false,
        is_setup_complete: false,
        is_vercel: isVercel,
        error: validationError instanceof Error
          ? validationError.message
          : 'Invalid SUPABASE_CONNECTION_URL format. For self-hosted Supabase, also set the SUPABASE_URL environment variable.',
      });
    }

    // Check if setup is fully complete (has at least one auth user)
    const setupComplete = await hasAuthUsers();

    return noCache({
      is_configured: true,
      is_setup_complete: setupComplete,
      is_vercel: isVercel,
    });
  } catch (error) {
    console.error('Setup status check failed:', error);

    return noCache(
      { error: 'Failed to check setup status' },
      500
    );
  }
}

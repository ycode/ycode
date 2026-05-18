import { NextResponse } from 'next/server';
import { credentials } from '@/lib/credentials';
import { parseSupabaseConfig } from '@/lib/supabase-config-parser';
import { noCache } from '@/lib/api-response';
import { getAdminUser } from '@/lib/supabase-auth';
import type { SupabaseConfig } from '@/types';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/supabase/config
 *
 * Returns public Supabase configuration (URL and anon key only)
 * Used by browser client for authentication
 */
export async function GET() {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const config = await credentials.get<SupabaseConfig>('supabase_config');

    if (!config) {
      // Config not found - return 404 (expected during setup)
      return noCache(
        { error: 'Supabase not configured. Please complete the setup wizard first.' },
        404
      );
    }

    // Parse config to get the full credentials including projectUrl
    // If parsing fails, treat it as not configured (return 404 instead of 500)
    let parsed;
    try {
      parsed = parseSupabaseConfig(config);
    } catch (parseError) {
      console.error('Failed to parse Supabase config:', parseError);
      return noCache(
        { error: 'Supabase not configured. Please complete the setup wizard first.' },
        404
      );
    }

    return noCache({
      data: {
        url: parsed.projectUrl,
        anonKey: parsed.anonKey,
      },
    });
  } catch (error) {
    // Unexpected errors - log but return 404 to prevent breaking the app
    console.error('Failed to get Supabase config:', error);

    return noCache(
      { error: 'Supabase not configured. Please complete the setup wizard first.' },
      404
    );
  }
}

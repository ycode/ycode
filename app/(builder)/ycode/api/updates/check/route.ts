import { NextResponse } from 'next/server';
import packageJson from '../../../../../../package.json';
import { noCache } from '@/lib/api-response';
import { checkForUpdates } from '@/lib/updates/check-updates';
import { getAdminUser } from '@/lib/supabase-auth';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/updates/check
 *
 * Check for updates from the official Ycode repository
 */
export async function GET() {
  const adminAuth = await getAdminUser();
  if (!adminAuth) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const result = await checkForUpdates(packageJson.version);
  return noCache(result);
}

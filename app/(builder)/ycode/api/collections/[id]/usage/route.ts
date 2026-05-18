import { NextRequest } from 'next/server';
import { getCollectionUsage } from '@/lib/collection-usage-utils';
import { getAdminUser } from '@/lib/supabase-auth';
import { noCache } from '@/lib/api-response';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/collections/[id]/usage
 * Get usage references for a collection
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return noCache({ error: 'Not authenticated' }, 401);
    }

    const { id } = await params;

    if (!id) {
      return noCache({ error: 'Collection ID is required' }, 400);
    }

    const usage = await getCollectionUsage(id);

    return noCache({ data: usage });
  } catch (error) {
    console.error('Error fetching collection usage:', error);
    return noCache(
      { error: 'Failed to fetch collection usage' },
      500
    );
  }
}

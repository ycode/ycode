import { NextRequest } from 'next/server';
import { duplicatePageFolder } from '@/lib/repositories/pageFolderRepository';
import { getAdminUser } from '@/lib/supabase-auth';
import { noCache } from '@/lib/api-response';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /ycode/api/folders/[id]/duplicate
 *
 * Duplicate a folder
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return noCache({ error: 'Not authenticated' }, 401);
    }

    const { id } = await params;

    const newFolder = await duplicatePageFolder(id);

    return noCache(
      { data: newFolder },
      201
    );
  } catch (error) {
    console.error('[POST /ycode/api/folders/[id]/duplicate] Error:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to duplicate folder' },
      500
    );
  }
}

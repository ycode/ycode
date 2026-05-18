import { NextRequest, NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/supabase-auth';
import { getAllPageFolders, createPageFolder } from '@/lib/repositories/pageFolderRepository';
import { noCache } from '@/lib/api-response';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/folders
 *
 * Get all draft folders (for the builder)
 */
export async function GET() {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return noCache({ error: 'Not authenticated' }, 401);
    }

    // Only return draft folders for the builder
    const folders = await getAllPageFolders({ is_published: false });

    return noCache({
      data: folders,
    });
  } catch (error) {
    console.error('[GET /ycode/api/folders] Error:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch folders' },
      500
    );
  }
}

/**
 * POST /ycode/api/folders
 *
 * Create a new folder
 */
export async function POST(request: NextRequest) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return noCache({ error: 'Not authenticated' }, 401);
    }

    const body = await request.json();
    const { name, slug, page_folder_id = null, depth = 0, order = 0, settings = {} } = body;

    // Validate required fields
    if (!name || !slug) {
      return noCache(
        { error: 'Name and slug are required' },
        400
      );
    }

    // Sanitize page_folder_id: filter out temp IDs (can't be UUIDs) - treat as root, will update when parent is saved
    const sanitizedParentFolderId = page_folder_id && page_folder_id.startsWith('temp-')
      ? null
      : page_folder_id;

    // Increment sibling orders if inserting (safe to call when appending - only updates order >= startOrder)
    const { incrementSiblingOrders } = await import('@/lib/services/pageService');
    await incrementSiblingOrders(order, depth, sanitizedParentFolderId);

    // Create folder (use sanitized parent folder ID)
    const folder = await createPageFolder({
      name,
      slug,
      page_folder_id: sanitizedParentFolderId,
      depth,
      order,
      settings,
      is_published: false,
    });

    return noCache({
      data: folder,
    });
  } catch (error) {
    console.error('[POST /ycode/api/folders] Error:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to create folder' },
      500
    );
  }
}

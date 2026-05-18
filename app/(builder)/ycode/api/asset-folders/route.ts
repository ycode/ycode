import { NextRequest } from 'next/server';
import { getAllAssetFolders, createAssetFolder } from '@/lib/repositories/assetFolderRepository';
import { getAdminUser } from '@/lib/supabase-auth';
import { noCache } from '@/lib/api-response';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/asset-folders
 *
 * Get all asset folders
 */
export async function GET() {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return noCache({ error: 'Not authenticated' }, 401);
    }

    const folders = await getAllAssetFolders();

    return noCache({
      data: folders,
    });
  } catch (error) {
    console.error('[GET /ycode/api/asset-folders] Error:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch asset folders' },
      500
    );
  }
}

/**
 * POST /ycode/api/asset-folders
 *
 * Create a new asset folder
 */
export async function POST(request: NextRequest) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return noCache({ error: 'Not authenticated' }, 401);
    }

    const body = await request.json();
    const { name, asset_folder_id = null, depth = 0, order = 0 } = body;

    // Validate required fields
    if (!name) {
      return noCache(
        { error: 'Name is required' },
        400
      );
    }

    // Sanitize asset_folder_id: filter out temp IDs
    const sanitizedParentFolderId = asset_folder_id && asset_folder_id.startsWith('temp-')
      ? null
      : asset_folder_id;

    // Create folder (always as draft)
    const folder = await createAssetFolder({
      name,
      asset_folder_id: sanitizedParentFolderId,
      depth,
      order,
      is_published: false,
    });

    return noCache({
      data: folder,
    });
  } catch (error) {
    console.error('[POST /ycode/api/asset-folders] Error:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to create asset folder' },
      500
    );
  }
}

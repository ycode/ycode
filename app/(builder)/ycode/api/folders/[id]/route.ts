import { NextRequest } from 'next/server';
import { deletePageFolder, updatePageFolder, getPageFolderById } from '@/lib/repositories/pageFolderRepository';
import { deleteTranslationsInBulk } from '@/lib/repositories/translationRepository';
import { getAdminUser } from '@/lib/supabase-auth';
import { noCache } from '@/lib/api-response';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/folders/[id]
 *
 * Get a folder by ID
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

    const folder = await getPageFolderById(id);

    if (!folder) {
      return noCache(
        { error: 'Folder not found' },
        404
      );
    }

    return noCache(
      { data: folder },
      200
    );
  } catch (error) {
    console.error('[GET /ycode/api/folders/[id]] Error:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch folder' },
      500
    );
  }
}

/**
 * PUT /ycode/api/folders/[id]
 *
 * Update a folder
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return noCache({ error: 'Not authenticated' }, 401);
    }

    const { id } = await params;

    const body = await request.json();

    // Validate required fields if provided
    if (body.name !== undefined && typeof body.name !== 'string') {
      return noCache(
        { error: 'Invalid name field' },
        400
      );
    }

    if (body.slug !== undefined && typeof body.slug !== 'string') {
      return noCache(
        { error: 'Invalid slug field' },
        400
      );
    }

    const updatedFolder = await updatePageFolder(id, body);

    return noCache(
      { data: updatedFolder },
      200
    );
  } catch (error) {
    console.error('[PUT /ycode/api/folders/[id]] Error:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to update folder' },
      500
    );
  }
}

/**
 * DELETE /ycode/api/folders/[id]
 *
 * Delete a folder and its associated translations (soft delete)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return noCache({ error: 'Not authenticated' }, 401);
    }

    const { id } = await params;

    // Delete the folder
    await deletePageFolder(id);
    
    // Delete all translations for this folder
    await deleteTranslationsInBulk('folder', id);

    return noCache(
      { data: { success: true } },
      200
    );
  } catch (error) {
    console.error('[DELETE /ycode/api/folders/[id]] Error:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to delete folder' },
      500
    );
  }
}

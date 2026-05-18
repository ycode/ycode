import { NextRequest, NextResponse } from 'next/server';
import { getCollectionById, updateCollection, deleteCollection } from '@/lib/repositories/collectionRepository';
import { getItemsByCollectionId } from '@/lib/repositories/collectionItemRepository';
import { deleteTranslationsInBulk } from '@/lib/repositories/translationRepository';
import { getAdminUser } from '@/lib/supabase-auth';
import { noCache } from '@/lib/api-response';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/collections/[id]
 * Get collection by ID (draft version)
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

    // Always get draft version in the builder
    const collection = await getCollectionById(id, false);

    if (!collection) {
      return noCache({ error: 'Collection not found' }, 404);
    }

    return noCache({ data: collection });
  } catch (error) {
    console.error('Error fetching collection:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch collection' },
      500
    );
  }
}

/**
 * PUT /ycode/api/collections/[id]
 * Update collection (draft version)
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

    // Always update draft version in the builder
    const collection = await updateCollection(id, body, false);

    return noCache({ data: collection });
  } catch (error) {
    console.error('Error updating collection:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to update collection' },
      500
    );
  }
}

/**
 * DELETE /ycode/api/collections/[id]
 * Delete collection (soft delete draft version) and all associated translations
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

    // Get all items in this collection (draft versions)
    const { items } = await getItemsByCollectionId(id, false);

    // Delete translations for all items in this collection in a single query
    if (items.length > 0) {
      const itemIds = items.map(item => item.id);
      await deleteTranslationsInBulk('cms', itemIds);
    }

    // Delete the collection (soft delete draft version)
    await deleteCollection(id, false);

    return noCache({ data: { success: true } });
  } catch (error) {
    console.error('Error deleting collection:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to delete collection' },
      500
    );
  }
}

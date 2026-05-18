import { NextRequest, NextResponse } from 'next/server';
import { getAllCollections, createCollection } from '@/lib/repositories/collectionRepository';
import { noCache } from '@/lib/api-response';
import { getAdminUser } from '@/lib/supabase-auth';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/collections
 * Get all collections (draft by default)
 */
export async function GET() {
  const adminAuth = await getAdminUser();
  if (!adminAuth) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    // Always get draft collections in the builder
    const collections = await getAllCollections({ is_published: false, deleted: false });
    
    return noCache({
      data: collections,
    });
  } catch (error) {
    console.error('Error fetching collections:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch collections' },
      500
    );
  }
}

/**
 * POST /ycode/api/collections
 * Create a new collection
 */
export async function POST(request: NextRequest) {
  const adminAuth = await getAdminUser();
  if (!adminAuth) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const body = await request.json();
    
    // Validate required fields
    if (!body.name) {
      return noCache(
        { error: 'Missing required field: name' },
        400
      );
    }
    
    const collection = await createCollection({
      name: body.name,
      sorting: body.sorting || null,
      order: body.order ?? 0,
      is_published: false, // Always create as draft
    });
    
    return noCache(
      { data: collection },
      201
    );
  } catch (error) {
    console.error('Error creating collection:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to create collection' },
      500
    );
  }
}

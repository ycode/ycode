import { NextRequest, NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/supabase-auth';
import { getLayersByPageId, upsertDraftLayers } from '@/lib/repositories/pageLayersRepository';
import { noCache } from '@/lib/api-response';
import type { Layer } from '@/types';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/layers?page_id=X&is_published=false
 *
 * Get layers for a page with optional is_published filter
 */
export async function GET(request: NextRequest) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return noCache({ error: 'Not authenticated' }, 401);
    }

    const { searchParams } = new URL(request.url);
    const pageId = searchParams.get('page_id');
    const isPublishedParam = searchParams.get('is_published');

    if (!pageId) {
      return noCache(
        { error: 'page_id query parameter is required' },
        400
      );
    }

    // Parse is_published filter
    const isPublished = isPublishedParam === 'true' ? true : isPublishedParam === 'false' ? false : undefined;

    const layers = await getLayersByPageId(pageId, isPublished);

    if (!layers) {
      return noCache(
        { error: 'Layers not found' },
        404
      );
    }

    return noCache({
      data: layers,
    });
  } catch (error) {
    console.error('Failed to fetch layers:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch layers' },
      500
    );
  }
}

/**
 * PUT /ycode/api/layers?page_id=X
 *
 * Update draft layers for a page
 */
export async function PUT(request: NextRequest) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return noCache({ error: 'Not authenticated' }, 401);
    }

    const { searchParams } = new URL(request.url);
    const pageId = searchParams.get('page_id');

    if (!pageId) {
      return noCache(
        { error: 'page_id query parameter is required' },
        400
      );
    }

    const body = await request.json();
    const { layers } = body;

    if (!Array.isArray(layers)) {
      return noCache(
        { error: 'Invalid layers data' },
        400
      );
    }

    const draft = await upsertDraftLayers(pageId, layers as Layer[]);

    return noCache({
      data: draft,
    });
  } catch (error) {
    console.error('Failed to update layers:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to update layers' },
      500
    );
  }
}

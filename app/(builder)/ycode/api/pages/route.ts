import { NextRequest, NextResponse } from 'next/server';
import { getAllPages, createPage } from '@/lib/repositories/pageRepository';
import { upsertDraftLayers } from '@/lib/repositories/pageLayersRepository';
import { noCache } from '@/lib/api-response';
import { getAdminUser } from '@/lib/supabase-auth';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/pages
 *
 * Get all pages with optional filters
 * Query params: is_published, is_index, depth
 *
 * Examples:
 * - /api/pages - Get all draft pages (default)
 * - /api/pages?is_published=true - Get all published pages
 * - /api/pages?is_index=true&page_folder_id=null - Get homepage (draft)
 * - /api/pages?is_index=true&page_folder_id=null&is_published=true - Get homepage (published)
 */
export async function GET(request: NextRequest) {
  const adminAuth = await getAdminUser();
  if (!adminAuth) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const filters: Record<string, any> = {};

    // Default to draft pages if no is_published filter specified
    const isPublished = searchParams.get('is_published');
    if (isPublished !== null) {
      filters.is_published = isPublished === 'true';
    } else {
      // Default: only return draft pages for the builder
      filters.is_published = false;
    }

    // Optional filters
    const isIndex = searchParams.get('is_index');
    if (isIndex !== null) {
      filters.is_index = isIndex === 'true';
    }

    const depth = searchParams.get('depth');
    if (depth !== null) {
      filters.depth = parseInt(depth, 10);
    }

    const pages = await getAllPages(filters);

    return noCache({
      data: pages,
    });
  } catch (error) {
    console.error('[GET /ycode/api/pages] Error:', error);
    console.error('[GET /ycode/api/pages] Error message:', error instanceof Error ? error.message : 'Unknown error');
    console.error('[GET /ycode/api/pages] Error stack:', error instanceof Error ? error.stack : 'No stack');

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch pages' },
      500
    );
  }
}

/**
 * POST /ycode/api/pages
 *
 * Create a new page
 */
export async function POST(request: NextRequest) {
  const adminAuth = await getAdminUser();
  if (!adminAuth) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const body = await request.json();

    const {
      name,
      slug,
      is_published = false,
      page_folder_id = null,
      order = 0,
      depth = 0,
      is_index = false,
      is_dynamic = false,
      error_page = null,
      settings = {},
    } = body;

    // Validate required fields
    if (!name) {
      console.error('[POST /ycode/api/pages] Validation failed: missing name');
      return noCache(
        { error: 'Name is required' },
        400
      );
    }

    // Determine final slug: error pages and index pages must have empty slugs
    const finalSlug = (error_page !== null || is_index) ? '' : slug;

    // Validate slug requirements
    if ((error_page !== null || is_index) && slug && slug.trim() !== '') {
      const pageType = error_page !== null ? 'Error' : 'Index';
      console.error(`[POST /ycode/api/pages] Validation failed: ${pageType.toLowerCase()} page has non-empty slug`);
      return noCache(
        { error: `${pageType} pages must have an empty slug` },
        400
      );
    }

    if (!is_index && error_page === null && (!finalSlug || finalSlug.trim() === '')) {
      console.error('[POST /ycode/api/pages] Validation failed: non-index page missing slug');
      return noCache(
        { error: 'Non-index pages must have a slug' },
        400
      );
    }

    const normalizeFolderId = (value: string | null) => {
      if (value === null || value === undefined) {
        return null;
      }
      if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed || trimmed === 'null' || trimmed === 'undefined') {
          return null;
        }
        return trimmed;
      }
      return value;
    };

    const normalizedPageFolderId = normalizeFolderId(page_folder_id);

    // Increment sibling orders if inserting (safe to call when appending - only updates order >= startOrder)
    const { incrementSiblingOrders } = await import('@/lib/services/pageService');
    await incrementSiblingOrders(order, depth, normalizedPageFolderId);

    // Create page
    const page = await createPage({
      name,
      slug: finalSlug,
      is_published,
      page_folder_id: normalizedPageFolderId,
      order,
      depth,
      is_index,
      is_dynamic,
      error_page,
      settings,
    });

    // Create initial draft with Body container
    const bodyLayer = {
      id: 'body',
      name: 'body',
      classes: '',
      children: [],
    };

    await upsertDraftLayers(page.id, [bodyLayer]);

    return noCache({
      data: page,
    });
  } catch (error) {
    console.error('[POST /ycode/api/pages] Error:', error);
    console.error('[POST /ycode/api/pages] Error message:', error instanceof Error ? error.message : 'Unknown');
    console.error('[POST /ycode/api/pages] Error stack:', error instanceof Error ? error.stack : 'No stack');

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to create page' },
      500
    );
  }
}

import { NextRequest } from 'next/server';
import { getPageById, updatePage, deletePage } from '@/lib/repositories/pageRepository';
import { deleteTranslationsInBulk } from '@/lib/repositories/translationRepository';
import { noCache } from '@/lib/api-response';
import { getAdminUser } from '@/lib/supabase-auth';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/pages/[id]
 *
 * Get a specific page
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminAuth = await getAdminUser();
  if (!adminAuth) {
    return noCache({ error: 'Not authenticated' }, 401);
  }

  try {
    const { id } = await params;
    // For GET requests, return draft version (what users edit)
    const page = await getPageById(id, false);

    if (!page) {
      return noCache(
        { error: 'Page not found' },
        404
      );
    }

    return noCache({
      data: page,
    });
  } catch (error) {
    console.error('Failed to fetch page:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch page' },
      500
    );
  }
}

/**
 * PUT /ycode/api/pages/[id]
 *
 * Update a page
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminAuth = await getAdminUser();
  if (!adminAuth) {
    return noCache({ error: 'Not authenticated' }, 401);
  }

  try {
    const { id } = await params;
    const body = await request.json();

    // Get current draft page to check its state
    // Repository update functions only update draft versions
    const currentPage = await getPageById(id, false);
    if (!currentPage) {
      return noCache(
        { error: 'Page not found' },
        404
      );
    }

    // Determine if the page is/will be an error page, index page, or dynamic page
    const isErrorPage = body.error_page !== undefined
      ? (body.error_page !== null)
      : (currentPage.error_page !== null);

    const isIndexPage = body.is_index !== undefined
      ? body.is_index
      : currentPage.is_index;

    const isDynamicPage = body.is_dynamic !== undefined
      ? body.is_dynamic
      : currentPage.is_dynamic;

    // Error pages and index pages must have empty slugs
    if (isErrorPage || isIndexPage) {
      if (body.slug !== undefined && body.slug.trim() !== '') {
        const pageType = isErrorPage ? 'Error' : 'Index';
        return noCache(
          { error: `${pageType} pages must have an empty slug` },
          400
        );
      }
      // Force slug to empty
      body.slug = '';
    }

    // Dynamic pages should have "*" as slug (allow updates to "*")
    if (isDynamicPage && body.slug !== undefined && body.slug !== '*') {
      body.slug = '*';
    }

    // Pass all updates to the repository (it will handle further validation)
    const page = await updatePage(id, body);

    return noCache({
      data: page,
    });
  } catch (error) {
    console.error('Failed to update page:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to update page' },
      500
    );
  }
}

/**
 * DELETE /ycode/api/pages/[id]
 *
 * Delete a page and its associated translations
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminAuth = await getAdminUser();
  if (!adminAuth) {
    return noCache({ error: 'Not authenticated' }, 401);
  }

  try {
    const { id } = await params;

    // Delete the page
    await deletePage(id);

    // Delete all translations for this page
    await deleteTranslationsInBulk('page', id);

    return noCache({
      success: true,
      message: 'Page deleted successfully',
    });
  } catch (error) {
    console.error('Failed to delete page:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to delete page' },
      500
    );
  }
}

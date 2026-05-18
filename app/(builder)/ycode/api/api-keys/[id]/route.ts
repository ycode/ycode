import { NextRequest } from 'next/server';
import { getApiKeyById, deleteApiKey } from '@/lib/repositories/apiKeyRepository';
import { noCache } from '@/lib/api-response';
import { getAdminUser } from '@/lib/supabase-auth';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/api-keys/[id]
 * Get a single API key by ID (internal endpoint)
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
    const key = await getApiKeyById(id);

    if (!key) {
      return noCache(
        { error: 'API key not found' },
        404
      );
    }

    return noCache({
      data: key,
    });
  } catch (error) {
    console.error('Error fetching API key:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch API key' },
      500
    );
  }
}

/**
 * DELETE /ycode/api/api-keys/[id]
 * Delete an API key (internal endpoint for settings UI)
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

    // Verify the key exists first
    const existing = await getApiKeyById(id);
    if (!existing) {
      return noCache(
        { error: 'API key not found' },
        404
      );
    }

    await deleteApiKey(id);

    return noCache({
      data: { deleted: true, id },
    });
  } catch (error) {
    console.error('Error deleting API key:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to delete API key' },
      500
    );
  }
}

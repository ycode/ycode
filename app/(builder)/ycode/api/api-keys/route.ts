import { NextRequest } from 'next/server';
import { getAllApiKeys, createApiKey } from '@/lib/repositories/apiKeyRepository';
import { noCache } from '@/lib/api-response';
import { getAdminUser } from '@/lib/supabase-auth';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/api-keys
 * List all API keys (internal endpoint for settings UI)
 */
export async function GET() {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return noCache({ error: 'Not authenticated' }, 401);
    }

    const keys = await getAllApiKeys();

    return noCache({
      data: keys,
    });
  } catch (error) {
    console.error('Error fetching API keys:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch API keys' },
      500
    );
  }
}

/**
 * POST /ycode/api/api-keys
 * Generate a new API key (internal endpoint for settings UI)
 * 
 * Request body:
 * {
 *   "name": "Production API Key"
 * }
 * 
 * Response:
 * {
 *   "data": {
 *     "id": "uuid",
 *     "name": "Production API Key",
 *     "key_prefix": "ycode_abc123",
 *     "api_key": "ycode_abc123...",  // Only shown once!
 *     "created_at": "..."
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return noCache({ error: 'Not authenticated' }, 401);
    }

    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== 'string' || name.trim() === '') {
      return noCache(
        { error: 'Name is required' },
        400
      );
    }

    const key = await createApiKey(name.trim());

    return noCache({
      data: key,
    }, 201);
  } catch (error) {
    console.error('Error creating API key:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to create API key' },
      500
    );
  }
}

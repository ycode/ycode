import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { getAdminUser } from '@/lib/supabase-auth';

/**
 * PUT /ycode/api/profile/name
 *
 * Update user's display name
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { name } = body;

    if (!name || typeof name !== 'string') {
      return noCache({ error: 'Name is required' }, 400);
    }

    const auth = await getAdminUser();
    if (!auth) {
      return noCache({ error: 'Not authenticated' }, 401);
    }

    // Update user metadata
    const { data, error } = await auth.client.auth.updateUser({
      data: {
        display_name: name.trim(),
        full_name: name.trim(),
      },
    });

    if (error) {
      return noCache({ error: error.message }, 400);
    }

    return noCache({
      data: {
        user: data.user,
      },
    });
  } catch (error) {
    console.error('Failed to update name:', error);
    return noCache({ error: 'Failed to update name' }, 500);
  }
}

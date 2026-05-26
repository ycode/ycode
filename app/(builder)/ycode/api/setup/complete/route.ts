import { NextRequest } from 'next/server';
import { getAuthUser } from '@/lib/supabase-auth';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { AUTH_ROLES } from '@/lib/auth-constants';
import { noCache } from '@/lib/api-response';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /ycode/api/setup/complete
 * 
 * Finalizes setup by promoting the initial user to admin.
 * This is called by the Welcome Wizard after successful signup.
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Get the current user who just signed up
    // We use getAuthUser() without role requirement because they don't have it yet
    const auth = await getAuthUser();
    
    if (!auth || !auth.user) {
      return noCache({ error: 'Not authenticated' }, 401);
    }

    // 2. Get admin client
    const adminClient = await getSupabaseAdmin();
    if (!adminClient) {
      return noCache({ error: 'Supabase admin client not configured' }, 500);
    }

    // 3. Security check: Only allow promotion if:
    // a) This is the first user in the system
    // b) The current user is already an admin (no-op)
    const { data: { users }, error: listError } = await adminClient.auth.admin.listUsers({
      page: 1,
      perPage: 2, // We only need to know if there's more than 1
    });

    if (listError) {
      console.error('[setup/complete] Error listing users:', listError);
      return noCache({ error: 'Failed to verify user count' }, 500);
    }

    const isFirstUser = users.length <= 1;
    const isAlreadyAdmin = auth.user.app_metadata?.role === AUTH_ROLES.ADMIN;

    if (!isFirstUser && !isAlreadyAdmin) {
      return noCache({ error: 'Access denied: Setup is already complete' }, 403);
    }

    // 4. Promote user to admin in app_metadata
    const { error: updateError } = await adminClient.auth.admin.updateUserById(
      auth.user.id,
      { app_metadata: { role: AUTH_ROLES.ADMIN } }
    );

    if (updateError) {
      console.error('[setup/complete] Error promoting user to admin:', updateError);
      return noCache({ error: updateError.message }, 400);
    }

    return noCache({
      data: {
        message: 'Setup complete and user promoted to admin',
        redirect_url: '/ycode',
      },
    });
  } catch (error) {
    console.error('[setup/complete] Unexpected error:', error);
    return noCache({ error: 'Internal server error' }, 500);
  }
}

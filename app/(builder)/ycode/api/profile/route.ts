import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { getAdminUser } from '@/lib/supabase-auth';
import { getSupabaseAdmin } from '@/lib/supabase-server';

/**
 * DELETE /ycode/api/profile
 *
 * Delete user's profile and account
 */
export async function DELETE(request: NextRequest) {
  try {
    const auth = await getAdminUser();
    if (!auth) {
      return noCache({ error: 'Not authenticated' }, 401);
    }

    // Use admin client to delete user
    const adminClient = await getSupabaseAdmin();

    if (!adminClient) {
      return noCache({ error: 'Server configuration error' }, 500);
    }

    // Delete user using admin client
    const { error } = await adminClient.auth.admin.deleteUser(auth.user.id);

    if (error) {
      console.error('Failed to delete user:', error);
      return noCache({ error: error.message }, 400);
    }

    // Sign out the user
    await auth.client.auth.signOut();

    return noCache({
      data: {
        success: true,
        message: 'Profile deleted successfully',
      },
    });
  } catch (error) {
    console.error('Failed to delete profile:', error);
    return noCache({ error: 'Failed to delete profile' }, 500);
  }
}

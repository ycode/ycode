import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { getAdminUser } from '@/lib/supabase-auth';

/**
 * PUT /ycode/api/profile/password
 *
 * Update user's password (requires current password)
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || typeof currentPassword !== 'string') {
      return noCache({ error: 'Current password is required' }, 400);
    }

    if (!newPassword || typeof newPassword !== 'string') {
      return noCache({ error: 'New password is required' }, 400);
    }

    if (newPassword.length < 6) {
      return noCache({ error: 'New password must be at least 6 characters' }, 400);
    }

    const auth = await getAdminUser();
    if (!auth) {
      return noCache({ error: 'Not authenticated' }, 401);
    }

    // Verify current password by re-authenticating
    const { error: signInError } = await auth.client.auth.signInWithPassword({
      email: auth.user.email!,
      password: currentPassword,
    });

    if (signInError) {
      return noCache({ error: 'Current password is incorrect' }, 400);
    }

    // Update password
    const { data, error } = await auth.client.auth.updateUser({
      password: newPassword,
    });

    if (error) {
      console.error('Failed to update password:', error);
      return noCache({ error: `Failed to update password: ${error.message}` }, 400);
    }

    if (!data.user) {
      return noCache({ error: 'Password update failed - no user returned' }, 500);
    }

    return noCache({
      data: {
        success: true,
        message: 'Password updated successfully',
      },
    });
  } catch (error) {
    console.error('Failed to update password:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return noCache({ error: `Failed to update password: ${message}` }, 500);
  }
}
